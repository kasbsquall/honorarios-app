import "./styles.css";
import "./panel.css";
import { StrKey } from "@stellar/stellar-sdk";
import { connectPasskey, createPasskeyWallet, extendWithPasskey, issueWithPasskey, restorePasskey, withdrawWithPasskey } from "./passkey";
import {
  CONTRACT_ID, EXPLORER, FREIGHTER_INSTALL, type Issued, type Paid, addUsdcTrustline, connectWallet, extendWithWallet, fromUnits, issueWithWallet, issuedEvents, readReceipt,
  monthGross as chainMonthGross, paidEvents, reserveLiveUntil, sendUsdcWithMemo, short, taxReserve, toUnits, usdcBalance, withdrawWithWallet,
} from "./stellar";
import { type AnchorTx, anchorLogin, anchorTx, startWithdraw, withdrawLimits } from "./sep24";
import { openRheDraft } from "./rhe";
import { DIRECTOR_CAP_PEN, DIRECTOR_THRESHOLD_PEN, SUSPENSION_CAP_PEN, THRESHOLD_PEN, UIT_PEN, estimate } from "./tax";
import { MARK, RECEIPT_PANEL, esc, receiptCard } from "./ui";

const FX_KEY = "honorarios.fx";
// The income the user types belongs to one month. Without the period in the key, what was
// typed in September would still be there in October and nobody would check it again.
const periodKey = (base: string) => {
  const l = new Date(Date.now() - 5 * 3_600_000);
  return `${base}.${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}`;
};
const OTHER_KEY = periodKey("honorarios.otras4");
const FIFTH_KEY = periodKey("honorarios.quinta");
const HELD_KEY = periodKey("honorarios.retenido");
const CONFIRM_KEY = periodKey("honorarios.confirm");
const ROLE_KEY = "honorarios.dir4";
const PUBLIC_BASE = (import.meta.env.VITE_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || location.origin;

const app = document.getElementById("app")!;
document.getElementById("brand")!.insertAdjacentHTML("afterbegin", MARK);

type Mode = "passkey" | "freighter" | "demo";
// Test account that gets paid against the current contract (web/scripts/seed-demo.mjs).
// If the contract is redeployed, put here an account that has been paid on the new one:
// `npm run check:demo` warns when this constant points at a dead deployment.
const DEMO_ADDRESS = "GBO7CDLI4L2AW4UQNFP5Z4KTUDHKP2K3P4EPU6VGCYCFD7IMCO3KEA3U";
// Payment link for an issued receipt: it only says who gets paid and which receipt number.
// The contract sets the amount.
const payLink = (ref: string) => `${PUBLIC_BASE}/pay.html?${new URLSearchParams({ to: me, ref })}`;
// Days of life left on the reserve below which the panel offers to renew it.
// The contract only extends the TTL when less than 7 days remain; 10 leaves room to do it in time.
const RENEW_DAYS = 10;
let me = "";
let mode: Mode = "passkey";
let events: Paid[] | null = null;
let reserve: bigint | null = null;
// Last chain read failed: never paint zeros as if they were the data.
let loadError = false;
// Month-to-date total read from the contract: it outlives the RPC event window.
let monthly: bigint | null = null;
// Issued receipts nobody has paid yet.
let pending: Issued[] = [];
let liveUntil: Date | null = null;
// Only a G account needs a USDC trustline; a smart wallet receives through the SAC without one.
let hasTrustline: boolean | null = null;

// `?demo` opens the sample dashboard without going through the intro: it is the link in the README.
// Deferred like the passkey branch, because the panel uses constants declared further down.
if (new URLSearchParams(location.search).has("demo")) queueMicrotask(() => enter(DEMO_ADDRESS, "demo"));
else restorePasskey().then((id) => (id ? enter(id, "passkey") : renderIntro()));

function enter(address: string, how: Mode) {
  me = address;
  mode = how;
  document.getElementById("who")!.innerHTML =
    `${how === "passkey" ? `<i class="ph-light ph-fingerprint" aria-hidden="true"></i> Passkey · ` : ""}${
      how === "demo" ? `<i class="ph-light ph-eye" aria-hidden="true"></i> Sample · ` : ""}${short(me)}`;
  renderPanel();
  load();
}

function renderIntro(error = "") {
  app.innerHTML = `
  <section class="intro rise">
    <p class="lbl">For freelancers in Peru who get paid from abroad</p>
    <h1>Your SUNAT income-tax prepayment, set aside from the first dollar you earn abroad.</h1>
    <p>Every payment from abroad goes through a contract on Stellar: 8% is held in a reserve in your name that only you can move, and the rest lands in your wallet. If the month goes over your threshold with SUNAT (Peru's tax authority), S/ 4,010 in the general case, that reserve covers your income-tax prepayment (pago a cuenta de cuarta categoría). If it doesn't, the money is still yours.</p>
    <label class="field name"><span class="lbl">Your name</span><input id="name" maxlength="40" placeholder="How it should appear on your passkey"></label>
    <div class="actions">
      <button class="btn" id="create"><i class="ph-light ph-fingerprint" aria-hidden="true"></i>Create wallet with passkey</button>
      <button class="btn ghost" id="login"><i class="ph-light ph-key" aria-hidden="true"></i>I already have a passkey</button>
    </div>
    <p class="alt">No seed phrase: your fingerprint or Face ID signs. Network fees are covered by the SDF relayer on testnet. <button class="linkbtn" id="freighter">I'd rather use Freighter</button></p>
    <p class="alt"><button class="linkbtn" id="demo"><i class="ph-light ph-eye" aria-hidden="true"></i> View a sample dashboard</button> using the demo account, with nothing to install.</p>
    ${error ? `<p class="error" role="alert">${esc(error)}${
      error.includes("Freighter extension")
        ? ` <a href="${FREIGHTER_INSTALL}" target="_blank" rel="noopener">Install Freighter <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>`
        : ""}</p>` : ""}
  </section>
  <section class="how rise" style="--i:1">
    <ol>
      <li><span class="lbl">01</span><div><b>You issue your receipt and send the link</b><small>Amount, receipt number and description. The receipt is recorded in the contract, and your client can pay only that amount, once. They pay with Freighter; if they only hold XLM, Stellar converts it along the way.</small></div></li>
      <li><span class="lbl">02</span><div><b>The contract splits the payment on the spot</b><small>8% stays reserved in your name inside the contract and the rest lands in your wallet. It is a single transaction, and anyone can verify it.</small></div></li>
      <li><span class="lbl">03</span><div><b>You withdraw when it's time to file</b><small>The dashboard estimates your prepayment for the month, explains how to pay it in soles and prepares a draft of your Recibo por Honorarios Electrónico (electronic fee receipt).</small></div></li>
    </ol>
    <p class="alt"><a href="${EXPLORER}/contract/${CONTRACT_ID}" target="_blank" rel="noopener"><i class="ph-light ph-file-code" aria-hidden="true"></i> The contract on Stellar Expert</a> · open source · Stellar testnet</p>
    <p class="alt price"><i class="ph-light ph-receipt" aria-hidden="true"></i> <b>What it would cost:</b> the plan is to charge 0.5% per settled payment, with no monthly fee. The contract has a hard cap of 1% that its constructor refuses to exceed, and <b>today it is deployed at zero</b>. You don't have to take our word for it: the fee is public on chain, and the payment screen reads it from there before your client signs.</p>
  </section>`;

  app.querySelector("#demo")!.addEventListener("click", () => enter(DEMO_ADDRESS, "demo"));

  const run = (id: string, busy: string, how: Mode, fn: () => Promise<string>) =>
    app.querySelector(`#${id}`)!.addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      app.querySelectorAll("button").forEach((x) => (x.disabled = true));
      b.innerHTML = `<span class="spin"></span>${busy}`;
      try {
        enter(await fn(), how);
      } catch (err) {
        renderIntro(err instanceof Error ? err.message : "Could not connect.");
      }
    });

  run("create", "Creating your wallet", "passkey", () =>
    createPasskeyWallet(app.querySelector<HTMLInputElement>("#name")!.value.trim()));
  run("login", "Waiting for your passkey", "passkey", connectPasskey);
  run("freighter", "Waiting for Freighter", "freighter", connectWallet);
}

