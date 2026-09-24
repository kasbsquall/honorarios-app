import "./styles.css";
import "./pay.css";
import { StrKey } from "@stellar/stellar-sdk";
import { EXPLORER, connectWallet, ensureUsdc, fromUnits, paidEvents, payInvoice, readReceipt, serviceFee, short } from "./stellar";
import { MARK, RECEIPT_EN, esc, receiptCard } from "./ui";

type Step = "connect" | "fund" | "sign" | "done";
const STEPS: { id: Step; icon: string; title: string; hint: string }[] = [
  { id: "connect", icon: "ph-plugs-connected", title: "Connect wallet", hint: "Freighter on testnet" },
  { id: "fund", icon: "ph-arrows-left-right", title: "Get USDC", hint: "Swaps XLM through a Stellar path payment if needed" },
  { id: "sign", icon: "ph-signature", title: "Sign payment", hint: "One contract call splits it on-chain" },
];

const app = document.getElementById("app")!;
document.getElementById("brand")!.insertAdjacentHTML("afterbegin", MARK);

// The link only says who gets paid and which receipt. The amount and the concept are read
// from the receipt the freelancer issued in the contract: editing the link does not change the charge.
const q = new URLSearchParams(location.search);
const to = q.get("to") ?? "";
const ref = (q.get("ref") ?? "").slice(0, 32);
const name = (q.get("name") ?? "").slice(0, 60);

let gross = 0n;
let concept = "";
const validTo = StrKey.isValidEd25519PublicKey(to) || StrKey.isValidContract(to);
let payer = "";
// What the contract will actually charge, read from the chain. If the screen computed it
// on its own, the client would sign a breakdown the contract has no obligation to honor.
let feeBps: bigint | null = null;
let feeState: "loading" | "ready" | "failed" = "loading";

const empty = (label: string, title: string, body: string) =>
  (app.innerHTML = `<section class="empty rise"><p class="lbl">${label}</p><h1>${title}</h1><p>${body}</p></section>`);

if (!validTo || !ref) {
  empty("Invalid link", "This payment link is incomplete.", "Ask the freelancer to send you a new link from their Honorarios panel.");
} else {
  app.innerHTML = `<section class="summary"><div class="receipt sk" style="height:420px"></div></section>
    <section class="side"><div class="receipt sk" style="height:300px"></div></section>`;
  start();
}

async function start() {
  const [receipt, fee] = await Promise.allSettled([readReceipt(to, ref), serviceFee()]);
  if (fee.status === "fulfilled") { feeBps = fee.value.bps; feeState = "ready"; } else { feeState = "failed"; }
  if (receipt.status === "rejected") {
    empty("Network error", "We could not read this receipt from Stellar.", "Nothing was charged. Reload the page in a moment.");
    return;
  }
  const r = receipt.value;
  if (!r) {
    empty("Unknown receipt", `Receipt ${esc(ref)} was never issued.`,
      "The contract only accepts payments for receipts the freelancer signed. Ask them for a new link.");
    return;
  }
  gross = r.gross;
  concept = r.concept || "Professional services";
  if (!r.paid) return render("connect");
  // Already paid: the contract would reject a second payment, so the proof of payment is shown.
  const paid = await paidEvents(to).then((l) => l.find((p) => p.ref === ref)).catch(() => undefined);
  render("done", { txHash: paid?.txHash, already: true });
}

function stepState(step: Step, current: Step) {
  const order: Step[] = ["connect", "fund", "sign", "done"];
  const a = order.indexOf(step), b = order.indexOf(current);
  return a < b ? "done" : a === b ? "now" : "next";
}

