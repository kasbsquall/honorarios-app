# Threat model

Scope: the `split` contract v2 (`contracts/split/src/lib.rs`) and the frontend in `web/` as deployed on Stellar testnet. The contract ID is in the README, under "Verify it in 2 minutes". Transaction hashes below come from [`evidence/2026-10-05-contract-v2/source.md`](../evidence/2026-10-05-contract-v2/source.md). Test names refer to `contracts/split/src/test.rs`.

**This code has not been audited.** Nothing here replaces an independent review.

## Assets

| Asset | Where it lives |
|---|---|
| The reserve of each freelancer, in USDC | Balance of the contract, accounted per freelancer under `TaxReserve(freelancer)` |
| The net of each payment | Sent straight to the freelancer's wallet in `pay`; the contract never holds it |
| Receipts: amount, description, stored rate and offset, paid flag | `Receipt(freelancer, receipt_ref)` in persistent storage |
| The profile: reserve rate and tax-month time zone | `Profile(freelancer)` |
| The monthly total, used for the Peru threshold | `MonthGross(freelancer, period)` |
| The freelancer's signing key | A passkey in the device's authenticator (smart account) or a Freighter key. Never on our servers |

## Actors

- **Freelancer.** Sets the profile, issues receipts, withdraws the reserve. Trusted for their own funds only.
- **Client (payer).** Pays a receipt. Untrusted.
- **Third party.** Anyone else with a Stellar account. Untrusted.
- **Deployer.** Chose the token and the fee at deployment. Has no role after that: there is no admin, setter or upgrade function.
- **External services**, covered in the next section.

## Trust assumptions

| Component | What we rely on | What happens if it fails |
|---|---|---|
| **USDC issuer (Circle)** | That USDC keeps its value and stays transferable | The issuer can freeze an account's USDC and claw it back, and the contract cannot prevent it. That applies to the reserve held by the contract too. A freeze would block `pay` and `withdraw_tax`. This is a property of the asset, accepted by choosing USDC |
| **Token address** | That the token set in the constructor is the real USDC SAC | It is fixed at deployment and readable with `token()`. A deployment with another token would be a different contract, and the app reads the contract ID from `web/src/stellar.ts` |
| **Relayer (OpenZeppelin Channels, run by SDF on testnet)** | That it submits the passkey wallet's transactions and sponsors their fees | It cannot sign for the freelancer, so it cannot move a reserve. It can refuse or delay a transaction. Freighter users do not depend on it. On testnet it is free for as long as SDF runs it |
| **`smart-account-kit` and the smart account contracts** | That the passkey (secp256r1) verification is correct | A bug there could let someone sign as the freelancer. According to its own README it has no independent audit |
| **RPC** | That `getEvents`, `getLedgerEntries` and simulation return the real chain state | A lying RPC could show the wrong reserve or receipt list on screen. It cannot make the contract accept an unauthorized call, because the network checks signatures. Testnet keeps events for about a week, after which the payment detail cannot be rebuilt |
| **Frontend (Vercel)** | That the served JavaScript is the code in this repo | A compromised frontend could show a different amount or ask the user to sign a different call. The contract limits the damage: `pay` charges the amount stored in the receipt, whatever the page shows, and a withdrawal still needs the freelancer's signature on the exact call. A wallet that displays the call before signing is the last check |
| **Anchor (SEP-10/SEP-24)** | That it pays out the local currency after receiving USDC | Once the freelancer sends USDC to the anchor, the contract has no further role. On testnet the anchor is SDF's test anchor and pays nothing real |

## Attacks and how the contract handles them