async function load() {
  // Independent calls. The event scan is the fragile one (many windows against the public
  // RPC); if it fails it must not wipe the reserve, which already answered.
  const isG = me.startsWith("G");
  const [r, e, m, iss, ttl, tl] = await Promise.allSettled([
    taxReserve(me), paidEvents(me), chainMonthGross(me), issuedEvents(me), reserveLiveUntil(me),
    isG ? usdcBalance(me) : Promise.resolve(0n),
  ]);
  reserve = r.status === "fulfilled" ? r.value : null;
  events = e.status === "fulfilled" ? e.value : null;
  monthly = m.status === "fulfilled" ? m.value.gross : null;
  // Whether a receipt is paid comes from the contract, not from the events: the payment list
  // can fail or come up short, and that does not turn a paid receipt back into a pending one.
  const issued = iss.status === "fulfilled" ? iss.value : [];
  const states = await Promise.all(issued.map((i) => readReceipt(me, i.ref).catch(() => undefined)));
  pending = issued.filter((_, k) => states[k] === undefined || states[k]?.paid === false);
  liveUntil = ttl.status === "fulfilled" ? ttl.value : null;
  hasTrustline = tl.status === "fulfilled" ? tl.value !== null : null;
  // It only counts as a real error when nothing could be read from the contract.
  loadError = r.status === "rejected" && m.status === "rejected";
  renderPanel();
}

// The contract closes the month at midnight Lima time. The fallback measures the same way,
// without depending on the browser's time zone.
const PERU_OFFSET_MS = 5 * 3_600_000;
const limaMonth = (d: Date) => {
  const l = new Date(d.getTime() - PERU_OFFSET_MS);
  return l.getUTCFullYear() * 12 + l.getUTCMonth();
};

