#![no_std]
//! Honorarios: splits every payment a freelancer receives into net income and a tax reserve
//! that only the freelancer can withdraw. Each freelancer sets the reserve rate and the time
//! zone of their tax month. Peru (8% fourth-category prepayment, months in Lima time) is the
//! first verified preset; the contract itself encodes no country's law.
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, String,
};

/// Cap on the reserve rate a freelancer can choose: 50%.
pub const MAX_TAX_BPS: u32 = 5_000;
/// UTC offsets that exist in practice, in minutes (UTC-12:00 to UTC+14:00).
pub const MIN_UTC_OFFSET_MIN: i32 = -720;
pub const MAX_UTC_OFFSET_MIN: i32 = 840;
const BPS_DENOMINATOR: i128 = 10_000;
/// Cap on the service fee: 1%. The contract cannot charge more than this, and the
/// actual value is fixed at deployment. This deployment uses 0.
pub const MAX_FEE_BPS: i128 = 100;
/// Maximum length of the receipt number (e.g. "E001-12345").
pub const MAX_REF_LEN: u32 = 32;
/// Maximum length of the receipt concept.
pub const MAX_CONCEPT_LEN: u32 = 80;
// ~5 s per ledger: the reserve and the instance are renewed to ~30 days when fewer than ~7 remain.
const DAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 7 * DAY_LEDGERS;
const TTL_EXTEND_TO: u32 = 30 * DAY_LEDGERS;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    /// Service fee in basis points and the wallet that receives it.
    Fee,
    TaxReserve(Address),
    /// Gross amount collected by a freelancer in a given period (month).
    MonthGross(Address, u32),
    /// Fee receipt issued by the freelancer, keyed by its number.
    Receipt(Address, String),
    /// Reserve rate and tax-month time zone chosen by the freelancer.
    Profile(Address),
}

/// What the freelancer chose: the share of each payment that goes to the reserve, and the
/// time zone in which their tax month closes.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Profile {
    pub tax_bps: u32,
    pub utc_offset_min: i32,
}

/// Fee receipt recorded on chain. The freelancer issues it with their signature and the
/// client can only pay what it says here, once.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub gross: i128,
    pub concept: String,
    pub paid: bool,
    /// Rate and time zone copied from the profile when the receipt was issued. A later
    /// profile change never alters a receipt the client has already seen.
    pub tax_bps: u32,
    pub utc_offset_min: i32,
}

/// Maximum amount per payment. Leaves ample room over any real fee and keeps the rate
/// multiplication from overflowing i128.
pub const MAX_GROSS: i128 = i128::MAX / BPS_DENOMINATOR;

/// Tax period of a timestamp: year * 12 + (month - 1), in the freelancer's time zone.
/// Monthly thresholds (SUNAT's, for Peru) are measured on what was received in the month, so
/// the running total lives in the contract and does not depend on how many events the RPC keeps.
pub fn period_of(timestamp: u64, utc_offset_min: i32) -> u32 {
    let local = (timestamp as i64 + utc_offset_min as i64 * 60).max(0);
    // Howard Hinnant's civil_from_days algorithm, with the era shifted to 0000-03-01.
    let z = local / 86_400 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as u32) * 12 + (m as u32 - 1)
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidAmount = 1,
    InsufficientReserve = 2,
    /// The freelancer cannot be the payer or the contract itself.
    InvalidParty = 3,
    ReceiptRefTooLong = 4,
    /// The fee exceeds MAX_FEE_BPS.
    FeeTooHigh = 5,
    /// A receipt with that number already exists for this freelancer.
    ReceiptExists = 6,
    /// Nobody issued that receipt: there is nothing to pay.
    UnknownReceipt = 7,
    /// The receipt has already been paid.
    AlreadyPaid = 8,
    ConceptTooLong = 9,
    EmptyReceiptRef = 10,
    /// The reserve rate exceeds MAX_TAX_BPS.
    TaxRateTooHigh = 11,
    /// The UTC offset is outside -12:00 to +14:00.
    InvalidUtcOffset = 12,
    /// The freelancer has not chosen a rate and time zone yet.
    NoProfile = 13,
}

