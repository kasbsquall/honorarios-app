// Leaves the sample panel's account with a month that crosses the S/ 4,010 threshold, plus
// one issued and unpaid receipt so anyone can try the payment page. Without this the sample
// shows the dull case ("you owe nothing"), which is exactly the month the product is not
// needed. Everything is real and stays on the chain. It can be rerun: it skips what is done.
import { CONTRACT, DEMO, addr, client, ensureClientUsdc, ensureTrustline, freelancer, i128, invoke, read, str, usdc } from "./chain.mjs";

if (freelancer.publicKey() !== DEMO) throw new Error("The sample panel's account is not the test freelancer's account.");

const RECEIPTS = [
  { ref: "E001-1", amount: "500.00", concept: "Brand identity design", pay: true },
  { ref: "E001-2", amount: "620.00", concept: "Website redesign", pay: true },
  { ref: "E001-3", amount: "300.00", concept: "Editorial illustration", pay: true },
  { ref: "E001-4", amount: "180.00", concept: "October website maintenance", pay: false },
];
// Withdrawal before the month closes: the panel uses it to show the short-reserve warning.
const WITHDRAWAL = "40.00";

console.log(`contract ${CONTRACT}\nfreelancer ${DEMO}\nclient ${client.publicKey()}`);
const toPay = RECEIPTS.filter((r) => r.pay).reduce((a, r) => a + Number(r.amount), 0);
const trust = await ensureTrustline(freelancer);
if (trust) console.log(`freelancer USDC trustline: ${trust}`);
const bought = await ensureClientUsdc(toPay + 200);
if (bought) console.log(`client USDC purchase: ${bought}`);

for (const r of RECEIPTS) {
  let rec = await read("receipt", addr(DEMO), str(r.ref));
  if (!rec) {
    const h = await invoke(freelancer, "issue", addr(DEMO), str(r.ref), i128(usdc(r.amount)), str(r.concept));
    console.log(`issued ${r.ref} for ${r.amount} USDC: ${h}`);
    rec = { paid: false };
  }
  if (r.pay && !rec.paid) {
    const h = await invoke(client, "pay", addr(client.publicKey()), addr(DEMO), str(r.ref));
    console.log(`paid ${r.ref}: ${h}`);
  }
}

const reserve = await read("tax_reserve", addr(DEMO));
// 8% of 1,420 USDC is 113.6: if the reserve is still whole, the withdrawal has not happened yet.
if (reserve === usdc("113.6")) {
  const h = await invoke(freelancer, "withdraw_tax", addr(DEMO), addr(DEMO), i128(usdc(WITHDRAWAL)));
  console.log(`withdrawal of ${WITHDRAWAL} USDC from the reserve: ${h}`);
}
console.log(`final reserve ${(Number(await read("tax_reserve", addr(DEMO))) / 1e7).toFixed(2)} USDC`);