function monthGross(list: Paid[]) {
  const now = limaMonth(new Date());
  return list.filter((p) => limaMonth(p.at) === now).reduce((s, p) => s + p.gross, 0n);
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function readNum(key: string): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

// Sample exchange rate, only so the sample dashboard has something to compute.
const DEMO_FX = 3.75;

/* Sanity range for the exchange rate. It warns without blocking: the whole conversion to
 * soles hangs on this number, and one misplaced decimal point turns a month with a payment
 * due into one that looks clear. */
const FX_MIN = 2;
const FX_MAX = 6;

/** The exchange rate the user typed, excluding the sample one. */
function readStoredFx(): number | null {
  try {
    const v = Number(localStorage.getItem(FX_KEY));
    if (v > 0) return v;
  } catch { /* no storage */ }
  return null;
}

function readFx(): number | null {
  return readStoredFx() ?? (mode === "demo" ? DEMO_FX : null);
}

function renderPanel() {
  const loading = events === null && !loadError;
  const list = events ?? [];
  // The dashboard frames one month: adding payments from earlier months would mix periods.
  const thisMonth = list.filter((p) => limaMonth(p.at) === limaMonth(new Date()));
  const net = thisMonth.reduce((s, p) => s + p.net, 0n);
  // With no data, no number is painted: a 0 asserts something we don't know.
  const val = (fn: () => string) => (loading ? "" : loadError ? "—" : fn());

  // Same calculation as the block below, so the two parts never contradict each other.
  const fxNow = readFx();
  // An out-of-range rate sinks the soles total, and the green notices cannot ignore it.
  const fxOdd = fxNow !== null && (fxNow < FX_MIN || fxNow > FX_MAX);
  const reservePen = reserve === null || !fxNow ? null : Number(fromUnits(reserve, 2).replace(/,/g, "")) * fxNow;
  const est = estimate({
    appGrossPen: monthly !== null && fxNow ? Number(fromUnits(monthly, 2).replace(/,/g, "")) * fxNow : null,
    otherFourthPen: readNum(OTHER_KEY), fifthPen: readNum(FIFTH_KEY), withheldPen: readNum(HELD_KEY),
    isDirectorIncome: readFlag(ROLE_KEY), confirmedComplete: readFlag(CONFIRM_KEY),
  });
  const pen2 = (n: number) => "S/ " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gap = est.duePen !== null && reservePen !== null ? est.duePen - reservePen : null;
  const reserveState =
    loading || loadError || gap === null ? ""
    : est.duePen === 0 && fxOdd ? `<span class="tag warn"><i class="ph-light ph-warning" aria-hidden="true"></i>Check the exchange rate before relying on this</span>`
    : est.duePen === 0 && est.provisional ? `<span class="tag"><i class="ph-light ph-dots-three-circle" aria-hidden="true"></i>Confirm your other income for the month to know whether there is anything to cover</span>`
    : est.duePen === 0 ? `<span class="tag ok"><i class="ph-light ph-check" aria-hidden="true"></i>No income-tax prepayment to cover this month</span>`
    : gap > 0.5 ? `<span class="tag warn"><i class="ph-light ph-warning" aria-hidden="true"></i>Short by ${pen2(gap)} to cover the ${pen2(est.duePen!)} payment${
        mode === "demo" ? ", because this account withdrew the reserve before the month closed" : ""}</span>`
    : `<span class="tag ok"><i class="ph-light ph-check" aria-hidden="true"></i>Enough for the ${pen2(est.duePen!)} payment</span>`;

  app.innerHTML = `
  ${loadError ? `<p class="error" role="alert"><i class="ph-light ph-warning" aria-hidden="true"></i> We couldn't read your payments from the network. What you see here is not your balance: reload in a moment. <button class="linkbtn" id="retry">Retry</button>${
    mode !== "demo" ? ` If your reserve has had no activity for over a month, the network may have archived it: <button class="linkbtn renew">restore it</button>, without moving funds.` : ""}</p>` : ""}
  ${mode === "demo" ? `<p class="note" role="status"><i class="ph-light ph-eye" aria-hidden="true"></i> Sample dashboard with a test account on testnet: receipts, payments, the reserve and the month-to-date total are read live from the chain. This month crosses the threshold, so the block below shows a real income-tax prepayment. The reserve falls short of it on purpose: this account withdrew part of its reserve before the month closed, which is exactly what the app warns against. Issuing receipts and withdrawing need that account's signature. What you can do is open a receipt under "Awaiting payment" and pay it with Freighter on testnet. <a href="${EXPLORER}/${DEMO_ADDRESS.startsWith("G") ? "account" : "contract"}/${DEMO_ADDRESS}" target="_blank" rel="noopener">View the account <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></p>` : ""}
  <section class="hero rise" style="--i:0">
    <div>
      <p class="lbl"><i class="ph-light ph-vault" aria-hidden="true"></i> Tax reserve · 8% of every payment</p>
      <p class="kpi num ${loading ? "sk" : ""}">${val(() => fromUnits(reserve!))}<small>USDC</small></p>
      ${reserveState}
      <p class="kpi-note">${mode === "demo" && reserve === 0n ? "This account already withdrew its reserve during the demo, which is why it is at zero. " : ""}Only you can move it. It covers your income-tax prepayment if the month goes over your threshold, S/ ${est.thresholdPen.toLocaleString("en-US")}; if it doesn't, the money stays yours.</p>
      ${ttlLine()}
      <form id="withdraw" class="withdraw">
        <label class="field"><span class="lbl">Send reserve to</span><input class="num" name="to" required placeholder="Stellar account (G… or C…)"></label>
        <label class="field amt"><span class="lbl">Amount (USDC)</span><input class="num" name="amount" required inputmode="decimal" pattern="\\d+(\\.\\d{1,7})?" value="${reserve ? fromUnits(reserve, 7).replace(/,/g, "").replace(/\.?0+$/, "") : ""}"></label>
        <button class="btn ghost" type="submit" ${!reserve ? "disabled" : ""}><i class="ph-light ph-arrow-square-out" aria-hidden="true"></i>Withdraw reserve</button>
        ${gap !== null && est.duePen === 0 && !est.provisional ? `<p class="u wd-hint">This month is under the threshold, so this reserve is yours. It is still better to wait until the month closes: one more payment can push it over.</p>` : ""}
        <p class="wd-out" role="status">${!reserve && !loading ? `<span class="u">${loadError ? "We couldn't read your reserve, so it can't be withdrawn yet." : "No reserve to withdraw yet. It shows up here as soon as you receive a payment."}</span>` : ""}</p>
      </form>
    </div>
    <dl class="stats">
      <div><dt><i class="ph-light ph-wallet" aria-hidden="true"></i> Net received this month</dt><dd class="num ${loading ? "sk" : ""}">${val(() => fromUnits(net))} <small>USDC</small></dd></div>
      <div><dt><i class="ph-light ph-rows" aria-hidden="true"></i> Payments this month</dt><dd class="num ${loading ? "sk" : ""}">${val(() => String(thisMonth.length))}</dd></div>
      <div><dt><i class="ph-light ph-percent" aria-hidden="true"></i> Reserve rate</dt><dd class="num">8<small>%</small></dd></div>
    </dl>
  </section>
  <section class="grid2">
    <div class="block rise" style="--i:1" id="threshold"></div>
    <form class="block rise" style="--i:2" id="newlink">
      <p class="lbl"><i class="ph-light ph-link-simple" aria-hidden="true"></i> New receipt and payment link</p>
      <p class="u">You sign the receipt and it is recorded in the contract. Your client can pay only that amount, once.</p>
      <div class="row2">
        <label class="field"><span class="lbl">Amount (USDC)</span><input class="num" name="amount" inputmode="decimal" required pattern="\\d+(\\.\\d{1,7})?" placeholder="500.00"></label>
        <label class="field"><span class="lbl">Receipt no.</span><input class="num" name="ref" required maxlength="20" placeholder="E001-2"></label>
      </div>
      <label class="field"><span class="lbl">Description</span><input name="concept" required maxlength="80" placeholder="Logo design"></label>
      <label class="field"><span class="lbl">Display name</span><input name="name" maxlength="60" placeholder="Optional"></label>
      <button class="btn" type="submit"><i class="ph-light ph-plus" aria-hidden="true"></i>Issue receipt and create link</button>
      <div id="linkout" class="linkout hidden"></div>
    </form>
  </section>
  ${pending.length ? `<section class="rise" style="--i:3">
    <div class="sec-h"><h2>Awaiting payment</h2><span class="lbl">Receipts issued on chain and not yet paid</span></div>
    <ul class="pending">${pending.map((p, i) => `
      <li class="rise" style="--i:${Math.min(i, 7)}">
        <span class="num">${esc(p.ref)}</span><span>${esc(p.concept)}</span><span class="num">${fromUnits(p.gross)} <small>USDC</small></span>
        <span class="acts"><button type="button" class="btn ghost copy-link" data-ref="${esc(p.ref)}"><i class="ph-light ph-copy" aria-hidden="true"></i>Copy link</button>
        <a class="btn ghost" href="${esc(payLink(p.ref))}" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>Open</a></span>
      </li>`).join("")}</ul>
  </section>` : ""}
  <section class="rise" style="--i:3">
    <div class="sec-h"><h2>Payments received</h2><span class="lbl">Read from the Stellar network</span></div>
    <div class="cards">${
      loading
        ? `<div class="receipt sk" style="height:260px"></div><div class="receipt sk" style="height:260px"></div>`
        : loadError
          ? `<div class="emptybox"><i class="ph-light ph-cloud-slash" aria-hidden="true"></i><p>We couldn't read the network, so we don't know whether you have payments this month.</p></div>`
          : list.length
          ? list.map((p, i) => `<div class="rise" style="--i:${Math.min(i, 7)}">${receiptCard({
              gross: p.gross, title: `From ${short(p.payer)}`, ref: p.ref, text: RECEIPT_PANEL,
              actual: { net: p.net, tax: p.tax, fee: p.fee },
              badge: `<span class="badge ok"><i class="ph-light ph-check" aria-hidden="true"></i>Paid</span>`,
              footLeft: p.at.toLocaleDateString("en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
              txHash: p.txHash,
            })}<button class="btn ghost rhe-open" data-i="${i}"><i class="ph-light ph-file-text" aria-hidden="true"></i>Draft Recibo por Honorarios (fee receipt)</button></div>`).join("")
          : (monthly !== null && monthly > 0n) || (reserve !== null && reserve > 0n)
          ? `<div class="emptybox"><i class="ph-light ph-clock-counter-clockwise" aria-hidden="true"></i><p>The contract has payments of yours this month, but the node no longer keeps their events: testnet retains about a week. The figures above come from the contract and are exact. What is missing here is the detail of each payment.</p></div>`
          : `<div class="emptybox"><i class="ph-light ph-receipt" aria-hidden="true"></i><p>No payments yet. Create a link and send it to your client.</p></div>`
    }</div>
  </section>`;

  // Without the contract's month-to-date total there is no reliable base: events only cover
  // the RPC window, and a short base produces the one error this product cannot make.
  renderThreshold();
  bindLinkForm();
  bindWithdraw();
  app.querySelector("#retry")?.addEventListener("click", () => {
    loadError = false;
    events = null;
    renderPanel();
    load();
  });
  app.querySelectorAll<HTMLButtonElement>(".copy-link").forEach((b) =>
    b.addEventListener("click", () => copy(b, payLink(b.dataset.ref!))));
  app.querySelectorAll<HTMLButtonElement>(".renew").forEach((b) => b.addEventListener("click", () => renew(b)));
  app.querySelectorAll<HTMLButtonElement>(".rhe-open").forEach((b) =>
    b.addEventListener("click", () => openRheDraft(list[Number(b.dataset.i)], readFx())));
}

function bindWithdraw() {
  const form = app.querySelector<HTMLFormElement>("#withdraw")!;
  const out = form.querySelector(".wd-out")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (mode === "demo") {
      out.innerHTML = `<span class="error">The sample dashboard is read-only. Create your wallet with a passkey to withdraw.</span>`;
      return;
    }
    const d = new FormData(form);
    const to = String(d.get("to")).trim();
    const amount = toUnits(String(d.get("amount")));
    if (!StrKey.isValidEd25519PublicKey(to) && !StrKey.isValidContract(to)) {
      out.innerHTML = `<span class="error">That address is not valid on Stellar.</span>`;
      return;
    }
    if (amount <= 0n || (reserve !== null && amount > reserve)) {
      out.innerHTML = `<span class="error">The amount must be greater than 0 and no more than your reserve.</span>`;
      return;
    }
    const btn = form.querySelector("button")!;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>${mode === "passkey" ? "Confirm with your passkey" : "Sign with Freighter"}`;
    try {
      const hash = mode === "passkey" ? await withdrawWithPasskey(me, to, amount) : await withdrawWithWallet(me, to, amount);
      reserve = await taxReserve(me);
      renderPanel();
      app.querySelector("#withdraw .wd-out")!.innerHTML =
        `You withdrew ${fromUnits(amount)} USDC. <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">View transaction <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>`;
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-light ph-arrow-square-out" aria-hidden="true"></i>Withdraw reserve`;
      out.innerHTML = `<span class="error">${esc(err instanceof Error ? err.message : "Could not withdraw.")}</span>`;
    }
  });
}

