#![no_std]
//! Honorarios: splits every payment a Peruvian freelancer receives into net income and a
//! reserve for the monthly fourth-category income-tax prepayment (8%, see docs).
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
    String,
};

/// 8% in basis points. Rate of the fourth-category income-tax prepayment.
pub const TAX_BPS: i128 = 800;
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
}

/// Fee receipt recorded on chain. The freelancer issues it with their signature and the
/// client can only pay what it says here, once.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub gross: i128,
    pub concept: String,
    pub paid: bool,
}

/// Peru time zone: the tax month closes at midnight in Lima, not in UTC.
const PERU_UTC_OFFSET: u64 = 5 * 3_600;
/// Maximum amount per payment. Leaves ample room over any real fee and keeps the 8%
/// multiplication from overflowing i128.
pub const MAX_GROSS: i128 = i128::MAX / BPS_DENOMINATOR;

/// Tax period of the current ledger: year * 12 + (month - 1), in Peru time.
/// SUNAT's monthly threshold is measured on what was received in the month, so the
/// running total lives in the contract and does not depend on how many events the RPC keeps.
pub fn period_of(timestamp: u64) -> u32 {
    // Howard Hinnant's civil_from_days algorithm, with the era shifted to 0000-03-01.
    let z = (timestamp.saturating_sub(PERU_UTC_OFFSET) / 86_400) as i64 + 719_468;
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
}

fn keep_alive(env: &Env, key: &DataKey) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
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
    /// Tax period of the payment (year * 12 + month - 1).
    pub period: u32,
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
    pub fn __constructor(env: Env, token: Address, fee_bps: i128, fee_to: Address) -> Result<(), Error> {
        if fee_bps < 0 || fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Fee, &(fee_bps, fee_to));
        Ok(())
    }

    /// Service fee: basis points and the wallet that receives it.
    pub fn fee(env: Env) -> (i128, Address) {
        env.storage().instance().get(&DataKey::Fee).unwrap()
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
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
        let key = DataKey::Receipt(freelancer.clone(), receipt_ref.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::ReceiptExists);
        }
        let receipt = Receipt { gross, concept: concept.clone(), paid: false };
        env.storage().persistent().set(&key, &receipt);
        keep_alive(&env, &key);

        Issued { freelancer, receipt_ref, gross, concept }.publish(&env);
        Ok(())
    }

    pub fn receipt(env: Env, freelancer: Address, receipt_ref: String) -> Option<Receipt> {
        env.storage().persistent().get(&DataKey::Receipt(freelancer, receipt_ref))
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
        let gross = receipt.gross;
        env.storage()
            .persistent()
            .set(&receipt_key, &Receipt { paid: true, ..receipt });
        keep_alive(&env, &receipt_key);

        let period = period_of(env.ledger().timestamp());
        let month_key = DataKey::MonthGross(freelancer.clone(), period);
        let month: i128 = env.storage().persistent().get(&month_key).unwrap_or(0);
        env.storage().persistent().set(&month_key, &(month + gross));
        keep_alive(&env, &month_key);

        // Round up: when a cent is in doubt, it stays in the reserve.
        let tax = (gross * TAX_BPS + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR;
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

        Paid { freelancer, payer, gross, net, tax, fee, receipt_ref, period }.publish(&env);
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

    /// Tax period of the current ledger, to query the month's running total.
    pub fn current_period(env: Env) -> u32 {
        period_of(env.ledger().timestamp())
    }

    /// Gross collected by the freelancer in that period. This is the number compared
    /// against SUNAT's monthly threshold.
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

        TaxWithdrawn { freelancer, to, amount }.publish(&env);
        Ok(())
    }
}

mod test;
