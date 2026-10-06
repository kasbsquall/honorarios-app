# First real payment on Stellar mainnet, October 6, 2026

Contract: `CBXE3Z563JXVWEQ6LA5OV2JBRFVDIWNGXDQC77AUWMIDWU25CDW4CLQ4`, deployed on mainnet from the
wasm published by the release workflow for tag `v2.0.0` (SHA-256
`3d6e9ff20db5f3f482453d6d421afdb7167234660422313f288ea6c801ed31a3`). Service fee 0. Token: Circle's
USDC (issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, home domain circle.com),
Stellar Asset Contract `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`.

Run by the builder with `scripts/mainnet_run.py`, paying himself: one account as freelancer, one as
client, both funded from his own wallet. Real money, small amount. This proves the contract works on
mainnet; it is not user traction.

| Step | Transaction |
|---|---|
| Deploy (upload and create) | [`1c99f252…c7fd`](https://stellar.expert/explorer/public/tx/1c99f25209b8229a58b012c217f3018c098b68fd7bb440215de258e78598c7fd) |
| Client buys 2 USDC with XLM on the Stellar DEX | [`909d8045…6509`](https://stellar.expert/explorer/public/tx/909d8045d0720b09ab77eb5fad01aea0f30fb298558f0d065aa1488a48866509) |
| Freelancer sets the Peru preset (8%, UTC-5) | [`5bc19552…6287`](https://stellar.expert/explorer/public/tx/5bc19552881eb342d2c6233a82c56476e49ee82e5747a95eb69012a304876287) |
| Freelancer issues receipt MAIN-1 for 2 USDC | [`56297549…e909`](https://stellar.expert/explorer/public/tx/562975492538d007f17106b1e9c434a0699126761ac4fbf649f115495669e909) |
| Client pays MAIN-1: 1.84 USDC to the freelancer, 0.16 USDC to the reserve, one transaction | [`929c4cbc…7d98`](https://stellar.expert/explorer/public/tx/929c4cbc3b0101e095162aa7d5d21b633531e14a1482e040a73d1613dd127d98) |
| Freelancer withdraws the 0.16 USDC reserve | [`bda44801…1979`](https://stellar.expert/explorer/public/tx/bda4480113b37755bc923feb1981d5f1df99265c3eaf07afa8ac3888d0de1979) |

Cost: uploading the 12,357-byte wasm took about 14 XLM of the total, almost all of it storage rent
for the code on the network. Afterwards both test accounts were merged back into the builder's wallet.
