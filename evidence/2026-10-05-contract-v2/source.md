# Contract v2 deployment and test runs, October 5, 2026

Transactions sent to Stellar testnet on October 5, 2026 with the test accounts whose keys live
in `web/.env.development.local` (outside the repository). They come from
`web/scripts/seed-demo.mjs`, `web/scripts/rejections.mjs` and `web/e2e/passkey.mjs`. Error codes
were read from the diagnostic events returned by the testnet RPC (`getTransaction`).

Contract v2: `CCLAMGX6EACGRA3D3FSFARER7V4KZUFY54M52AZ4UDXPVR47GVRE7HM4`, deployed from the wasm
published by the GitHub release workflow for tag `v2.0.0` (release
`v2.0.0_contracts_split_split_cli28.1.0`, wasm SHA-256
`3d6e9ff20db5f3f482453d6d421afdb7167234660422313f288ea6c801ed31a3`, build attested by GitHub), so
the deployed code can be checked against the source (SEP-55). Service fee 0 basis points. Token:
the USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.

An earlier v2 deployment built locally, `CC7KBXFH63D3CAORQVM4JZEWQW7IBNUK4O5ZLYUETF2MFLNT7PASPA5K`,
ran the same scripts first; the passkey walkthrough at the end of this file is from that run.

Changes against v1: each freelancer sets a profile (`set_profile`: reserve rate up to 50% and the
UTC offset of their tax month), `issue` refuses without a profile (#13 NoProfile), and every
receipt stores the rate and offset in force when it was issued.

Sample dashboard account (freelancer): `GBO7CDLI4L2AW4UQNFP5Z4KTUDHKP2K3P4EPU6VGCYCFD7IMCO3KEA3U`.
Test client: `GBC6WWAK5RN7VKXZQU5FR7C53BQJ3CXOTPYH5P3RK4BWDQZDVH2R6SJW`.

## Valid flow (`seed-demo.mjs`)

| Step | Transaction |
|---|---|
| Client buys USDC with XLM (path payment) | `9249a792970183152c8ad65d86bdbacb2731ce66ad26d74e1e5d2ab34efd1836` |
| Freelancer sets the Peru preset (800 bps, UTC-5) | `3290d413d201b3a337e5f6fbd065cc53ed64b91514fa6ba45ea0e526429c5e63` |
| Issue E001-1, 500 USDC | `bef5d2e038c982af302ed4e070ebeb49801ee9a93cc260cdc39f451ff188fa52` |
| Pay E001-1 | `c5f571e3da225f3c1e768c23699db7ac2263b6103804947eaf4ce969c4d485d0` |
| Issue E001-2, 620 USDC | `955c49780140d45c9f9ab05a3bc93de3df04b9c4ed989b0b448562afafacde94` |
| Pay E001-2 | `899de48dd856170f4fd6ebdc962ea06aeda47eae7df2f637b95c03090142f65f` |
| Issue E001-3, 300 USDC | `1e35544f953d4edac0264c7d2ca5d95aced594a1ca64c9862da0bedcc584f987` |
| Pay E001-3 | `5d57aaa16bbea12380be15e25986c5d34bf65cf78d60f0b3fbce11d37fa72be3` |
| Issue E001-4, 180 USDC, left unpaid | `9aac5818929eb5e46011a967180433f7469449bf135299d97492b54977738784` |
| Withdraw 40 USDC from the reserve | `0cbceb954f15dbb89e5c85dc86fc4d930840697ab676ec969f6d08251ceea0ed` |

State read with `check-demo.mjs` after this block: profile 8% at UTC-5, month gross 1,420.00 USDC,
reserve 73.60 USDC.

## Attacks rejected by the network (`rejections.mjs`)

| Attempt | Transaction | Error |
|---|---|---|
| A third party withdraws the freelancer's reserve signing for itself | `8a028259003c95a766fc89c3be9dbb896856db8c61ab83945f583da5d568c86a` | `Error(Auth, InvalidAction)` |
| The freelancer withdraws 1 unit more than the reserve | `4b57730952e1086046786b53dfc67a349e9a50ce104e2aeb663f0d7f9a8cb69a` | `Error(Contract, #2)` InsufficientReserve |
| A stranger issues a receipt in the freelancer's name | `0c34d7b63848d075fa18f0fa22d60b07bf1293d15810b6acdee754fdfaa4942b` | `Error(Auth, InvalidAction)` |
| The client pays a receipt nobody issued | `dc09e86b6ea69328637ae3ed54a00d8b93818e458f9f5faf1c8a2d3ababa4339` | `Error(Contract, #7)` UnknownReceipt |
| The client pays E001-1 again, already paid | `9555112704d3c5a6f0a4d85958c7e81aca5a014d5b6326b1c79cb6b7cf042f85` | `Error(Contract, #8)` AlreadyPaid |
| The freelancer sets a 50.01% reserve | `e46eed49bee6d255ff471eb162ac11f749c9ef4db731cef50e1003bdfbe231ba` | `Error(Contract, #11)` TaxRateTooHigh |
| A freelancer with no profile issues a receipt | `5f4402b1ca117df324bb5cf50bf1ef137a3276383682db0d079a9ee9e4fef21b` | `Error(Contract, #13)` NoProfile |

## A receipt keeps the rate it was issued with (`rejections.mjs`)

Fresh freelancer `GBODAA25GCURCCNRVS4KD5JPT36DIJGGCEKNQ5QEPCQZ2BXSAR64ZX7Q`, funded with friendbot.
The receipt is issued at 10%, the profile is then changed to 20%, and the client pays. The receipt
read back stores `tax_bps` 1000 and the reserve after payment is 10.00 USDC, so the payment used the
rate the client saw.

| Step | Transaction |
|---|---|
| USDC trustline | `3e499c926d361eb52eb65239ed7240657a0c0b0c6ae606044e9e5e088ae98320` |
| `set_profile` 1000 bps, UTC+0 | `de670660b22e23bd9561f8022b1b5faa699d9443a0e74c33fa538055e1176111` |
| Issue S-1, 100 USDC | `feba6f77b4d0643d331506c20f9e024ce8dbb3e2cb779c3804eae40f5d726805` |
| `set_profile` 2000 bps, UTC+0 | `c81925d44baa6fc5c6451e72c1bd51e33bbd0a66bd0396a82b1875a084b1cbb7` |
| Client pays S-1: 90 net, 10 reserve | `1ac7b5fc47e6e06ff83a2283bfee73313b740700eb896333442b7924bc9e895b` |

## Passkey walkthrough (`passkey.mjs`, earlier v2 deployment `CC7KBXFH…PA5K`)

Virtual WebAuthn authenticator, smart wallet `CD6A4I4QRZZZJCDOZTZOSVLQY5CUZ4DVLAV4WUYLYZ3XBB4ZY7M6CVSJ`.
The new wallet had no profile, so the panel opened the "Where do you pay taxes?" step first.
Peru preset saved with the passkey `7ede4f88b9034bf29addb18da12be64de8b58fe3d6a80295458b99aabb5c533e`,
issue `07e20808c6d16cd90f2db6188b66a52fe93ba8829cfb90121a1ae61d51b4a9a6`, payment by the test client
`251c47ac9abe9084d47d3f34c427780bea4a7b9c4b2674e434731140355f646c`, withdrawal of the 16.00 USDC
reserve signed with the passkey `9756356931b7b0249b94c8bc8642b014c41a06fa37983d53bcff0be8092c0ca8`.