function renderThreshold() {
  const box = app.querySelector("#threshold")!;
  // While the chain has not answered, the estimate is not "impossible to compute", it is
  // simply not known yet. Without telling the two cases apart, the panel complained about a
  // missing exchange rate that was actually set. It is derived from module state so the
  // re-renders triggered by the fields below do not lose it.
  const loading = events === null && !loadError;
  // If the read failed, the month-to-date total is unknown: same case as the contract not
  // answering, and never the case of a missing exchange rate.
  const grossUnavailable = !loading && (loadError || monthly === null);
  const gross = loading || loadError ? null : monthly;
  const fx = readFx();
  // Where the rate comes from matters as much as the number: the whole soles figure hangs on it.
  const fxIsSample = fx !== null && readStoredFx() === null;
  const other = readNum(OTHER_KEY);
  const fifth = readNum(FIFTH_KEY);
  const withheld = readNum(HELD_KEY);
  const usdc = gross === null ? null : Number(fromUnits(gross, 2).replace(/,/g, ""));
  const viaApp = usdc !== null && fx ? usdc * fx : null;
  const director = readFlag(ROLE_KEY);
  const confirmed = readFlag(CONFIRM_KEY);
  const est = estimate({
    appGrossPen: viaApp, otherFourthPen: other, fifthPen: fifth, withheldPen: withheld,
    isDirectorIncome: director, confirmedComplete: confirmed,
  });
  const fourthBase = est.fourthBasePen;
  const pen = est.monthTotalPen;
  const over = est.overThreshold;
  const due = est.duePen;
  // The bar reaches 100% right at the threshold, and the marker shows where that cut-off is.
  const threshold = est.thresholdPen;
  const fxOdd = fx !== null && (fx < FX_MIN || fx > FX_MAX);
  const ratio = pen === null ? 0 : Math.min(pen / threshold, 1);
  const soles = (n: number) => "S/ " + n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const month = new Date(Date.now() - PERU_OFFSET_MS).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const state =
    loading ? `<span class="badge"><i class="ph-light ph-circle-dashed" aria-hidden="true"></i>Reading the chain</span>`
    : grossUnavailable ? `<span class="badge warn"><i class="ph-light ph-cloud-slash" aria-hidden="true"></i>Couldn't read this month's payments</span>`
    : pen === null ? `<span class="badge"><i class="ph-light ph-question" aria-hidden="true"></i>Exchange rate missing</span>`
    : !over && fxOdd ? `<span class="badge warn"><i class="ph-light ph-warning" aria-hidden="true"></i>Check the exchange rate</span>`
    : over ? `<span class="badge warn"><i class="ph-light ph-warning" aria-hidden="true"></i>Over the threshold</span>`
    : est.provisional ? `<span class="badge"><i class="ph-light ph-dots-three-circle" aria-hidden="true"></i>Confirm your other income</span>`
    : `<span class="badge ok"><i class="ph-light ph-check" aria-hidden="true"></i>Under the threshold</span>`;

  box.innerHTML = `
    <div class="rc-top"><p class="lbl"><i class="ph-light ph-calendar-blank" aria-hidden="true"></i> Income-tax prepayment · ${month}</p>${state}</div>
    <p class="th-num num ${loading ? "sk" : ""}">${loading ? "Reading…" : due === null ? "S/ —" : soles(due)}</p>
    <p class="th-cap">${
      loading ? "reading this month's payments from the chain"
      : due === null ? "this app can't estimate it"
      : `estimate only, this is not your tax return · in soles at an exchange rate of ${fx}${fxIsSample ? " (sample rate)" : ", as you entered it"}`}</p>
    <div class="meter" title="${soles(threshold)} is the threshold"><i style="transform:scaleX(${ratio})" class="${over ? "over" : ""}"></i></div>
    <p class="th-scale"><span>${pen === null ? "month to date" : `month to date ${soles(pen)}`}</span><span>threshold ${soles(threshold)}${
      over && pen ? ` · ${(pen / threshold).toFixed(1).replace(".0", "")} times the threshold` : ""}</span></p>
    <div class="th-body"><div>
    <dl class="th-rows">
      <div><dt>Received through this app</dt><dd class="num">${viaApp === null ? "—" : soles(viaApp)}</dd></div>
      <div><dt>Other fourth-category income (independent work) this month</dt><dd class="num">${soles(other)}</dd></div>
      <div><dt><b>Prepayment base</b> (fourth category)</dt><dd class="num">${fourthBase === null ? "—" : soles(fourthBase)}</dd></div>
      <div><dt>Fifth-category income (employment), for the threshold only</dt><dd class="num">${soles(fifth)}</dd></div>
      <div><dt>Month total against the threshold</dt><dd class="num">${pen === null ? "—" : soles(pen)} <span class="u">of ${soles(threshold)}</span></dd></div>
      <div class="wide"><dt>Rule</dt><dd>if the month total goes over the threshold, 8% of the fourth-category base is due. If it doesn't, there is no prepayment this month. Your threshold is ${soles(threshold)}, the one in item ${director ? "b)" : "a)"} of article 3 of Resolución de Superintendencia 000390-2025/SUNAT (a SUNAT resolution)${director ? ", which applies to company directors, síndicos (trustees), mandatarios (agents), gestores de negocios (business managers), albaceas (executors) and regidores (city councillors)" : ""}.</dd></div>
      <div><dt>Fourth-category tax already withheld</dt><dd class="num">− ${soles(withheld)}</dd></div>
    </dl>
    <p class="th-help">${
      loading
        ? "We're reading from the chain how much you've been paid this month. The estimate shows up here as soon as it answers."
      : grossUnavailable
        ? "The contract did not report how much you've been paid this month, so we are not estimating anything. We don't fall back on the payment list below: the node only keeps the last few days and the total would come up short, which is the worst possible error in a tax calculation. Reload in a moment."
      : pen === null
        ? "Enter the exchange rate to estimate this month's income-tax prepayment."
        : over
          ? (() => {
              // Actually compare the reserve with the amount due, instead of claiming it covers it.
              const reserveInPen = reserve === null || !fx ? null : Number(fromUnits(reserve, 2).replace(/,/g, "")) * fx;
              if (reserveInPen === null) return "The reserve is in USDC and the amount due is in soles, so the exchange rate on the day you pay moves the result.";
              const shortfall = (due ?? 0) - reserveInPen;
              return shortfall > 0.5
                ? `At this exchange rate your reserve is worth ${soles(reserveInPen)}, which leaves you ${soles(shortfall)} short of the payment. The reserve is in USDC and the amount due is in soles, so the exchange rate on the day you pay moves the result.`
                : `At this exchange rate your reserve is worth ${soles(reserveInPen)} and covers the payment. Since it is in USDC and the amount due is in soles, the exchange rate on the day you pay moves the result.`;
            })()
          : est.provisional
            ? "What you were paid through this app does not cross the threshold, but the threshold is measured on everything you earned this month. Fill in your other income above and confirm it. Until then, the app does not say you owe nothing."
            : "Based on what you entered here there would be no prepayment, and the contract still set aside 8% of every payment: the reserve is a fixed rule and does not check the threshold. That money is yours and you can withdraw it. Wait until the month closes to do so, because one more payment can cross the threshold and the 8% applies to the whole month."
    }</p>
    <p class="th-help"><i class="ph-light ph-warning-circle" aria-hidden="true"></i> This is an estimate based on what this app can know. The threshold is measured on all your income for the month, including fourth-category income received outside this app and fifth-category income if you are on a payroll. And the 8% is a prepayment: in the annual return the tax is recalculated on net income, so you may end up with a balance to pay or a credit in your favor.</p>
    </div><div>
    <div class="row2">
      <label class="field"><span class="lbl">Other fourth-category income this month (S/)</span><input class="num other-in" data-k="${OTHER_KEY}" inputmode="decimal" placeholder="0.00" value="${other || ""}"></label>
      <label class="field"><span class="lbl">Fifth-category income this month (S/)</span><input class="num other-in" data-k="${FIFTH_KEY}" inputmode="decimal" placeholder="0.00" value="${fifth || ""}"></label>
    </div>
    <label class="field"><span class="lbl">Tax already withheld from you this month (S/)</span><input class="num other-in" data-k="${HELD_KEY}" inputmode="decimal" placeholder="0.00" value="${withheld || ""}"></label>
    <label class="check"><input type="checkbox" id="done4" ${confirmed ? "checked" : ""}><span>I've checked: this is everything I earned this month<small>The amounts above are for ${month}. Until you confirm, the app does not claim you have no prepayment due.</small></span></label>
    <label class="check"><input type="checkbox" id="dir4" ${director ? "checked" : ""}><span>My fourth-category income comes from serving as a director, mandatario (agent), regidor (city councillor), síndico (trustee) or albacea (executor)<small>That group has its own threshold, S/ ${DIRECTOR_THRESHOLD_PEN.toLocaleString("en-US")} a month instead of S/ ${THRESHOLD_PEN.toLocaleString("en-US")}, under item b) of article 3 of the resolution. Tick it and the app compares you against that one.</small></span></label>
    <details class="howto" ${sep ? "open" : ""}>
      <summary><i class="ph-light ph-list-numbers" aria-hidden="true"></i> How to pay SUNAT</summary>
      <ol>
        <li>Withdraw the reserve to your wallet and convert it to soles. SUNAT only accepts soles.
          <div id="offramp" class="offramp"><span class="spin"></span> Checking soles anchors on Stellar…</div>
          <div id="sep24" class="offramp"></div>
        </li>
        <li>Log in to SUNAT Operaciones en Línea (SUNAT's online portal) with your Clave SOL (SUNAT login password) and go to Mis declaraciones y pagos (returns and payments), Trabajadores independientes (independent workers): Formulario Virtual 616 (SUNAT's online payment form).</li>
        <li>Declare what you were paid in the month and pay with an NPS (Número de Pago SUNAT, a payment code) or online. The due date depends on the last digit of your RUC (taxpayer ID): <a href="https://www.sunat.gob.pe" target="_blank" rel="noopener">check the monthly obligations schedule at sunat.gob.pe <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></li>
      </ol>
      <p>If you expect to earn up to S/ ${SUSPENSION_CAP_PEN.toLocaleString("en-US")} in the year, you can request a suspension of prepayments (Formulario 1609). The suspension is not automatic: it applies from the moment SUNAT approves it, never retroactively, and it expires on December 31, so you have to request it again every year. If a Peruvian client already withheld 8% from you, that amount is deducted from the month's payment.</p>
      <p class="src"><i class="ph-light ph-seal-check" aria-hidden="true"></i> Where the figures come from: the 8% rate is article 86 of the TUO de la Ley del Impuesto a la Renta (Peru's consolidated Income Tax Law, D.S. 179-2004-EF). The thresholds are those in article 3 of <a href="https://www.sunat.gob.pe/legislacion/superin/2025/000390-2025.pdf" target="_blank" rel="noopener">Resolución de Superintendencia N.° 000390-2025/SUNAT <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>, dated December 30, 2025: S/ ${THRESHOLD_PEN.toLocaleString("en-US")} a month and S/ ${SUSPENSION_CAP_PEN.toLocaleString("en-US")} a year in the general regime, and S/ ${DIRECTOR_THRESHOLD_PEN.toLocaleString("en-US")} a month and S/ ${DIRECTOR_CAP_PEN.toLocaleString("en-US")} a year for company directors, síndicos, mandatarios, gestores de negocios, albaceas and regidores. SUNAT adjusted them to the 2026 UIT (Unidad Impositiva Tributaria, Peru's tax reference unit), S/ ${UIT_PEN.toLocaleString("en-US")} under D.S. 301-2025-EF. We copied the amounts from the resolution; we did not derive them.</p>
    </details>
    <label class="field fx"><span class="lbl">Exchange rate (S/ per USDC)</span>
      <input class="num" id="fx" inputmode="decimal" placeholder="SBS buying rate on the payment date" value="${fx ?? ""}">
      ${fx !== null && (fx < FX_MIN || fx > FX_MAX) ? `<small class="warn-text"><i class="ph-light ph-warning" aria-hidden="true"></i> S/ ${fx} per dollar is outside what the market has seen (between ${FX_MIN} and ${FX_MAX}). A very low rate sinks your soles total and can make the app say you are under the threshold when you are over it. Please check it.</small>` : ""}
      <small>${mode === "demo" ? `${DEMO_FX} is filled in here as a sample, so the sample dashboard can compute something. ` : ""}The rule uses the SBS (Peru's banking regulator) buying rate on the day you get paid. Here a single rate is applied to the whole month as an approximation, so the soles total is close to the real one without being exact. SUNAT has published no criterion for payments received in crypto: confirm with your accountant.</small>
    </label>
    </div></div>`;

  renderOfframp();
  renderSep24();

  const save = (key: string, raw: string) => {
    const v = Number(raw.replace(",", "."));
    try { localStorage.setItem(key, v > 0 ? String(v) : ""); } catch { /* no storage */ }
    renderThreshold();
  };
  box.querySelector<HTMLInputElement>("#fx")!.addEventListener("change", (e) => save(FX_KEY, (e.target as HTMLInputElement).value));
  box.querySelectorAll<HTMLInputElement>(".other-in").forEach((i) =>
    i.addEventListener("change", () => save(i.dataset.k!, i.value)));
  const flag = (id: string, key: string) =>
    box.querySelector<HTMLInputElement>(id)!.addEventListener("change", (e) => {
      try { localStorage.setItem(key, (e.target as HTMLInputElement).checked ? "1" : ""); } catch { /* no storage */ }
      renderThreshold();
    });
  flag("#dir4", ROLE_KEY);
  flag("#done4", CONFIRM_KEY);
}

