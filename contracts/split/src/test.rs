#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, Address, Env, IntoVal, String,
};

struct Setup {
    env: Env,
    fee_to: Address,
    usdc: token::Client<'static>,
    contract: HonorariosClient<'static>,
    payer: Address,
    freelancer: Address,
}

/// Peru preset: 8% reserve, tax month in Lima time.
const PERU_BPS: u32 = 800;
const LIMA: i32 = -300;

impl Setup {
    fn with_peru_profile(self) -> Self {
        self.contract
            .set_profile(&self.freelancer, &PERU_BPS, &LIMA);
        self
    }
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let payer = Address::generate(&env);
    StellarAssetClient::new(&env, &sac.address()).mint(&payer, &1_000_0000000);

    let fee_to = Address::generate(&env);
    let id = env.register(Honorarios, (sac.address(), 0i128, fee_to.clone()));
    Setup {
        usdc: token::Client::new(&env, &sac.address()),
        contract: HonorariosClient::new(&env, &id),
        freelancer: Address::generate(&env),
        payer,
        fee_to,
        env,
    }
    .with_peru_profile()
}

/// Same setup, with the service fee turned on.
fn setup_with_fee(fee_bps: i128) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let payer = Address::generate(&env);
    StellarAssetClient::new(&env, &sac.address()).mint(&payer, &1_000_0000000);
    let fee_to = Address::generate(&env);
    let id = env.register(Honorarios, (sac.address(), fee_bps, fee_to.clone()));
    Setup {
        usdc: token::Client::new(&env, &sac.address()),
        contract: HonorariosClient::new(&env, &id),
        freelancer: Address::generate(&env),
        payer,
        fee_to,
        env,
    }
    .with_peru_profile()
}

/// The freelancer issues the receipt and the client pays it: the only path for a payment.
fn charge(s: &Setup, freelancer: &Address, gross: i128, receipt_ref: &str) -> i128 {
    let r = String::from_str(&s.env, receipt_ref);
    s.contract.issue(
        freelancer,
        &r,
        &gross,
        &String::from_str(&s.env, "Services"),
    );
    s.contract.pay(&s.payer, freelancer, &r)
}

#[test]
fn pay_splits_net_and_tax_reserve() {
    let s = setup();
    let net = charge(&s, &s.freelancer, 500_0000000, "E001-12");

    assert_eq!(net, 460_0000000);
    assert_eq!(s.usdc.balance(&s.freelancer), 460_0000000);
    assert_eq!(s.usdc.balance(&s.contract.address), 40_0000000);
    assert_eq!(s.contract.tax_reserve(&s.freelancer), 40_0000000);
    assert_eq!(s.usdc.balance(&s.payer), 500_0000000);
}

#[test]
fn reserve_accumulates_across_payments() {
    let s = setup();
    charge(&s, &s.freelancer, 100_0000000, "E001-13");
    charge(&s, &s.freelancer, 200_0000000, "E001-14");

    assert_eq!(s.contract.tax_reserve(&s.freelancer), 24_0000000);
}