| Attack | Handling | Test | Testnet transaction |
|---|---|---|---|
| A third party withdraws someone else's reserve, signing for themselves | `withdraw_tax` calls `freelancer.require_auth()` | `a_third_party_cannot_withdraw_someone_elses_reserve`, `withdraw_requires_the_freelancer_signature` | `8a028259003c95a766fc89c3be9dbb896856db8c61ab83945f583da5d568c86a`, `Error(Auth, InvalidAction)` |
| The freelancer withdraws more than their reserve, reaching into other users' funds | Balance checked per freelancer before transfer | `cannot_withdraw_more_than_reserve` | `4b57730952e1086046786b53dfc67a349e9a50ce104e2aeb663f0d7f9a8cb69a`, `Error(Contract, #2)` |
| A stranger issues receipts in the freelancer's name to inflate their monthly total | `issue` requires the freelancer's signature | `a_stranger_cannot_issue_receipts_in_someone_elses_name`, `issue_requires_the_freelancer_signature` | `0c34d7b63848d075fa18f0fa22d60b07bf1293d15810b6acdee754fdfaa4942b`, `Error(Auth, InvalidAction)` |
| The client pays a receipt that was never issued | `pay` looks up the receipt and fails without it | `rejects_paying_a_receipt_nobody_issued` | `dc09e86b6ea69328637ae3ed54a00d8b93818e458f9f5faf1c8a2d3ababa4339`, `Error(Contract, #7)` |
| The client pays the same receipt twice | Paid flag set before any transfer | `a_receipt_cannot_be_paid_twice` | `9555112704d3c5a6f0a4d85958c7e81aca5a014d5b6326b1c79cb6b7cf042f85`, `Error(Contract, #8)` |
| The client edits the link to pay less | The amount comes from the stored receipt, never from the caller | `pay_reads_the_amount_from_the_receipt` | |
| A receipt number is reissued with a different amount | `issue` refuses an existing key | `rejects_issuing_the_same_receipt_twice` | |
| The freelancer, or a compromised app, sets an absurd rate | `set_profile` caps the rate at 5,000 bps and the offset at UTC-12 to UTC+14 | `rejects_a_rate_above_the_cap_and_impossible_offsets` | `e46eed49bee6d255ff471eb162ac11f749c9ef4db731cef50e1003bdfbe231ba`, `Error(Contract, #11)` |
| The profile is changed after the client saw the receipt, so the client pays a different split | Rate and offset are copied into the receipt at issue time | `changing_the_profile_never_alters_an_issued_receipt` | Issued at 10% `feba6f77b4d0643d331506c20f9e024ce8dbb3e2cb779c3804eae40f5d726805`, changed to 20% `c81925d44baa6fc5c6451e72c1bd51e33bbd0a66bd0396a82b1875a084b1cbb7`, paid with 10.00 reserved `1ac7b5fc47e6e06ff83a2283bfee73313b740700eb896333442b7924bc9e895b` |
| Someone changes a freelancer's profile | `set_profile` requires the freelancer's signature | `set_profile_requires_the_freelancer_signature` | |
| A receipt is issued before any rate was chosen | `issue` returns `NoProfile` | `issue_requires_a_profile` | `5f4402b1ca117df324bb5cf50bf1ef137a3276383682db0d079a9ee9e4fef21b`, `Error(Contract, #13)` |
| The payer and freelancer are the same address, or the contract itself is the freelancer | `InvalidParty` | `rejects_payer_as_freelancer`, `rejects_contract_as_freelancer` | |
| Rounding drains the reserve over many payments | Reserve rounds up, fee rounds down, net takes the remainder; a sweep checks the parts add up to the gross for several rates and amounts | `the_reserve_rounds_up`, `the_split_always_adds_up_for_any_rate_and_amount`, `the_contract_never_owes_more_than_it_holds` | |
| A huge amount overflows the multiplication | `issue` rejects a gross above `MAX_GROSS` | `rejects_amounts_that_would_overflow_the_tax` | |
| The deployer charges a large fee | Constructor rejects more than 100 bps, and the fee never comes out of the reserve | `rejects_a_fee_above_the_cap`, `the_tax_reserve_is_never_touched_by_the_fee` | |
| The reserve entry is archived after a long idle period | Every operation renews the TTL, and anyone can call `extend_reserve` without moving funds | `pay_extends_reserve_ttl`, `extend_reserve_renews_the_ttl_without_moving_funds` | |

All authorization tests run with the environment in strict mode and no signature granted (`set_auths(&[])`).

## Residual risks

- **Issuer powers.** Circle can freeze or claw back the USDC in the contract. We cannot mitigate this while the asset is USDC.
- **Wrong rate.** The contract accepts any rate up to 50%. Outside the Peru preset, nothing checks that the rate matches the freelancer's tax law, and the app does not claim to know it.
- **Peru threshold inputs.** Income outside the app, the exchange rate and prior withholdings are typed by hand. A mistake changes the estimate, and the withholdings field has no bound.
- **Archived state.** If nobody touches a reserve for longer than its TTL, the entry is archived and needs a restore before it can be withdrawn. The funds stay recoverable, and the withdrawal takes an extra restore step.
- **Immutability cuts both ways.** There is no admin to pause the contract if a bug is found. The response would be a new deployment and asking users to withdraw from the old one, which only they can do.
- **Verified build pending.** The current testnet deployment was not built by the release workflow, so its wasm cannot yet be matched to a tagged release through SEP-55.
- **Off-chain dependencies.** Passkey verification code, the relayer and the RPC are outside this repo and, per their READMEs, not independently audited.
- **Phishing.** A fake payment page could ask a client to pay a different contract. The real page reads the receipt from the contract ID in `web/src/stellar.ts`; a client who does not check the domain is not protected by the contract.
- **Regulatory.** Holding funds for third parties may make the operator a reporting entity in some countries, Peru included. No legal analysis has been done.