// SEP-24 anchor that settles in soles. It is queried live, so if it stops offering PEN, it shows.
const ANCHOR = { home: "https://www.anclap.com", toml: "https://api.anclap.com/.well-known/stellar.toml", info: "https://api.anclap.com/transfer24/info", name: "Anclap" };

async function renderOfframp() {
  const box = app.querySelector("#offramp");
  if (!box) return;
  try {
    const info = await fetch(ANCHOR.info).then((r) => r.json());
    const pen = info?.withdraw?.PEN;
    if (!pen?.enabled) throw new Error("no PEN");
    const fee = typeof pen.fee_percent === "number" ? ` · ${pen.fee_percent}% fee` : "";
    box.innerHTML = `<i class="ph-light ph-bank" aria-hidden="true"></i> <b>${ANCHOR.name}</b> pays out soles through SEP-24 on mainnet${esc(fee)}.
      <a href="${ANCHOR.toml}" target="_blank" rel="noopener">View its stellar.toml <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>
      <small>Checked live. This app runs on testnet, so the withdrawal to a Peruvian bank is not executed from here.</small>`;
  } catch {
    box.innerHTML = `<i class="ph-light ph-bank" aria-hidden="true"></i> We couldn't reach the anchor right now. On mainnet there are anchors that pay out soles through SEP-24; see <a href="${ANCHOR.home}" target="_blank" rel="noopener">${ANCHOR.name}</a>.`;
  }
}