fn keep_alive(env: &Env, key: &DataKey) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[contractevent]
pub struct Paid {
    #[topic]
    pub freelancer: Address,
    pub payer: Address,
    pub gross: i128,
    pub net: i128,
    pub tax: i128,
    /// Service fee charged on this payment. Zero until it is enabled.
    pub fee: i128,
    pub receipt_ref: String,
    /// Tax period of the payment (year * 12 + month - 1), in the freelancer's time zone.
    pub period: u32,
    /// Reserve rate applied, in basis points.
    pub tax_bps: u32,
}

#[contractevent]
pub struct ProfileSet {
    #[topic]
    pub freelancer: Address,
    pub tax_bps: u32,
    pub utc_offset_min: i32,
}

#[contractevent]
pub struct Issued {
    #[topic]
    pub freelancer: Address,
    pub receipt_ref: String,
    pub gross: i128,
    pub concept: String,
}

#[contractevent]
pub struct TaxWithdrawn {
    #[topic]
    pub freelancer: Address,
    pub to: Address,
    pub amount: i128,
}

#[contract]
pub struct Honorarios;

#[contractimpl]
impl Honorarios {
    /// `token` is the SAC contract of the USDC used for payments. `fee_bps` is the
    /// service fee, deducted from the gross and sent to `fee_to`. It is fixed at
    /// deployment: nobody can raise it later.
    pub fn __constructor(
        env: Env,
        token: Address,
        fee_bps: i128,
        fee_to: Address,
    ) -> Result<(), Error> {
        if fee_bps < 0 || fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::Fee, &(fee_bps, fee_to));
        Ok(())
    }

    /// Service fee: basis points and the wallet that receives it.
    pub fn fee(env: Env) -> (i128, Address) {
        env.storage().instance().get(&DataKey::Fee).unwrap()
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    /// The freelancer chooses the reserve rate and the time zone of their tax month. It
    /// applies to receipts issued from now on; receipts already issued keep their own.
    pub fn set_profile(
        env: Env,
        freelancer: Address,
        tax_bps: u32,
        utc_offset_min: i32,
    ) -> Result<(), Error> {
        freelancer.require_auth();
        if freelancer == env.current_contract_address() {
            return Err(Error::InvalidParty);
        }
        if tax_bps > MAX_TAX_BPS {
            return Err(Error::TaxRateTooHigh);
        }
        if !(MIN_UTC_OFFSET_MIN..=MAX_UTC_OFFSET_MIN).contains(&utc_offset_min) {
            return Err(Error::InvalidUtcOffset);
        }
        let key = DataKey::Profile(freelancer.clone());
        env.storage().persistent().set(
            &key,
            &Profile {
                tax_bps,
                utc_offset_min,
            },
        );
        keep_alive(&env, &key);
        ProfileSet {
            freelancer,
            tax_bps,
            utc_offset_min,
        }
        .publish(&env);
        Ok(())
    }

    pub fn profile(env: Env, freelancer: Address) -> Option<Profile> {
        env.storage()
            .persistent()
            .get(&DataKey::Profile(freelancer))
    }

    /// The freelancer issues a fee receipt and signs it. It is the only thing a client can
    /// pay later, so nobody else can add payments to the freelancer's month.
    pub fn issue(
        env: Env,
        freelancer: Address,
        receipt_ref: String,
        gross: i128,
        concept: String,
    ) -> Result<(), Error> {
        freelancer.require_auth();
        if gross <= 0 || gross > MAX_GROSS {
            return Err(Error::InvalidAmount);
        }
        if freelancer == env.current_contract_address() {
            return Err(Error::InvalidParty);
        }
        if receipt_ref.len() == 0 {
            return Err(Error::EmptyReceiptRef);
        }
        if receipt_ref.len() > MAX_REF_LEN {
            return Err(Error::ReceiptRefTooLong);
        }
        if concept.len() > MAX_CONCEPT_LEN {
            return Err(Error::ConceptTooLong);
        }
        let profile = Self::profile(env.clone(), freelancer.clone()).ok_or(Error::NoProfile)?;
        let key = DataKey::Receipt(freelancer.clone(), receipt_ref.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::ReceiptExists);
        }
        let receipt = Receipt {
            gross,
            concept: concept.clone(),
            paid: false,
            tax_bps: profile.tax_bps,
            utc_offset_min: profile.utc_offset_min,
        };
        env.storage().persistent().set(&key, &receipt);
        keep_alive(&env, &key);

        Issued {
            freelancer,
            receipt_ref,
            gross,
            concept,
        }
        .publish(&env);
        Ok(())
    }

    pub fn receipt(env: Env, freelancer: Address, receipt_ref: String) -> Option<Receipt> {
        env.storage()
            .persistent()
            .get(&DataKey::Receipt(freelancer, receipt_ref))
    }

    /// The client pays an issued receipt. The amount comes from the receipt, not from the
    /// client: the net goes straight to the freelancer's wallet and the reserve stays in the contract.
    pub fn pay(
        env: Env,
        payer: Address,
        freelancer: Address,
        receipt_ref: String,
    ) -> Result<i128, Error> {
        payer.require_auth();
        if freelancer == payer || freelancer == env.current_contract_address() {
            return Err(Error::InvalidParty);
        }
        let receipt_key = DataKey::Receipt(freelancer.clone(), receipt_ref.clone());
        let receipt: Receipt = env
            .storage()
            .persistent()
            .get(&receipt_key)
            .ok_or(Error::UnknownReceipt)?;
        if receipt.paid {
            return Err(Error::AlreadyPaid);
        }
        let (gross, tax_bps, offset) = (receipt.gross, receipt.tax_bps, receipt.utc_offset_min);
        env.storage().persistent().set(
            &receipt_key,
            &Receipt {
                paid: true,
                ..receipt
            },
        );
        keep_alive(&env, &receipt_key);

        let period = period_of(env.ledger().timestamp(), offset);
        let month_key = DataKey::MonthGross(freelancer.clone(), period);
        let month: i128 = env.storage().persistent().get(&month_key).unwrap_or(0);
        env.storage().persistent().set(&month_key, &(month + gross));
        keep_alive(&env, &month_key);

        // Round up: when a cent is in doubt, it stays in the reserve.
        let tax = (gross * tax_bps as i128 + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR;
        // The fee is truncated down: the doubt never falls on the service's side.
        let (fee_bps, fee_to) = Self::fee(env.clone());
        let fee = gross * fee_bps / BPS_DENOMINATOR;
        let net = gross - tax - fee;
        let client = token::Client::new(&env, &Self::token(env.clone()));

        client.transfer(&payer, &freelancer, &net);
        if fee > 0 {
            client.transfer(&payer, &fee_to, &fee);
        }
        if tax > 0 {
            client.transfer(&payer, &env.current_contract_address(), &tax);
            let key = DataKey::TaxReserve(freelancer.clone());
            let reserve: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            env.storage().persistent().set(&key, &(reserve + tax));
            keep_alive(&env, &key);
        }

        Paid {
            freelancer,
            payer,
            gross,
            net,
            tax,
            fee,
            receipt_ref,
            period,
            tax_bps,
        }
        .publish(&env);
        Ok(net)
    }

    pub fn tax_reserve(env: Env, freelancer: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TaxReserve(freelancer))
            .unwrap_or(0)
    }

    /// Renews the reserve's TTL without moving funds. Anyone can call it: it only keeps
    /// an idle reserve from being archived and needing a restore.
    pub fn extend_reserve(env: Env, freelancer: Address) {
        keep_alive(&env, &DataKey::TaxReserve(freelancer));
    }

    /// Current tax period in the freelancer's time zone, to query the month's running total.
    /// Without a profile it is measured in UTC.
    pub fn current_period(env: Env, freelancer: Address) -> u32 {
        let offset = Self::profile(env.clone(), freelancer).map_or(0, |p| p.utc_offset_min);
        period_of(env.ledger().timestamp(), offset)
    }

    /// Gross collected by the freelancer in that period. For Peru, this is the number
    /// compared against SUNAT's monthly threshold.
    pub fn month_gross(env: Env, freelancer: Address, period: u32) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::MonthGross(freelancer, period))
            .unwrap_or(0)
    }

    /// Only the freelancer moves their reserve, for example to pay SUNAT.
    pub fn withdraw_tax(
        env: Env,
        freelancer: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        freelancer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::TaxReserve(freelancer.clone());
        let reserve: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount > reserve {
            return Err(Error::InsufficientReserve);
        }

        env.storage().persistent().set(&key, &(reserve - amount));
        keep_alive(&env, &key);
        token::Client::new(&env, &Self::token(env.clone())).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );

        TaxWithdrawn {
            freelancer,
            to,
            amount,
        }
        .publish(&env);
        Ok(())
    }
}

mod test;