#[test]
fn rejects_non_positive_amount() {
    let s = setup();
    let receipt = String::from_str(&s.env, "E001-14");
    let concept = String::from_str(&s.env, "Services");

    let result = s.contract.try_issue(&s.freelancer, &receipt, &0, &concept);

    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn freelancer_withdraws_reserve() {
    let s = setup();
    let sunat = Address::generate(&s.env);
    charge(&s, &s.freelancer, 500_0000000, "E001-15");

    s.contract.withdraw_tax(&s.freelancer, &sunat, &30_0000000);

    assert_eq!(s.usdc.balance(&sunat), 30_0000000);
    assert_eq!(s.contract.tax_reserve(&s.freelancer), 10_0000000);
}

#[test]
fn cannot_withdraw_more_than_reserve() {
    let s = setup();
    let sunat = Address::generate(&s.env);

    let result = s.contract.try_withdraw_tax(&s.freelancer, &sunat, &1);

    assert_eq!(result, Err(Ok(Error::InsufficientReserve)));
}

#[test]
fn rejects_payer_as_freelancer() {
    let s = setup();
    let receipt = String::from_str(&s.env, "E001-16");
    s.contract.set_profile(&s.payer, &PERU_BPS, &LIMA);
    s.contract.issue(
        &s.payer,
        &receipt,
        &100_0000000,
        &String::from_str(&s.env, "Services"),
    );

    let result = s.contract.try_pay(&s.payer, &s.payer, &receipt);

    assert_eq!(result, Err(Ok(Error::InvalidParty)));
}

#[test]
fn rejects_contract_as_freelancer() {
    let s = setup();
    let receipt = String::from_str(&s.env, "E001-17");
    let concept = String::from_str(&s.env, "Services");

    let result = s
        .contract
        .try_issue(&s.contract.address, &receipt, &100_0000000, &concept);

    assert_eq!(result, Err(Ok(Error::InvalidParty)));
}

#[test]
fn rejects_long_receipt_ref() {
    let s = setup();
    let long = String::from_str(&s.env, "E001-000000000000000000000000000001");

    let concept = String::from_str(&s.env, "Services");

    let result = s
        .contract
        .try_issue(&s.freelancer, &long, &100_0000000, &concept);

    assert_eq!(result, Err(Ok(Error::ReceiptRefTooLong)));
}

#[test]
fn pay_extends_reserve_ttl() {
    use soroban_sdk::testutils::storage::Persistent as _;
    let s = setup();
    charge(&s, &s.freelancer, 100_0000000, "E001-18");

    let ttl = s.env.as_contract(&s.contract.address, || {
        s.env
            .storage()
            .persistent()
            .get_ttl(&DataKey::TaxReserve(s.freelancer.clone()))
    });

    assert!(ttl >= TTL_THRESHOLD);
}

// --- Authorization: here the signature is really required.
// set_auths(&[]) leaves the environment in strict mode with zero signatures granted, so
// require_auth fails with Auth(InvalidAction). The tests pin that error with `expected`:
// if the panic came from something else, they would not pass.

fn setup_enforcing_auth() -> Setup {
    let env = Env::default();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let payer = Address::generate(&env);
    env.mock_all_auths();
    StellarAssetClient::new(&env, &sac.address()).mint(&payer, &1_000_0000000);
    let fee_to = Address::generate(&env);
    let id = env.register(Honorarios, (sac.address(), 0i128, fee_to.clone()));
    let s = Setup {
        usdc: token::Client::new(&env, &sac.address()),
        contract: HonorariosClient::new(&env, &id),
        freelancer: Address::generate(&env),
        payer,
        fee_to,
        env,
    }
    .with_peru_profile();
    charge(&s, &s.freelancer, 500_0000000, "E001-1");
    // An issued, unpaid receipt, to prove that paying it requires the client's signature.
    s.contract.issue(
        &s.freelancer,
        &String::from_str(&s.env, "E001-2"),
        &100_0000000,
        &String::from_str(&s.env, "Services"),
    );
    s.env.set_auths(&[]); // from here on nobody has a signature granted
    s
}

#[test]
#[should_panic(expected = "InvalidAction")]
fn withdraw_requires_the_freelancer_signature() {
    let s = setup_enforcing_auth();
    // With no signature granted, the freelancer's require_auth stops the call.
    s.contract
        .withdraw_tax(&s.freelancer, &s.payer, &10_0000000);
}

#[test]
#[should_panic(expected = "InvalidAction")]
fn a_third_party_cannot_withdraw_someone_elses_reserve() {
    let s = setup_enforcing_auth();
    let intruder = Address::generate(&s.env);
    // The intruder signs for itself, but the reserve belongs to the freelancer.
    s.env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &intruder,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &s.contract.address,
            fn_name: "withdraw_tax",
            args: (s.freelancer.clone(), intruder.clone(), 10_0000000i128).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    s.contract
        .withdraw_tax(&s.freelancer, &intruder, &10_0000000);
}

#[test]
#[should_panic(expected = "InvalidAction")]
fn pay_requires_the_payer_signature() {
    let s = setup_enforcing_auth();
    s.contract
        .pay(&s.payer, &s.freelancer, &String::from_str(&s.env, "E001-2"));
}

#[test]
fn month_gross_accumulates_and_separates_periods() {
    let s = setup();
    let period = s.contract.current_period(&s.freelancer);
    charge(&s, &s.freelancer, 300_0000000, "E001-3");
    charge(&s, &s.freelancer, 200_0000000, "E001-4");

    assert_eq!(s.contract.month_gross(&s.freelancer, &period), 500_0000000);
    assert_eq!(s.contract.month_gross(&s.freelancer, &(period + 1)), 0);
}

#[test]
fn period_of_maps_known_dates() {
    // 2026-09-19T00:00:00Z is the night of September 18 in Lima: September.
    assert_eq!(period_of(1_789_776_000, LIMA), 2026 * 12 + 8);
    // 2026-10-01T05:00:00Z is midnight on October 1 in Lima: October.
    assert_eq!(period_of(1_790_830_800, LIMA), 2026 * 12 + 9);
}

#[test]
fn the_month_closes_at_midnight_in_lima() {
    // 2026-10-01T00:00:00Z is 19:00 on September 30 in Lima. That payment
    // belongs to September, which is the month SUNAT measures.
    assert_eq!(period_of(1_790_812_800, LIMA), 2026 * 12 + 8);
    // Five hours later it is already October in Lima.
    assert_eq!(period_of(1_790_812_800 + 5 * 3_600, LIMA), 2026 * 12 + 9);
}

#[test]
fn the_contract_never_owes_more_than_it_holds() {
    let s = setup();
    let other = Address::generate(&s.env);
    s.contract.set_profile(&other, &PERU_BPS, &LIMA);
    charge(&s, &s.freelancer, 500_0000000, "E001-8");
    charge(&s, &other, 250_0000000, "E001-9");
    s.contract
        .withdraw_tax(&s.freelancer, &s.payer, &10_0000000);

    // Custody invariant: everything reserved in everyone's name fits in the contract's balance.
    let reserved = s.contract.tax_reserve(&s.freelancer) + s.contract.tax_reserve(&other);
    assert!(reserved <= s.usdc.balance(&s.contract.address));
}

#[test]
fn the_reserve_rounds_up() {
    let s = setup();
    // 9 units: exactly 8% is 0.72 and the contract sets aside 1, never less than what is owed.
    charge(&s, &s.freelancer, 9, "E001-10");

    assert_eq!(s.contract.tax_reserve(&s.freelancer), 1);
    assert_eq!(s.usdc.balance(&s.freelancer), 8);
}

#[test]
fn rejects_amounts_that_would_overflow_the_tax() {
    let s = setup();
    let r = s.contract.try_issue(
        &s.freelancer,
        &String::from_str(&s.env, "E001-11"),
        &(MAX_GROSS + 1),
        &String::from_str(&s.env, "Services"),
    );

    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn extend_reserve_renews_the_ttl_without_moving_funds() {
    use soroban_sdk::testutils::storage::Persistent as _;
    let s = setup();
    charge(&s, &s.freelancer, 500_0000000, "E001-12");
    let before = s.contract.tax_reserve(&s.freelancer);

    s.contract.extend_reserve(&s.freelancer);

    let ttl = s.env.as_contract(&s.contract.address, || {
        s.env
            .storage()
            .persistent()
            .get_ttl(&DataKey::TaxReserve(s.freelancer.clone()))
    });
    assert!(ttl >= TTL_THRESHOLD);
    assert_eq!(s.contract.tax_reserve(&s.freelancer), before);
}

#[test]
fn without_fee_the_whole_gross_stays_with_the_freelancer() {
    let s = setup();
    charge(&s, &s.freelancer, 500_0000000, "E001-13");

    // 460 in their wallet and 40 reserved in their name: the contract keeps nothing.
    assert_eq!(s.usdc.balance(&s.freelancer), 460_0000000);
    assert_eq!(s.contract.tax_reserve(&s.freelancer), 40_0000000);
    assert_eq!(s.usdc.balance(&s.fee_to), 0);
}

#[test]
fn the_service_fee_comes_out_of_the_gross() {
    // 50 basis points: 0.5% of 500 USDC is 2.50.
    let s = setup_with_fee(50);
    charge(&s, &s.freelancer, 500_0000000, "E001-14");

    assert_eq!(s.usdc.balance(&s.fee_to), 2_5000000);
    assert_eq!(s.contract.tax_reserve(&s.freelancer), 40_0000000);
    assert_eq!(s.usdc.balance(&s.freelancer), 457_5000000);
    // The gross still adds up: net + reserve + fee.
    assert_eq!(457_5000000i128 + 40_0000000 + 2_5000000, 500_0000000);
}

#[test]
fn the_tax_reserve_is_never_touched_by_the_fee() {
    let s = setup_with_fee(MAX_FEE_BPS);
    charge(&s, &s.freelancer, 500_0000000, "E001-15");

    // Even with the fee at its cap, the reserve is still 8% of the gross.
    assert_eq!(s.contract.tax_reserve(&s.freelancer), 40_0000000);
    assert_eq!(
        s.contract
            .month_gross(&s.freelancer, &s.contract.current_period(&s.freelancer)),
        500_0000000
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn rejects_a_fee_above_the_cap() {
    // The constructor rejects a fee above the cap, so that contract never exists.
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let fee_to = Address::generate(&env);

    env.register(Honorarios, (sac.address(), MAX_FEE_BPS + 1, fee_to));
}

// --- Receipts on the chain: only what the freelancer issued can be paid, and only once.

#[test]
fn pay_reads_the_amount_from_the_receipt() {
    let s = setup();
    let r = String::from_str(&s.env, "E001-20");
    s.contract.issue(
        &s.freelancer,
        &r,
        &250_0000000,
        &String::from_str(&s.env, "Logo"),
    );

    // The client does not say how much to pay: the contract charges what the receipt says.
    s.contract.pay(&s.payer, &s.freelancer, &r);

    assert_eq!(s.usdc.balance(&s.freelancer), 230_0000000);
    assert_eq!(s.contract.tax_reserve(&s.freelancer), 20_0000000);
}

#[test]
fn rejects_paying_a_receipt_nobody_issued() {
    let s = setup();

    let r = s.contract.try_pay(
        &s.payer,
        &s.freelancer,
        &String::from_str(&s.env, "E001-21"),
    );

    assert_eq!(r, Err(Ok(Error::UnknownReceipt)));
    assert_eq!(
        s.contract
            .month_gross(&s.freelancer, &s.contract.current_period(&s.freelancer)),
        0
    );
}

#[test]
fn a_receipt_cannot_be_paid_twice() {
    let s = setup();
    charge(&s, &s.freelancer, 100_0000000, "E001-22");

    let r = s.contract.try_pay(
        &s.payer,
        &s.freelancer,
        &String::from_str(&s.env, "E001-22"),
    );

    assert_eq!(r, Err(Ok(Error::AlreadyPaid)));
    assert_eq!(s.usdc.balance(&s.freelancer), 92_0000000);
}

#[test]
fn rejects_issuing_the_same_receipt_twice() {
    let s = setup();
    let r = String::from_str(&s.env, "E001-23");
    let c = String::from_str(&s.env, "Services");
    s.contract.issue(&s.freelancer, &r, &100_0000000, &c);

    // Reissuing with another amount would change what the client already saw, so it is refused.
    let again = s.contract.try_issue(&s.freelancer, &r, &900_0000000, &c);

    assert_eq!(again, Err(Ok(Error::ReceiptExists)));
    assert_eq!(
        s.contract.receipt(&s.freelancer, &r).unwrap().gross,
        100_0000000
    );
}

#[test]
fn the_receipt_records_that_it_was_paid() {
    let s = setup();
    let r = String::from_str(&s.env, "E001-24");
    s.contract.issue(
        &s.freelancer,
        &r,
        &100_0000000,
        &String::from_str(&s.env, "Web"),
    );
    assert!(!s.contract.receipt(&s.freelancer, &r).unwrap().paid);

    s.contract.pay(&s.payer, &s.freelancer, &r);

    let paid = s.contract.receipt(&s.freelancer, &r).unwrap();
    assert!(paid.paid);
    assert_eq!(paid.concept, String::from_str(&s.env, "Web"));
}

#[test]
fn rejects_empty_receipt_ref_and_long_concept() {
    let s = setup();
    let empty = String::from_str(&s.env, "");
    let ok_ref = String::from_str(&s.env, "E001-25");
    let long = String::from_str(
        &s.env,
        "A concept longer than eighty characters, to check that the contract always rejects it",
    );
    let concept = String::from_str(&s.env, "Services");

    let a = s
        .contract
        .try_issue(&s.freelancer, &empty, &100_0000000, &concept);
    let b = s
        .contract
        .try_issue(&s.freelancer, &ok_ref, &100_0000000, &long);

    assert_eq!(a, Err(Ok(Error::EmptyReceiptRef)));
    assert_eq!(b, Err(Ok(Error::ConceptTooLong)));
}

#[test]
#[should_panic(expected = "InvalidAction")]
fn issue_requires_the_freelancer_signature() {
    let s = setup_enforcing_auth();
    s.contract.issue(
        &s.freelancer,
        &String::from_str(&s.env, "E001-26"),
        &100_0000000,
        &String::from_str(&s.env, "Services"),
    );
}

#[test]
#[should_panic(expected = "InvalidAction")]
fn a_stranger_cannot_issue_receipts_in_someone_elses_name() {
    // Without this, a stranger could inflate the freelancer's monthly total by paying
    // made-up receipts. Signing for itself is not enough.
    let s = setup_enforcing_auth();
    let stranger = Address::generate(&s.env);
    let r = String::from_str(&s.env, "E001-27");
    let c = String::from_str(&s.env, "Services");
    s.env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &stranger,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &s.contract.address,
            fn_name: "issue",
            args: (s.freelancer.clone(), r.clone(), 100_0000000i128, c.clone()).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    s.contract.issue(&s.freelancer, &r, &100_0000000, &c);
}

// ---------------------------------------------------------------- v2: any rate, any time zone

#[test]
fn issue_requires_a_profile() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    let r = String::from_str(&s.env, "A-1");
    let res = s
        .contract
        .try_issue(&stranger, &r, &100_0000000, &String::from_str(&s.env, "x"));
    assert_eq!(res, Err(Ok(Error::NoProfile)));
}

#[test]
fn a_freelancer_elsewhere_uses_their_own_rate() {
    // 25%, an illustrative rate chosen by the freelancer, not a country's rule.
    let s = setup();
    let other = Address::generate(&s.env);
    s.contract.set_profile(&other, &2_500, &60);
    let net = charge(&s, &other, 400_0000000, "INV-7");
    assert_eq!(net, 300_0000000);
    assert_eq!(s.contract.tax_reserve(&other), 100_0000000);
}

#[test]
fn a_zero_rate_sends_everything_to_the_freelancer() {
    let s = setup();
    let other = Address::generate(&s.env);
    s.contract.set_profile(&other, &0, &0);
    assert_eq!(charge(&s, &other, 100_0000000, "Z-1"), 100_0000000);
    assert_eq!(s.contract.tax_reserve(&other), 0);
    assert_eq!(s.usdc.balance(&s.contract.address), 0);
}

#[test]
fn rejects_a_rate_above_the_cap_and_impossible_offsets() {
    let s = setup();
    let f = &s.freelancer;
    assert_eq!(
        s.contract.try_set_profile(f, &(MAX_TAX_BPS + 1), &0),
        Err(Ok(Error::TaxRateTooHigh))
    );
    assert_eq!(
        s.contract.try_set_profile(f, &800, &-721),
        Err(Ok(Error::InvalidUtcOffset))
    );
    assert_eq!(
        s.contract.try_set_profile(f, &800, &841),
        Err(Ok(Error::InvalidUtcOffset))
    );
    assert!(s.contract.try_set_profile(f, &MAX_TAX_BPS, &840).is_ok());
}

#[test]
fn changing_the_profile_never_alters_an_issued_receipt() {
    let s = setup();
    let r = String::from_str(&s.env, "E001-90");
    s.contract.issue(
        &s.freelancer,
        &r,
        &100_0000000,
        &String::from_str(&s.env, "Web"),
    );
    s.contract.set_profile(&s.freelancer, &3_000, &0);
    // The client pays what they saw: 8%, not 30%.
    assert_eq!(s.contract.pay(&s.payer, &s.freelancer, &r), 92_0000000);
    assert_eq!(s.contract.receipt(&s.freelancer, &r).unwrap().tax_bps, 800);
}

#[test]
fn each_freelancer_closes_the_month_in_their_own_time_zone() {
    // 2026-10-01 03:00 UTC: still September in Lima, already October in Madrid (UTC+2).
    let t = 1_790_830_800 - 2 * 3_600;
    assert_eq!(period_of(t, LIMA), 2026 * 12 + 8);
    assert_eq!(period_of(t, 120), 2026 * 12 + 9);
}

#[test]
#[should_panic(expected = "InvalidAction")]
fn set_profile_requires_the_freelancer_signature() {
    let s = setup_enforcing_auth();
    s.contract.set_profile(&s.freelancer, &5_000, &0);
}

#[test]
fn the_split_always_adds_up_for_any_rate_and_amount() {
    // Deterministic sweep: every gross and rate combination conserves the payment and keeps
    // the rounding doubt on the reserve's side.
    let s = setup();
    StellarAssetClient::new(&s.env, &s.usdc.address).mint(&s.payer, &100_000_0000000);
    let grosses: [i128; 7] = [1, 7, 99, 1_0000000, 123_4567891, 999_9999999, 3];
    let rates: [u32; 6] = [0, 1, 800, 1_234, 4_999, MAX_TAX_BPS];
    let mut n = 0;
    for rate in rates {
        let f = Address::generate(&s.env);
        s.contract.set_profile(&f, &rate, &0);
        for g in grosses {
            n += 1;
            let reserve_before = s.contract.tax_reserve(&f);
            let paid_before = s.usdc.balance(&f);
            let label = [b'S', b'0' + (n / 10) as u8, b'0' + (n % 10) as u8];
            let net = charge(&s, &f, g, core::str::from_utf8(&label).unwrap());
            let tax = s.contract.tax_reserve(&f) - reserve_before;
            assert_eq!(net + tax, g);
            assert_eq!(s.usdc.balance(&f) - paid_before, net);
            assert!(tax * 10_000 >= g * rate as i128);
            assert!((tax - 1) * 10_000 < g * rate as i128 || tax == 0);
        }
    }
}