/** How long the reserve lives on the network. After that it gets archived and has to be restored. */
function ttlLine(): string {
  if (!liveUntil || !reserve) return "";
  const days = Math.floor((liveUntil.getTime() - Date.now()) / 86_400_000);
  const date = liveUntil.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  const canRenew = mode !== "demo" && days <= RENEW_DAYS;
  return `<p class="kpi-note ttl"><i class="ph-light ph-hourglass-medium" aria-hidden="true"></i> The network keeps this reserve until ${date} (${Math.max(days, 0)} days), and every payment or withdrawal extends that period. ${
    canRenew
      ? `Time is running short: <button class="linkbtn renew">renew it now</button>, without moving funds.`
      : `If nobody touches it in that time, it gets archived and must be restored before you can withdraw.`}</p>`;
}

async function renew(b: HTMLButtonElement) {
  b.disabled = true;
  b.textContent = mode === "passkey" ? "confirm with your passkey…" : "sign with Freighter…";
  try {
    await (mode === "passkey" ? extendWithPasskey(me) : extendWithWallet(me));
    loadError = false;
    await load();
  } catch (err) {
    b.disabled = false;
    b.textContent = err instanceof Error ? err.message : "Could not renew.";
  }
}

async function copy(b: HTMLButtonElement, url: string) {
  try {
    await navigator.clipboard.writeText(url);
    b.innerHTML = `<i class="ph-light ph-check" aria-hidden="true"></i>Copied`;
  } catch {
    b.innerHTML = `Copy the link from Open`;
  }
}

