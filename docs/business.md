# How Honorarios pays for itself

This document keeps **published data** apart from **our own proposals**. Every figure presented as a fact carries its source. Market figures come from [`docs/discovery/2026-10-05-global-tax-gap.md`](discovery/2026-10-05-global-tax-gap.md), where each one is listed with its link and the date it was accessed.

## Who pays and how

The freelancer pays, and only when a client pays them. The contract can take a service fee out of the gross of each settled payment, alongside the net and the reserve:

- The fee is fixed at deployment in basis points. The constructor rejects anything above `MAX_FEE_BPS`, 100 basis points or 1% (`contracts/split/src/lib.rs`, test `rejects_a_fee_above_the_cap`).
- It is truncated down, while the reserve is rounded up, and it never comes out of the reserve (test `the_tax_reserve_is_never_touched_by_the_fee`).
- The payment page reads it with `fee()` and shows it itemized before the client signs, and every `Paid` event publishes the fee charged.
- **The current deployment charges 0.** Nobody pays anything today.

Earlier versions of this document proposed 0.5% per settled payment. That number came from comparing with what payment processors charge, and we have not asked a single freelancer whether they would pay it. It stays a proposal to test, below the 1% the contract allows.

A second payer is possible and also untested: a payment platform or an accounting firm that integrates the contract and pays for it on behalf of its users. The contract does not need to change for that, since the fee recipient is any address set at deployment.

## Why the fee lives in the contract

The freelancer can check what they will be charged before using the tool, and the client sees it before signing. The cap is in the constructor and a test pins it. The price cannot be changed after deployment. That is awkward to operate, because a new price means a new contract and a split in each user's history, and it is deliberate: someone who parks their tax money in a contract needs to know the rules will not shift under them.

## The market, from published sources only

| Data point | Value | Source |
|---|---|---|
| Online gig workers worldwide | 154 to 435 million, 4.4% to 12.5% of the global workforce; 132.5 million for whom it is the main job | World Bank, [Working Without Borders (2023)](https://thedocs.worldbank.org/en/doc/e538b081e65bd5f60f6f281dbcca7967-0460012023/original/Working-Without-Borders-The-Promise-and-Peril-of-Online-Gig-Work.pdf) |
| Freelancers who expanded their client base to new countries | 32% of over 2,000 surveyed in 122 countries (company survey, not official statistics) | [Payoneer 2023 Freelancer Insights Report](https://www.payoneer.com/resources/2023-global-freelancer-income-report/) |
| Tax systems where the self-employed must prepay on their own | United States, United Kingdom, India, Brazil, Mexico, Philippines, Peru | IRS, GOV.UK, Income Tax Department of India, Receita Federal, SAT, BIR and SUNAT, links in the discovery file |
| US tax reported on time and not paid on time, tax year 2022 | US$ 94 billion, all taxpayers | [IRS Publication 5869](https://www.irs.gov/pub/irs-pdf/p5869.pdf) |
| UK Self Assessment online Time to Pay arrangements, 6 April to 30 November 2025 | 17,955 | [HMRC, 9 December 2025](https://www.gov.uk/government/news/hmrc-offers-time-to-help-pay-your-tax-bill) |
| Peruvian service exports, January to June 2025 | US$ 3,634 million, of which US$ 698 million business services | Mincetur via [Infobae, 11/11/2025](https://www.infobae.com/peru/2025/11/11/exportacion-de-servicios-cada-vez-mas-peruanos-trabajan-para-otros-paises-sin-salir-de-casa-estas-son-las-6-profesiones-mas-demandadas-en-el-extranjero-segun-mincetur/) |
| Self-employed workers in Peru under 41 | more than 2.5 million | [INEI](https://m.inei.gob.pe/prensa/noticias/mas-de-2-millones-y-medio-de-trabajadores-independientes-de-menos-de-41-anos-son-potenciales-aportantes-a-las-administradoras-de-fondo-de-pensiones-7674/) |

What these figures do and do not say:

- The World Bank range covers all online gig work, domestic and cross-border. **We found no official figure for freelancers paid by foreign clients**, so we do not publish a market size, a share of that market or a revenue projection. The previous version of this document had a revenue range built on our own assumptions about Peru. It has been removed because the assumptions had no source.
- The IRS and HMRC figures show that paying tax late is common and costly. Neither isolates freelancers, and neither isolates people paid from abroad.
- Prior art exists and is US-specific: Found and Lili set money aside inside US bank accounts for US businesses. We found none serving a freelancer resident in Peru, Brazil, India or the Philippines who is paid by a foreign client. We did not check whether they accept non-US residents without a US entity.

## Go-to-market

None of these channels has been tried. They are listed in the order we would test them.

1. **Accountants who serve freelancers.** An accountant who recommends the tool to their clients gets a reserve that already exists when the filing is due, and a list of receipts read from the chain. This is also the cheapest way to learn whether the Peru logic is right, since they would notice an error first.
2. **Freelancer communities.** Designer, developer and translator groups where people paid from abroad already compare payment platforms. The pitch is concrete: the share you choose is set aside on every payment, and only you can withdraw it.
3. **Payment platforms and wallets.** A platform that already moves USDC to freelancers on Stellar could call `pay` instead of a plain transfer and offer the reserve as a feature. This is the channel that would reach countries beyond Peru, and it is the one where the 1% cap matters most, because the platform would want to know its users cannot be charged more.

Expansion to another country follows the same rule as Peru: a preset with threshold logic is added only after its rate and threshold are verified at an official source. Until then, freelancers there use their own percentage. Colombia, for example, appears in the discovery file only through press coverage, so it is not a candidate yet.

## What is not validated

- **No users.** Nobody has been paid through this app outside of test accounts.
- **No pricing interviews.** We do not know whether a freelancer would pay a fee, how much, or from what amount.
- **No accountant or platform has seen it.** The go-to-market above is a plan.
- **No legal analysis** of holding third-party funds in a contract, in Peru or elsewhere.
- **No on-ramp.** A client without USDC or XLM on Stellar cannot pay yet.
- **No figure for the core segment.** Freelancers paid by foreign clients are not counted separately in any official source we found.

We would rather show these gaps than fill them with estimates.
