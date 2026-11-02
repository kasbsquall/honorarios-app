// Leaves the sample panel's account with a month that crosses the S/ 4,010 threshold, plus
// one issued and unpaid receipt so anyone can try the payment page. Without this the sample
// shows the dull case ("you owe nothing"), which is exactly the month the product is not
// needed. Everything is real and stays on the chain. It can be rerun: it skips what is done.
// The receipt numbers carry the month (Lima time), so rerunning it at the start of each month
// fills the new month instead of finding last month's receipts already paid.
import { CONTRACT, DEMO, addr, client, ensureClientUsdc, ensureTrustline, freelancer, i128, invoke, read, str, u32, i32, usdc } from "./chain.mjs";

if (freelancer.publicKey() !== DEMO) throw new Error("The sample panel's account is not the test freelancer's account.");

const lima = new Date(Date.now() - 5 * 3_600_000);
const SERIES = `E${String(lima.getUTCFullYear()).slice(2)}${String(lima.getUTCMonth() + 1).padStart(2, "0")}`;
const RECEIPTS = [
  { ref: `${SERIES}-1`, amount: "500.00", concept: "Brand identity design", pay: true },
  { ref: `${SERIES}-2`, amount: "620.00", concept: "Website redesign", pay: true },
  { ref: `${SERIES}-3`, amount: "300.00", concept: "Editorial illustration", pay: true },
  { ref: `${SERIES}-4`, amount: "180.00", concept: "Website maintenance", pay: false },
];
// Reserve left after the early withdrawal: 8% of the 1,420 USDC paid (113.6) minus 40. It sits
// below the month's prepayment, so the panel shows the short-reserve warning.
const RESERVE_AFTER = usdc("73.6");

console.log(`contract ${CONTRACT}\nfreelancer ${DEMO}\nclient ${client.publicKey()}`);
// Only what is still unpaid needs client USDC: a rerun after paying must not buy again.
const before = await Promise.all(RECEIPTS.map((r) => read("receipt", addr(DEMO), str(r.ref))));
const toPay = RECEIPTS.filter((r, i) => r.pay && !before[i]?.paid).reduce((a, r) => a + Number(r.amount), 0);
const trust = await ensureTrustline(freelancer);
if (trust) console.log(`freelancer USDC trustline: ${trust}`);
const bought = toPay > 0 ? await ensureClientUsdc(toPay + 200) : null;
if (bought) console.log(`client USDC purchase: ${bought}`);

// Since v2 the contract refuses to issue without a profile. The sample account uses the Peru
// preset (8%, Lima time), the only one whose threshold logic the panel shows.
const profile = await read("profile", addr(DEMO));
if (!profile || profile.tax_bps !== 800 || profile.utc_offset_min !== -300) {
  const h = await invoke(freelancer, "set_profile", addr(DEMO), u32(800), i32(-300));
  console.log(`profile set to the Peru preset (8%, UTC-5): ${h}`);
}

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

// The reserve also keeps what earlier months left, so the withdrawal brings it down to a fixed
// target instead of taking a fixed amount. Rerunning it finds the target met and does nothing.
const reserve = await read("tax_reserve", addr(DEMO));
if (reserve > RESERVE_AFTER) {
  const h = await invoke(freelancer, "withdraw_tax", addr(DEMO), addr(DEMO), i128(reserve - RESERVE_AFTER));
  console.log(`withdrawal of ${(Number(reserve - RESERVE_AFTER) / 1e7).toFixed(2)} USDC from the reserve: ${h}`);
}
console.log(`final reserve ${(Number(await read("tax_reserve", addr(DEMO))) / 1e7).toFixed(2)} USDC`);