// The contract measures the description in bytes, and an accented letter takes two.
const MAX_CONCEPT_BYTES = 80;

function bindLinkForm() {
  const form = app.querySelector<HTMLFormElement>("#newlink")!;
  const out = form.querySelector("#linkout")!;
  const show = (html: string) => {
    out.classList.remove("hidden");
    out.innerHTML = html;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (mode === "demo") {
      show(`<p class="error">Issuing a receipt needs the account's signature, and the sample dashboard is read-only. Below, under "Awaiting payment", there is an issued receipt you can open and pay.</p>`);
      return;
    }
    const d = new FormData(form);
    const gross = toUnits(String(d.get("amount")));
    const ref = String(d.get("ref")).trim();
    const concept = String(d.get("concept")).trim();
    if (gross <= 0n || !ref) return;
    if (new TextEncoder().encode(concept).length > MAX_CONCEPT_BYTES) {
      show(`<p class="error">The description is too long for the receipt. Please shorten it a little.</p>`);
      return;
    }
    // Without a trustline the account cannot receive the net amount, and the payment would fail
    // on the client's side. It is checked right here, since the value from the load may not have arrived yet.
    if (me.startsWith("G")) {
      try {
        hasTrustline = (await usdcBalance(me)) !== null;
      } catch {
        show(`<p class="error">We couldn't check whether your account accepts USDC. Try again in a moment.</p>`);
        return;
      }
    }
    if (me.startsWith("G") && !hasTrustline) {
      offerTrustline(show, out);
      return;
    }
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>${mode === "passkey" ? "Sign the receipt with your passkey" : "Sign the receipt in Freighter"}`;
    try {
      const hash = await (mode === "passkey" ? issueWithPasskey(me, ref, gross, concept) : issueWithWallet(me, ref, gross, concept));
      const params = new URLSearchParams({ to: me, ref });
      const name = String(d.get("name") ?? "").trim();
      if (name) params.set("name", name);
      // You send this link to a client abroad, so it has to point to the public domain
      // and never to the machine you generated it on.
      const url = `${PUBLIC_BASE}/pay.html?${params}`;
      show(`<p class="u"><i class="ph-light ph-seal-check" aria-hidden="true"></i> Receipt ${esc(ref)} issued on chain for ${fromUnits(gross)} USDC. <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">View transaction <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></p>
        <code class="mono">${esc(url)}</code>
        <div class="row2"><button type="button" class="btn ghost" id="copy"><i class="ph-light ph-copy" aria-hidden="true"></i>Copy</button>
        <a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>Open</a></div>`);
      out.querySelector<HTMLButtonElement>("#copy")!.addEventListener("click", (ev) => copy(ev.currentTarget as HTMLButtonElement, url));
      form.reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      show(`<p class="error">${/#6\b|ReceiptExists|already used/.test(msg)
        ? `You already issued a receipt with number ${esc(ref)}. Each receipt can be issued only once, so use the next number.`
        : esc(msg || "Could not issue the receipt.")}</p>`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-light ph-plus" aria-hidden="true"></i>Issue receipt and create link`;
    }
  });
}

function offerTrustline(show: (html: string) => void, out: Element) {
  show(`<p class="error">Your account doesn't accept USDC yet, so your client's payment would fail at signing. Enable it once and issue the receipt again.</p>
    <button type="button" class="btn ghost" id="trust"><i class="ph-light ph-plus-circle" aria-hidden="true"></i>Accept USDC on my account</button>`);
  out.querySelector<HTMLButtonElement>("#trust")!.addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    b.innerHTML = `<span class="spin"></span>Sign with Freighter`;
    try {
      await addUsdcTrustline(me);
      hasTrustline = true;
      show(`<p class="u">Done: your account now accepts USDC. Issue the receipt again.</p>`);
    } catch (err) {
      b.disabled = false;
      b.innerHTML = `Retry`;
      out.insertAdjacentHTML("beforeend", `<p class="error">${esc(err instanceof Error ? err.message : "Could not enable USDC.")}</p>`);
    }
  });
}

// State of the withdrawal through the test anchor. It lives outside the DOM because the
// threshold block is repainted on every field change, and the withdrawal must survive that.
type SepState = { token: string; id: string; tx?: AnchorTx; msg: string; busy: boolean; hashes: string[] };
let sep: SepState | null = null;
const SEP_POLL_MS = 3000;
// Ten minutes to fill in the anchor's form and let it settle; after that, polling stops.
const SEP_POLL_LIMIT = 200;

