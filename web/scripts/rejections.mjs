// Seven attacks against the current contract, sent to testnet for real. Each one stays on
// the chain as a FAILED transaction: anyone can open it in Stellar Expert and see that the
// network rejected it. Needs seed-demo.mjs to have run first (it uses E001-1, paid, and
// E001-4, pending). Every run creates new transactions.
import { Keypair } from "@stellar/stellar-sdk";
import {
  DEMO, addr, client, ensureTrustline, forceFailing, freelancer, i128, i32, invoke, profileKey, read, receiptKey, sourceAuth, str, u32, usdc,
} from "./chain.mjs";

const C = client.publicKey();
const F = freelancer.publicKey();
const reserve = await read("tax_reserve", addr(F));
if (DEMO !== F || reserve <= 0n) throw new Error("Run scripts/seed-demo.mjs first");
// Valid template from the client: paying the pending receipt. It gives the footprint of a payment.
const payTemplate = { fn: "pay", args: [addr(C), addr(F), str("E001-4")] };

const cases = [
  {
    what: "A third party tries to withdraw the freelancer's reserve by signing for itself",
    signer: client,
    fn: "withdraw_tax",
    args: [addr(F), addr(C), i128(usdc("10"))],
    template: { fn: "withdraw_tax", args: [addr(F), addr(C), i128(usdc("10"))] },
  },
  {
    what: "The freelancer tries to withdraw 1 unit more than the reserve holds",
    signer: freelancer,
    fn: "withdraw_tax",
    args: [addr(F), addr(F), i128(reserve + 1n)],
    auth: [sourceAuth("withdraw_tax", [addr(F), addr(F), i128(reserve + 1n)])],
    template: { fn: "withdraw_tax", args: [addr(F), addr(F), i128(1n)] },
  },
  {
    what: "A stranger issues a receipt in the freelancer's name to inflate their monthly total",
    signer: client,
    fn: "issue",
    args: [addr(F), str("E001-666"), i128(usdc("5000")), str("Made-up charge")],
    template: { fn: "issue", args: [addr(F), str("E001-666"), i128(usdc("5000")), str("Made-up charge")] },
  },
  {
    what: "The client tries to pay a receipt nobody issued",
    signer: client,
    fn: "pay",
    args: [addr(C), addr(F), str("E001-99")],
    auth: [sourceAuth("pay", [addr(C), addr(F), str("E001-99")])],
    template: payTemplate,
    extraReadOnly: [receiptKey(F, "E001-99")],
  },
  {
    what: "The client tries to pay receipt E001-1 twice, and it is already paid",
    signer: client,
    fn: "pay",
    args: [addr(C), addr(F), str("E001-1")],
    auth: [sourceAuth("pay", [addr(C), addr(F), str("E001-1")])],
    template: payTemplate,
    extraReadOnly: [receiptKey(F, "E001-1")],
  },
  {
    what: "The freelancer tries to set a 50.01% reserve, over the contract's 50% cap",
    signer: freelancer,
    fn: "set_profile",
    args: [addr(F), u32(5001), i32(-300)],
    auth: [sourceAuth("set_profile", [addr(F), u32(5001), i32(-300)])],
    template: { fn: "set_profile", args: [addr(F), u32(800), i32(-300)] },
  },
];

// A brand-new freelancer with no profile tries to issue a receipt: the contract refuses
// instead of guessing a rate. Funded on the fly with friendbot.
const fresh = Keypair.random();
await fetch(`https://friendbot.stellar.org/?addr=${fresh.publicKey()}`);
const N = fresh.publicKey();
cases.push({
  what: "A freelancer with no tax profile tries to issue a receipt",
  signer: fresh,
  fn: "issue",
  args: [addr(N), str("X-1"), i128(usdc("100")), str("No rate chosen")],
  auth: [sourceAuth("issue", [addr(N), str("X-1"), i128(usdc("100")), str("No rate chosen")])],
  template: { fn: "issue", args: [addr(F), str("X-1"), i128(usdc("100")), str("No rate chosen")] },
  extraReadOnly: [profileKey(N), receiptKey(N, "X-1")],
});

for (const c of cases) {
  const r = await forceFailing(c.signer, c);
  console.log(`${r.status.padEnd(7)} ${r.hash}  ${c.what}${r.reason ? `  [${r.reason}]` : ""}`);
}

// v2 check, with successful transactions: a receipt keeps the rate it was issued with.
// The fresh freelancer issues at 10%, then changes the profile to 20%, and the client pays.
// The Paid event must say 1000 bps and the reserve must hold 10 USDC, not 20.
console.log("\nRate snapshot check");
const t = await ensureTrustline(fresh);
if (t) console.log(`fresh freelancer USDC trustline   ${t}`);
console.log(`set_profile 10%, UTC+0             ${await invoke(fresh, "set_profile", addr(N), u32(1000), i32(0))}`);
console.log(`issue S-1 for 100 USDC             ${await invoke(fresh, "issue", addr(N), str("S-1"), i128(usdc("100")), str("Rate snapshot test"))}`);
console.log(`set_profile 20%, UTC+0             ${await invoke(fresh, "set_profile", addr(N), u32(2000), i32(0))}`);
const rec = await read("receipt", addr(N), str("S-1"));
console.log(`receipt S-1 stored tax_bps         ${rec.tax_bps}`);
console.log(`client pays S-1                    ${await invoke(client, "pay", addr(C), addr(N), str("S-1"))}`);
const res = await read("tax_reserve", addr(N));
console.log(`fresh freelancer ${N}`);
console.log(`reserve after payment              ${(Number(res) / 1e7).toFixed(2)} USDC (expected 10.00)`);
if (res !== usdc("10")) throw new Error("The payment did not use the receipt's rate");
