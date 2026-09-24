// Five attacks against the current contract, sent to testnet for real. Each one stays on
// the chain as a FAILED transaction: anyone can open it in Stellar Expert and see that the
// network rejected it. Needs seed-demo.mjs to have run first (it uses E001-1, paid, and
// E001-4, pending). Every run creates new transactions.
import {
  DEMO, addr, client, forceFailing, freelancer, i128, read, receiptKey, sourceAuth, str, usdc,
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
];

for (const c of cases) {
  const r = await forceFailing(c.signer, c);
  console.log(`${r.status.padEnd(7)} ${r.hash}  ${c.what}${r.reason ? `  [${r.reason}]` : ""}`);
}