function renderSep24() {
  const box = app.querySelector("#sep24");
  if (!box) return;
  if (mode !== "freighter") {
    box.innerHTML = `<small>${mode === "demo"
      ? "With an account connected through Freighter, this step runs the full SEP-24 withdrawal on testnet against the SDF test anchor."
      : "Withdrawing through the test anchor works today with Freighter. A passkey wallet needs the anchor's SEP-45 authentication, which is not wired in."}</small>`;
    return;
  }
  const t = sep?.tx;
  const links = (sep?.hashes ?? []).map((h) => `<a href="${EXPLORER}/tx/${h}" target="_blank" rel="noopener">${short(h)} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>`).join(" · ");
  box.innerHTML = `
    <p><b>Try it on testnet.</b> The SDF test anchor speaks the same protocol, SEP-24, and simulates the payout to a bank: no real soles and no real bank are involved. Your reserve leaves the contract and reaches the anchor in two signatures. That anchor accepts up to 10 USDC per withdrawal, so withdraw part of it.</p>
    ${!sep ? `<button type="button" class="btn ghost" id="sep24-go" ${!reserve ? "disabled" : ""}><i class="ph-light ph-bank" aria-hidden="true"></i>Withdraw the reserve through the test anchor</button>` : ""}
    ${t?.status === "pending_user_transfer_start" && !sep?.busy
      ? `<button type="button" class="btn" id="sep24-send"><i class="ph-light ph-paper-plane-tilt" aria-hidden="true"></i>Send ${esc(t.amount_in ?? "")} USDC to the anchor</button>` : ""}
    ${sep ? `<p class="u" role="status">${sep.busy ? `<span class="spin"></span> ` : ""}${esc(sep.msg)}${
      t?.more_info_url ? ` <a href="${esc(t.more_info_url)}" target="_blank" rel="noopener">View the withdrawal at the anchor <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>` : ""}</p>` : ""}
    ${links ? `<p class="u">Transactions: ${links}</p>` : ""}`;
  box.querySelector("#sep24-go")?.addEventListener("click", startSep24);
  box.querySelector("#sep24-send")?.addEventListener("click", sendSep24);
}

const SEP_STATUS: Record<string, string> = {
  incomplete: "Fill in your details in the anchor's window.",
  pending_user_transfer_start: "The anchor received your details and is waiting for the USDC.",
  pending_anchor: "The anchor is processing the withdrawal.",
  pending_stellar: "The anchor is confirming the payment on Stellar.",
  pending_external: "The anchor is sending the money to the test bank.",
  completed: "Withdrawal completed by the test anchor.",
  error: "The anchor marked the withdrawal as failed with an error.",
  expired: "The withdrawal expired before it completed.",
  refunded: "The anchor refunded the money.",
};

async function startSep24() {
  // The window opens inside the click: if it opens after an await, the browser blocks it.
  const popup = window.open("", "_blank");
  sep = { token: "", id: "", msg: "Sign with Freighter to identify yourself to the anchor.", busy: true, hashes: [] };
  renderSep24();
  try {
    const lim = await withdrawLimits();
    const available = Number(fromUnits(reserve ?? 0n, 7).replace(/,/g, ""));
    if (available < lim.min) throw new Error(`The test anchor needs at least ${lim.min} USDC per withdrawal and your reserve holds ${available}.`);
    // The test anchor caps each withdrawal, so propose the smaller of the two.
    const amount = Math.min(available, lim.max);
    sep.token = await anchorLogin(me);
    sep.msg = `Opening the anchor's form for ${amount} USDC (it accepts between ${lim.min} and ${lim.max} per withdrawal)…`;
    renderSep24();
    const { id, url } = await startWithdraw(sep.token, me, String(amount));
    sep.id = id;
    if (popup) popup.location.href = url;
    sep.msg = popup ? SEP_STATUS.incomplete : "Your browser blocked the anchor's window.";
    renderSep24();
    if (!popup) app.querySelector("#sep24 [role=status]")?.insertAdjacentHTML("beforeend", ` <a href="${esc(url)}" target="_blank" rel="noopener">Open the form</a>`);
    pollSep24(0);
  } catch (err) {
    popup?.close();
    sep = { token: "", id: "", msg: err instanceof Error ? err.message : "Could not start the withdrawal.", busy: false, hashes: [] };
    renderSep24();
    sep = null;
  }
}

async function pollSep24(n: number) {
  if (!sep?.id || n > SEP_POLL_LIMIT) return;
  try {
    const tx = await anchorTx(sep.token, sep.id);
    const changed = tx.status !== sep.tx?.status;
    sep.tx = tx;
    // The anchor is waiting for the USDC and nothing has been sent yet: it is the user's turn, so no spinner.
    const waiting = tx.status === "pending_user_transfer_start" && sep.hashes.length === 0;
    const finished = ["completed", "error", "expired", "refunded"].includes(tx.status);
    if (changed) {
      sep.msg = SEP_STATUS[tx.status] ?? `Anchor status: ${tx.status}.`;
      sep.busy = !waiting && !finished;
      renderSep24();
    }
    if (finished) {
      reserve = await taxReserve(me).catch(() => reserve);
      return;
    }
  } catch { /* a network failure does not stop the tracking */ }
  setTimeout(() => pollSep24(n + 1), SEP_POLL_MS);
}

async function sendSep24() {
  const t = sep?.tx;
  if (!sep || !t?.withdraw_anchor_account || !t.amount_in) return;
  const amount = toUnits(t.amount_in);
  if (reserve === null || amount > reserve) {
    sep.msg = "The anchor is asking for more than your reserve holds. Fix the amount in its form.";
    renderSep24();
    return;
  }
  sep.busy = true;
  sep.msg = "Signature 1 of 2: you withdraw the reserve from the contract to your account.";
  renderSep24();
  try {
    sep.hashes.push(await withdrawWithWallet(me, me, amount));
    sep.msg = "Signature 2 of 2: you send the USDC to the anchor with the withdrawal reference.";
    renderSep24();
    sep.hashes.push(await sendUsdcWithMemo(me, t.withdraw_anchor_account, t.amount_in, t.withdraw_memo ?? "", t.withdraw_memo_type ?? "text"));
    sep.msg = "Sent. Waiting for the anchor to confirm…";
    renderSep24();
  } catch (err) {
    sep.busy = false;
    sep.msg = err instanceof Error ? err.message : "Could not send to the anchor.";
    renderSep24();
  }
}
