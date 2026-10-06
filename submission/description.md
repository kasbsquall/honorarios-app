Honorarios sets aside your taxes the moment a foreign client pays you.

Try it in one minute, no wallet needed: https://honorarios-stellar.vercel.app/?demo

The problem: when a client abroad pays a freelancer, the full amount arrives. Nobody withholds anything, and the tax or prepayment is due weeks or months later, by which time the money is often spent. At least seven tax systems make self-employed people prepay their own tax (US estimated tax, UK payments on account, India advance tax, Brazil carnê-leão, Mexico, the Philippines, Peru). The World Bank counts 154 to 435 million online gig workers. Products that set tax aside automatically exist, but they depend on US banks and US tax rules.

The solution: every payment goes through a Soroban contract. The freelancer chooses the share to reserve (up to 50%) and the time zone their tax month closes in. The client pays in USDC from any Stellar wallet, or with XLM through a path payment, and the contract splits it in the same transaction: the net to the freelancer, the reserve into a balance only the freelancer can withdraw. Each receipt keeps the rate it was issued with, so a later change never alters what the client saw. There is no admin key, and paying the same receipt twice is rejected by the network.

Peru is the first fully supported country: 8% income-tax prepayment, SUNAT's monthly threshold tracked from the official resolution, and a draft of the electronic fee receipt. In any other country the freelancer picks the percentage, and the app makes no claim about local law.

Built on Stellar: Soroban contract, Circle USDC through its Stellar Asset Contract, path payments on the DEX, passkey smart wallets with no seed phrase and sponsored fees, contract events for history, and a SEP-24 withdrawal tested with SDF's test anchor.

Proof:
- Live on mainnet with one real payment: 2 USDC split 1.84 / 0.16 in one transaction (the builder paid himself; this proves the contract, not traction).
- Verified build: the deployed wasm is the one GitHub Actions built and attested for tag v2.0.0 (SEP-55).
- Seven attacks rejected on testnet, each with its transaction; 39 contract tests and 38 frontend tests in CI; threat model in the repo.
- Sample dashboard with live testnet data, no wallet needed.

Business model: the freelancer pays a service fee on each payment, taken by the contract in the same split. The contract caps it at 1% in code and fixes it at deployment; this deployment charges 0 while there are no users. Accountants and freelancer communities are the first channel; the price has not been validated with anyone yet.

Clients who pay by bank transfer or Payoneer: today they need USDC in a Stellar wallet. The route we would build next is a fiat on-ramp on the client's side through a Stellar anchor (SEP-24 deposit), the same protocol the reserve already uses to leave. It is not built.

Built by a Peruvian freelancer paid in dollars by clients abroad.

Honest limits: no users yet, not audited, the client on-ramp is not built, and the app estimates the Peruvian prepayment but does not file taxes.
