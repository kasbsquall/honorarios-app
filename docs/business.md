# How Honorarios pays for itself

This document deliberately keeps **published data** apart from **our own assumptions**. No figure without a source appears here as a fact.

## The price

The contract can charge a fee on each settled payment. The fee is implemented, tested and has a hard cap of 1% that the constructor refuses to exceed (`contracts/split/src/lib.rs`, test `rejects_a_fee_above_the_cap`). **It is currently deployed at zero.**

The price we propose for production is **0.5% of the gross of each settled payment**, with no monthly fee. It is paid only when there is income, which is the only way a freelancer with slow months keeps using the tool.

**What it compares against.** Getting paid from abroad through the traditional route today costs the payment platform's fee plus the bank's exchange spread when converting to soles. The exact amount depends on the bank and the corridor, and we have no measurement of our own to cite, so we do not put a savings percentage here. What can be verified on chain is what a payment through this app costs: the network fees of the transactions in the README's evidence table, which on testnet are sponsored by SDF's relayer.

## Market size

### What is data

| Data point | Value | Source |
|---|---|---|
| Peruvian service exports, January to June 2025 | US$ 3,634 million (+7.5% year over year) | Mincetur (Peru's Ministry of Foreign Trade and Tourism), via [Infobae, 11/11/2025](https://www.infobae.com/peru/2025/11/11/exportacion-de-servicios-cada-vez-mas-peruanos-trabajan-para-otros-paises-sin-salir-de-casa-estas-son-las-6-profesiones-mas-demandadas-en-el-extranjero-segun-mincetur/) |
| Of that total, business services | US$ 698 million in the half-year | same source |
| Self-employed workers in Peru under 41 | more than 2.5 million | [INEI](https://m.inei.gob.pe/prensa/noticias/mas-de-2-millones-y-medio-de-trabajadores-independientes-de-menos-de-41-anos-son-potenciales-aportantes-a-las-administradoras-de-fondo-de-pensiones-7674/) (Peru's national statistics institute) |
| Self-employed workers with a RUC (taxpayer registration number) | 13.3% | INEI, [Perfil del Trabajador Independiente](https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1537/cap11.pdf) (profile of the self-employed worker) |
| UIT 2026 (Peru's tax reference unit) | S/ 5,500 | [D.S. 301-2025-EF, El Peruano](https://busquedas.elperuano.pe/dispositivo/NL/2469116-1) (supreme decree, published in the official gazette) |

### What is our assumption

We have not found a public breakdown of how much of Peru's service exports is billed by self-employed individuals rather than companies. That is the missing figure, and we say so instead of filling it in.

Starting from annualized business services (US$ 698 M × 2 ≈ **US$ 1,396 million**):

| Assumption | Range | Why |
|---|---|---|
| Share billed by self-employed individuals | 5% to 12% | Companies export the bulk; the self-employed are the long tail. This is our own estimate. |
| Annual volume in freelancers' hands | US$ 70 M to US$ 168 M | follows from the row above |
| Share willing to be paid in USDC today | 3% to 8% | the barrier is crypto adoption |
| Volume reachable in the short term | US$ 2.1 M to US$ 13.4 M a year | |
| Revenue at 0.5% | **US$ 10,500 to US$ 67,000 a year** | |

That is a business for one person. **The larger case is outside Peru.** A prepayment with no withholding agent is an analogous problem in Mexico, Colombia and Argentina, where the number of freelancers paid in dollars is of a different order. Peru is the wedge: the hard part, which is the contract and the calculation with its cited regulation, gets rewritten per country, and the Stellar rail stays the same.

### What is missing to defend this in front of an investor

1. The breakdown of service exports by type of provider. Without it, the first row of assumptions is an informed guess.
2. Ten interviews with freelancers saying whether they would pay 0.5% and from what amount.
3. One user who has been paid and filed their taxes with this.

We have none of the three. Saying so is more useful than inventing a TAM.

## Why the fee lives in the contract

Because the freelancer can check what they will be charged before using the tool: `fee()` is a public function, the payment page reads it from the chain before showing the itemized breakdown the client signs, and the `Paid` event publishes the fee of each payment. The 1% cap is in the constructor, and a test pins it.

The price is set at deployment and cannot be changed afterwards. That is awkward to operate, because changing the price means deploying another contract, and it is deliberate: a user who parks their tax money in a contract needs to know the rules will not shift under their feet.