function render(current: Step, opts: { error?: string; busy?: boolean; txHash?: string; already?: boolean } = {}) {
  const done = current === "done";
  const badge = done
    ? `<span class="badge ok"><i class="ph-light ph-check" aria-hidden="true"></i>Paid</span>`
    : `<span class="badge"><i class="ph-light ph-hourglass-simple" aria-hidden="true"></i>Due</span>`;
  const action =
    current === "connect" ? "Connect Freighter"
    : current === "fund" ? "Prepare USDC"
    : current === "sign" ? `Pay ${fromUnits(gross)} USDC`
    : "";

  app.innerHTML = `
  <section class="summary rise" style="--i:0">
    <p class="lbl">Invoice from a freelancer in Peru</p>
    <h1>${esc(name || "A freelancer in Peru")}</h1>
    <p class="to-addr num">${short(to)}</p>
    <p class="due num">${fromUnits(gross)}<small>USDC</small></p>
    <dl class="lines">
      <div><dt>Service</dt><dd>${esc(concept)}</dd></div>
      <div><dt>Receipt</dt><dd class="num">${esc(ref)} · <span class="u">issued on-chain by the freelancer</span></dd></div>
      <div><dt>Pay to</dt><dd class="num">${short(to)}</dd></div>
      <div><dt>Network</dt><dd>Stellar testnet</dd></div>
    </dl>
    <ol class="steps">
      ${STEPS.map((s, i) => `
        <li class="step ${stepState(s.id, current)}">
          <span class="dot num">${stepState(s.id, current) === "done" ? `<i class="ph-light ph-check" aria-hidden="true"></i>` : String(i + 1).padStart(2, "0")}</span>
          <div><p><i class="ph-light ${s.icon}"></i> ${s.title}</p><small>${s.hint}</small></div>
        </li>`).join("")}
    </ol>
  </section>
  <section class="side rise" style="--i:1">
    <div class="${done ? "torn-wrap" : ""}">${
      // Until we know what the contract charges, no split is drawn:
      // a default breakdown would claim something the chain has not said.
      feeState === "loading"
        ? `<article class="receipt sk" style="height:300px"></article>`
        : receiptCard({
            gross, title: concept, ref, badge, text: RECEIPT_EN, feeBps: feeBps ?? 0n,
            footLeft: payer ? `from ${short(payer)}` : "",
            txHash: opts.txHash,
          })}</div>
    <p class="note">You pay the full amount. The contract keeps 8% in a reserve that only the freelancer can withdraw for their Peruvian tax prepayment.${
      feeState === "loading" ? " Reading the split from the contract…"
      : feeState === "failed" ? " We could not read the service fee from the contract, so the split above is the default one. Check the contract before you sign."
      : feeBps === 0n ? " This contract charges no service fee: the split above is read from the contract itself."
      : ` This contract charges a ${(Number(feeBps) / 100).toString()}% service fee, read from the contract itself.`}</p>
    ${done && opts.already ? `<p class="note"><i class="ph-light ph-seal-check" aria-hidden="true"></i> This receipt is already paid. The contract rejects a second payment of the same receipt, so nothing else can be charged for it.</p>` : ""}
    ${done && opts.txHash
      ? `<a class="btn wide" href="${EXPLORER}/tx/${opts.txHash}" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>View on Stellar Expert</a>`
      : done ? ""
      : `<p class="note desktop-only-note"><i class="ph-light ph-desktop" aria-hidden="true"></i> Freighter is a desktop browser extension. Open this link on your computer to pay.</p>
         <button class="btn wide" id="go" ${opts.busy ? "disabled" : ""}>${opts.busy ? `<span class="spin"></span>Waiting for wallet` : action}</button>`}
    ${opts.error ? `<p class="error" role="alert">${esc(opts.error)}</p>` : ""}
  </section>`;

  if (done) requestAnimationFrame(() => app.querySelector(".receipt")?.classList.add("torn"));
  app.querySelector("#go")?.addEventListener("click", () => advance(current));
}

async function advance(current: Step) {
  render(current, { busy: true });
  try {
    if (current === "connect") {
      payer = await connectWallet();
      render("fund");
    } else if (current === "fund") {
      await ensureUsdc(payer, gross);
      render("sign");
    } else if (current === "sign") {
      const hash = await payInvoice(payer, to, ref);
      render("done", { txHash: hash });
    }
  } catch (e) {
    render(current, { error: friendly(e) });
  }
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Freighter|Testnet|signature was cancelled|rejected the connection/.test(msg)) return translate(msg);
  if (/#8|AlreadyPaid/.test(msg)) return "This receipt was already paid. Nothing was charged.";
  if (/rejected the transaction/.test(msg)) return "The network rejected the transaction. No funds were moved. You can try again.";
  if (/did not return the transaction hash|cannot be negative/.test(msg)) return "The network did not confirm the transaction. Check your wallet before paying again.";
  if (/op_underfunded|insufficient|balance/i.test(msg)) return "Not enough XLM to cover this payment.";
  if (/No XLM to USDC route/.test(msg)) return "No XLM to USDC route is available right now. Try again in a minute.";
  return "Something went wrong sending the payment. Try again.";
}

function translate(msg: string) {
  if (msg.includes("Testnet")) return "Switch Freighter to Testnet to continue.";
  if (msg.includes("signature was cancelled")) return "You cancelled the signature in Freighter.";
  return "Freighter did not connect. Make sure the extension is installed and unlocked.";
}
