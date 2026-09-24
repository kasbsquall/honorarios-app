# Contract deployment and test runs, September 24, 2026

Transactions sent to Stellar testnet on September 24, 2026 with the test accounts whose keys live
in `web/.env.development.local` (outside the repository). They come from
`web/scripts/seed-demo.mjs`, `web/scripts/rejections.mjs`, `web/e2e/passkey.mjs` and
`web/e2e/sep24.mjs`. Error codes were read from the diagnostic events returned by the testnet RPC
(`getTransaction`).

Contract: `CC6SGVMYAN3NY7PHFACMA4H4BZSOK2Q2NJ7Z64UJY3PTA4A2TJZOEU2H`, deployed in ledger 4853318 by
`274dbd9d24ffd27589edb3199d419a3d396071732ffe8c0fe40ee8e96727ee01`, with a service fee of 0 basis
points. Token: the USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.

Sample dashboard account (freelancer): `GBO7CDLI4L2AW4UQNFP5Z4KTUDHKP2K3P4EPU6VGCYCFD7IMCO3KEA3U`.
Test client: `GBC6WWAK5RN7VKXZQU5FR7C53BQJ3CXOTPYH5P3RK4BWDQZDVH2R6SJW`.
Deployer, which would receive the service fee: `GAYDIAOXIOYRBO6CBLRJSLIXBIAKZDXFCJSY7S5IH6GQMOPISLD6U5ZB`.

## Valid flow (`seed-demo.mjs`)

| Step | Transaction |
|---|---|
| Freelancer adds the USDC trustline | `1c88fa736ca746aac546dd3730666faa36996576a5616cd70aad9de94cfc187d` |
| Client buys USDC with XLM (path payment) | `4a64d5089758fb8619505f213c717613c37b7346d0b07c28ca24a11ff38029d6` |
| Issue E001-1, 500 USDC | `03661e88d5e2ef3d08a054e6491d13994c2b819ab65fcfa390d3e8a78d216e0d` |
| Pay E001-1 | `a72e762d37e6ec2870384f4a847b7d8a4cf266ba72cf3c5a3cf33b8a13647d2e` |
| Issue E001-2, 620 USDC | `efa29408ddaae2d7a6ab929e1f5d8a9b5bf34989e5f6f9aa24ca9d65984b4ac3` |
| Pay E001-2 | `fbe9ced870be630e22e3cc5bbe96f4d9cc8d598f0c7f8dedf9b07903c547a7c5` |
| Issue E001-3, 300 USDC | `ce419fa14bd4f559087402219c0bdeca61cadd53001048d916b7f598c707fe12` |
| Pay E001-3 | `3ac70dc549dfedc890a81d9162b3df5e22079bd4366eeded6f4fdb99feef5ad8` |
| Issue E001-4, 180 USDC, left unpaid | `bf05c4c0fe1573bc47b664dd5fea3c7e710b90eda6d00a7aa7920a4b920fe02e` |
| Withdraw 40 USDC from the reserve | `12a8b7b2ebfceddf08c5cc8f411b761ad59d1569c50c9d03ffe3f2143c92d2d7` |

State read with `check-demo.mjs` after this block: month gross 1,420.00 USDC, reserve 73.60 USDC.

## Attacks rejected by the network (`rejections.mjs`)

| Attempt | Transaction | Error |
|---|---|---|
| A third party withdraws the freelancer's reserve signing for itself | `a70d2e8e8dad1ea2573208f8fea826acb8e759c0402049e1000af6e9d514304b` | `Error(Auth, InvalidAction)` |
| The freelancer withdraws 1 unit more than the reserve | `89aae18f5b3db2e482e0f91aee7658be74aac53c2f16a3c00c595cd2b55a2cd5` | `Error(Contract, #2)` InsufficientReserve |
| A stranger issues a receipt in the freelancer's name | `9d636f0af561a53da8def42db43154d4f175a773c5fa33a403a402f6c818379f` | `Error(Auth, InvalidAction)` |
| The client pays a receipt nobody issued | `8b15a2041c9a63c83a8c53a591b6987870858e5d112030bef19de521c8b970b6` | `Error(Contract, #7)` UnknownReceipt |
| The client pays E001-1 again, already paid | `b1d7f36a02f6cbf79b3dfbbb4cd427ea45e71feb7e5268173f12199046a09d11` | `Error(Contract, #8)` AlreadyPaid |

## Passkey walkthrough (`passkey.mjs`)

Virtual WebAuthn authenticator, smart wallet `CALUQKFITWKN7KHREVPK7ERHUCV2KLQ6IHKR6JMCD6ZXQMILOBMBTZP7`.
Issue `bc6bec92cfd900db2947833f5eaa417e3a31808e6051188d2e8c12239fd78139`, payment by the test client
`e22cf150b6e72be964b28d74a601eeb46563038145c69ed6a61bfad4c489dc0f`, withdrawal of the 16.00 USDC
reserve signed with the passkey `b8b6e02dcedd1a86ebf651b633ca530df390c35eea3c1312d5b1d7f9ddb5074d`.

## Withdrawal through the SDF test anchor (`sep24.mjs`)

Sample dashboard account, 5 USDC. The anchor form was filled with made-up details (the test anchor
does not check identity or move real money). The anchor accepts 1 to 10 USDC per withdrawal
according to `https://testanchor.stellar.org/sep24/info`.

| Step | Transaction |
|---|---|
| Withdraw 5 USDC from the reserve to the freelancer's own account | `fe83e290085b5f1e2968f3b1c1022c351ec9f30ae2ec5a4c6b5b73745e3fc7a2` |
| Send 5 USDC to the anchor with the withdrawal memo | `27244891bc19085f61e83d70d008a597966d533260e3e481eeb6eeb699b6183f` |

Final status returned by the anchor: `completed`.

Sample dashboard state at the end: month gross 1,420.00 USDC, reserve 68.60 USDC.
