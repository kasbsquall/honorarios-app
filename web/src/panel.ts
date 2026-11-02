import "./styles.css";
import "./panel.css";
import { StrKey } from "@stellar/stellar-sdk";
import { connectPasskey, createPasskeyWallet, extendWithPasskey, issueWithPasskey, restorePasskey, setProfileWithPasskey, withdrawWithPasskey } from "./passkey";
import {
  CONTRACT_ID, EXPLORER, FREIGHTER_INSTALL, type Issued, type Paid, PERU, type Profile, addUsdcTrustline, bpsFromPct, isPeru, offsetLabel, pctOf, periodOf, readProfile, setProfileWithWallet, connectWallet, extendWithWallet, fromUnits, issueWithWallet, issuedEvents, readReceipt,
  monthGross as chainMonthGross, paidEvents, reserveLiveUntil, sendUsdcWithMemo, short, taxReserve, toUnits, usdcBalance, withdrawWithWallet,
} from "./stellar";
import { dateLocale, initLang, mountLangSwitch, tr } from "./i18n";
import { type AnchorTx, anchorLogin, anchorTx, startWithdraw, withdrawLimits } from "./sep24";
import { openRheDraft } from "./rhe";
import { DIRECTOR_CAP_PEN, DIRECTOR_THRESHOLD_PEN, SUSPENSION_CAP_PEN, THRESHOLD_PEN, UIT_PEN, estimate } from "./tax";
import { MARK, esc, receiptCard, receiptPanelText } from "./ui";

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
// The payment list failed while the contract answered. Without its own flag, events stayed
// null and the panel read it as still loading, forever.
let eventsFailed = false;
const stillLoading = () => events === null && !loadError && !eventsFailed;
// Month-to-date total read from the contract: it outlives the RPC event window.
let monthly: bigint | null = null;
// Issued receipts nobody has paid yet.
let pending: Issued[] = [];
let liveUntil: Date | null = null;
// Only a G account needs a USDC trustline; a smart wallet receives through the SAC without one.
let hasTrustline: boolean | null = null;
// Rate and time zone saved on chain. undefined while reading, null if the freelancer has not chosen yet.
let profile: Profile | null | undefined = undefined;
// The settings step replaces the dashboard while it is open.
let settingsOpen = false;
// Why the settings step opened on its own, shown above the form. A code and not the text,
// so the language switch can repaint it.
let settingsReason: "" | "first" | "issue" = "";
// Error on the intro, kept so the language switch repaints it.
let introError = "";

// `?demo` opens the sample dashboard without going through the intro: it is the link in the README.
// Deferred like the passkey branch, because the panel uses constants declared further down.
// Nothing is painted before the language is known; the passkey lookup runs alongside it.
const isDemo = new URLSearchParams(location.search).has("demo");
const restoring = isDemo ? null : restorePasskey();
initLang().then(() => {
  mountLangSwitch(() => {
    renderWho();
    if (me) render();
    else if (app.childElementCount) renderIntro(introError);
  });
  if (isDemo) queueMicrotask(() => enter(DEMO_ADDRESS, "demo"));
  else restoring!.then((id) => (id ? enter(id, "passkey") : renderIntro()));
});

function enter(address: string, how: Mode) {
  me = address;
  mode = how;
  renderWho();
  render();
  load();
}

function renderWho() {
  if (!me) return;
  document.getElementById("who")!.innerHTML =
    `${mode === "passkey" ? `<i class="ph-light ph-fingerprint" aria-hidden="true"></i> Passkey · ` : ""}${
      mode === "demo" ? `<i class="ph-light ph-eye" aria-hidden="true"></i> ${tr("Sample", "Ejemplo")} · ` : ""}${short(me)}`;
}

function render() {
  if (settingsOpen) renderSettings();
  else renderPanel();
}

function renderIntro(error = "") {
  introError = error;
  app.innerHTML = `
  <div class="intro-wrap">
  <section class="intro rise">
    <p class="lbl">${tr("For freelancers paid by clients abroad", "Para freelancers que cobran a clientes del exterior")}</p>
    <h1>${tr("Set aside your taxes the moment a foreign client pays you.", "Aparta tus impuestos en el momento en que te paga un cliente del exterior.")}</h1>
    <p>${tr(
      "When a client abroad pays you, the full amount lands in your account. Nobody withholds anything, and the tax is due weeks or months later. By then the money is often spent.",
      "Cuando un cliente del exterior te paga, el monto completo llega a tu cuenta. Nadie te retiene nada y el impuesto vence semanas o meses después. Para entonces, muchas veces ese dinero ya se gastó.")}</p>
    <p>${tr(
      "Here every payment goes through a contract on Stellar. The share you choose is held in a reserve in your name that only you can move, and the rest lands in your wallet. Peru is the first fully supported country: 8% for the income-tax prepayment, with SUNAT's monthly threshold tracked for you. Anywhere else you pick the percentage, and the app makes no claim about your country's rules.",
      "Aquí cada cobro pasa por un contrato en Stellar. La parte que eliges queda en una reserva a tu nombre que solo tú puedes mover, y el resto llega a tu wallet. Perú es el primer país con soporte completo: 8% para el pago a cuenta del impuesto a la renta, y la app sigue por ti el umbral mensual de SUNAT. En cualquier otro país eliges el porcentaje y la app no afirma nada sobre las reglas de tu país.")}</p>
    <label class="field name"><span class="lbl">${tr("Your name", "Tu nombre")}</span><input id="name" maxlength="40" placeholder="${tr("How it should appear on your passkey", "Como quieres que aparezca en tu passkey")}"></label>
    <div class="actions">
      <button class="btn" id="create"><i class="ph-light ph-fingerprint" aria-hidden="true"></i>${tr("Create wallet with passkey", "Crear wallet con passkey")}</button>
      <button class="btn ghost" id="login"><i class="ph-light ph-key" aria-hidden="true"></i>${tr("I already have a passkey", "Ya tengo una passkey")}</button>
    </div>
    <p class="alt">${tr(
      "No seed phrase: your fingerprint or Face ID signs. Network fees are covered by the SDF relayer on testnet.",
      "Sin frase semilla: firmas con tu huella o Face ID. Las comisiones de red las cubre el relayer de SDF en testnet.")} <button class="linkbtn" id="freighter">${tr("I'd rather use Freighter", "Prefiero usar Freighter")}</button></p>
    <p class="alt"><button class="linkbtn" id="demo"><i class="ph-light ph-eye" aria-hidden="true"></i> ${tr("View a sample dashboard", "Ver un panel de ejemplo")}</button> ${tr("using the demo account, with nothing to install.", "con la cuenta de la demo, sin instalar nada.")}</p>
    ${error ? `<p class="error" role="alert">${esc(error)}${
      /Freighter extension|extensión Freighter/.test(error)
        ? ` <a href="${FREIGHTER_INSTALL}" target="_blank" rel="noopener">${tr("Install Freighter", "Instalar Freighter")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>`
        : ""}</p>` : ""}
  </section>
  <aside class="intro-demo rise" style="--i:1" aria-label="${tr("Example of a split payment", "Ejemplo de un cobro repartido")}">
    ${receiptCard({
      // Peru preset and the fee deployed today (zero): 500 USDC splits into 460 and 40.
      gross: toUnits("500"), title: tr("Brand identity design", "Diseño de identidad de marca"), ref: "E001-1",
      text: receiptPanelText(), taxBps: PERU.taxBps,
      badge: `<span class="badge accent">${tr("Example", "Ejemplo")}</span>`,
    })}
    <p class="u">${tr(
      "What a 500 USDC payment looks like with Peru's 8%: 460 land in your wallet and 40 stay in the contract, in your name.",
      "Así se ve un cobro de 500 USDC con el 8% de Perú: 460 llegan a tu wallet y 40 quedan en el contrato, a tu nombre.")}</p>
  </aside>
  </div>
  <section class="how rise" style="--i:2">
    <ol>
      <li><span class="lbl">01</span><div><b>${tr("You issue your receipt and send the link", "Emites tu recibo y envías el link")}</b><small>${tr(
        "Amount, receipt number and description. The receipt is recorded in the contract, and your client can pay only that amount, once. They pay with Freighter; if they only hold XLM, Stellar converts it along the way.",
        "Monto, número de recibo y concepto. El recibo queda registrado en el contrato y tu cliente solo puede pagar ese monto, una vez. Paga con Freighter; si solo tiene XLM, Stellar lo convierte en el camino.")}</small></div></li>
      <li><span class="lbl">02</span><div><b>${tr("The contract splits the payment on the spot", "El contrato reparte el pago en el acto")}</b><small>${tr(
        "Your rate stays reserved in your name inside the contract and the rest lands in your wallet. The rate is written into each receipt when you issue it, so your client sees exactly what they sign. It is a single transaction, and anyone can verify it.",
        "Tu tasa queda reservada a tu nombre dentro del contrato y el resto llega a tu wallet. La tasa se graba en cada recibo al emitirlo, así tu cliente ve exactamente lo que firma. Es una sola transacción y cualquiera puede verificarla.")}</small></div></li>
      <li><span class="lbl">03</span><div><b>${tr("You withdraw when it's time to file", "Retiras cuando toca declarar")}</b><small>${tr(
        "In Peru, the dashboard estimates your prepayment for the month, explains how to pay it in soles and prepares a draft of your Recibo por Honorarios Electrónico (electronic fee receipt). Elsewhere it shows what you received this month and what is set aside.",
        "En Perú, el panel estima tu pago a cuenta del mes, explica cómo pagarlo en soles y te prepara el borrador de tu Recibo por Honorarios Electrónico. En otros países muestra lo que cobraste este mes y lo que está apartado.")}</small></div></li>
    </ol>
    <p class="alt"><a href="${EXPLORER}/contract/${CONTRACT_ID}" target="_blank" rel="noopener"><i class="ph-light ph-file-code" aria-hidden="true"></i> ${tr("The contract on Stellar Expert", "El contrato en Stellar Expert")}</a> · ${tr("open source", "código abierto")} · Stellar testnet</p>
    <p class="alt price"><i class="ph-light ph-receipt" aria-hidden="true"></i> ${tr(
      "<b>What it would cost:</b> the plan is to charge 0.5% per settled payment, with no monthly fee. The contract has a hard cap of 1% that its constructor refuses to exceed, and <b>today it is deployed at zero</b>. You don't have to take our word for it: the fee is public on chain, and the payment screen reads it from there before your client signs.",
      "<b>Qué costaría usarlo:</b> el plan es cobrar 0.5% por cobro liquidado, sin cuota mensual. El contrato tiene un tope duro de 1% que su constructor se niega a superar, y <b>hoy está desplegado en cero</b>. No tienes que creernos: la comisión es pública en la cadena y la pantalla de pago la lee de ahí antes de que tu cliente firme.")}</p>
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
        renderIntro(err instanceof Error ? err.message : tr("Could not connect.", "No se pudo conectar."));
      }
    });

  run("create", tr("Creating your wallet", "Creando tu wallet"), "passkey", () =>
    createPasskeyWallet(app.querySelector<HTMLInputElement>("#name")!.value.trim()));
  run("login", tr("Waiting for your passkey", "Esperando tu passkey"), "passkey", connectPasskey);
  run("freighter", tr("Waiting for Freighter", "Esperando a Freighter"), "freighter", connectWallet);
}

async function load() {
  // Independent calls. The event scan is the fragile one (many windows against the public
  // RPC); if it fails it must not wipe the reserve, which already answered.
  const isG = me.startsWith("G");
  const [r, e, m, iss, ttl, tl, pr] = await Promise.allSettled([
    taxReserve(me), paidEvents(me), chainMonthGross(me), issuedEvents(me), reserveLiveUntil(me),
    isG ? usdcBalance(me) : Promise.resolve(0n), readProfile(me),
  ]);
  // A failed read stays undefined: "no profile" would send the user to set one they may already have.
  profile = pr.status === "fulfilled" ? pr.value : undefined;
  reserve = r.status === "fulfilled" ? r.value : null;
  events = e.status === "fulfilled" ? e.value : null;
  eventsFailed = e.status === "rejected";
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
  // First visit of a new account: the rate has to be chosen before anything else makes sense.
  if (profile === null && mode !== "demo" && !settingsOpen) {
    settingsOpen = true;
    settingsReason = "first";
  }
  render();
}

// The contract closes the month at midnight in the freelancer's time zone. The panel measures
// the same way, without depending on the browser's time zone. Without a profile the contract uses UTC.
const offsetNow = () => profile?.utcOffsetMin ?? 0;
const tzMonth = (d: Date) => periodOf(d, offsetNow());
const PERU_OFFSET_MS = -PERU.utcOffsetMin * 60_000;

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
  const loading = stillLoading();
  const list = events ?? [];
  // The dashboard frames one month: adding payments from earlier months would mix periods.
  const thisMonth = list.filter((p) => tzMonth(p.at) === tzMonth(new Date()));
  // Threshold, SUNAT estimate and receipt draft exist only for the verified Peru preset.
  const peru = isPeru(profile);
  const rate = profile ? pctOf(profile.taxBps) : null;
  const net = thisMonth.reduce((s, p) => s + p.net, 0n);
  // With no data, no number is painted: a 0 asserts something we don't know.
  const val = (fn: () => string) => (loading ? "" : loadError ? "—" : fn());
  // Figures added up from the payment list: if the list failed, they are unknown, not zero.
  const valList = (fn: () => string) => (eventsFailed ? "—" : val(fn));

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
    !peru || loading || loadError || gap === null ? ""
    : est.duePen === 0 && fxOdd ? `<span class="tag warn"><i class="ph-light ph-warning" aria-hidden="true"></i>${tr("Check the exchange rate before relying on this", "Revisa el tipo de cambio antes de fiarte de esto")}</span>`
    : est.duePen === 0 && est.provisional ? `<span class="tag"><i class="ph-light ph-dots-three-circle" aria-hidden="true"></i>${tr("Confirm your other income for the month to know whether there is anything to cover", "Confirma tus otras rentas del mes para saber si hay algo que cubrir")}</span>`
    : est.duePen === 0 ? `<span class="tag ok"><i class="ph-light ph-check" aria-hidden="true"></i>${tr("No income-tax prepayment to cover this month", "Este mes no hay pago a cuenta que cubrir")}</span>`
    : gap > 0.5 ? `<span class="tag warn"><i class="ph-light ph-warning" aria-hidden="true"></i>${tr(`Short by ${pen2(gap)} to cover the ${pen2(est.duePen!)} payment`, `Faltan ${pen2(gap)} para cubrir el pago de ${pen2(est.duePen!)}`)}${
        mode === "demo" ? tr(", because this account withdrew the reserve before the month closed", ", porque esta cuenta retiró la reserva antes del cierre del mes") : ""}</span>`
    : `<span class="tag ok"><i class="ph-light ph-check" aria-hidden="true"></i>${tr(`Enough for the ${pen2(est.duePen!)} payment`, `Alcanza para el pago de ${pen2(est.duePen!)}`)}</span>`;

  app.innerHTML = `
  ${loadError ? `<p class="error" role="alert"><i class="ph-light ph-warning" aria-hidden="true"></i> ${tr(
    "We couldn't read your payments from the network. What you see here is not your balance: reload in a moment.",
    "No pudimos leer tus cobros de la red. Lo que ves aquí no es tu saldo: recarga en un momento.")} <button class="linkbtn" id="retry">${tr("Retry", "Reintentar")}</button>${
    mode !== "demo" ? tr(
      ` If your reserve has had no activity for over a month, the network may have archived it: <button class="linkbtn renew">restore it</button>, without moving funds.`,
      ` Si tu reserva lleva más de un mes sin movimiento, la red pudo archivarla: <button class="linkbtn renew">restáurala</button>, sin mover fondos.`) : ""}</p>` : ""}
  ${mode === "demo" ? `<p class="note" role="status"><i class="ph-light ph-eye" aria-hidden="true"></i> ${tr(
    `Sample dashboard with a test account on testnet: receipts, payments, the reserve and the month-to-date total are read live from the chain. This month crosses the threshold, so the block below shows a real income-tax prepayment. The reserve falls short of it on purpose: this account withdrew part of its reserve before the month closed, which is exactly what the app warns against. Issuing receipts and withdrawing need that account's signature. What you can do is open a receipt under "Awaiting payment" and pay it with Freighter on testnet.`,
    `Panel de ejemplo con una cuenta de pruebas en testnet: los recibos, los cobros, la reserva y el acumulado del mes se leen de la cadena en vivo. Este mes cruza el umbral, así que el bloque de abajo muestra un pago a cuenta real. La reserva se queda corta a propósito: esta cuenta retiró parte de su reserva antes del cierre del mes, que es justo lo que la app advierte que no conviene hacer. Emitir recibos y retirar necesitan la firma de esa cuenta. Lo que sí puedes hacer es abrir un recibo en "Por cobrar" y pagarlo con Freighter en testnet.`)} <a href="${EXPLORER}/${DEMO_ADDRESS.startsWith("G") ? "account" : "contract"}/${DEMO_ADDRESS}" target="_blank" rel="noopener">${tr("View the account", "Ver la cuenta")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></p>` : ""}
  <section class="hero rise" style="--i:0">
    <div>
      <div class="rc-top"><p class="lbl"><i class="ph-light ph-vault" aria-hidden="true"></i> ${tr("Tax reserve", "Reserva para impuestos")} · ${
        profile === undefined ? tr("reading your rate", "leyendo tu tasa")
        : rate === null ? tr("rate not chosen yet", "tasa aún sin elegir")
        : tr(`${rate}% on new receipts`, `${rate}% en recibos nuevos`)}</p>
        <button type="button" class="linkbtn" id="settings"><i class="ph-light ph-sliders-horizontal" aria-hidden="true"></i> ${tr("Tax settings", "Configuración tributaria")}</button></div>
      <p class="kpi num ${loading ? "sk" : ""}">${val(() => fromUnits(reserve!))}<small>USDC</small></p>
      ${reserveState}
      <p class="kpi-note">${mode === "demo" && reserve === 0n ? tr("This account already withdrew its reserve during the demo, which is why it is at zero. ", "Esta cuenta ya retiró su reserva durante la demo, por eso está en cero. ") : ""}${tr("Only you can move it.", "Solo tú puedes moverla.")} ${peru
        ? tr(`It covers your income-tax prepayment if the month goes over your threshold, S/ ${est.thresholdPen.toLocaleString("en-US")}; if it doesn't, the money stays yours.`,
          `Cubre tu pago a cuenta si el mes supera tu umbral, S/ ${est.thresholdPen.toLocaleString("en-US")}; si no lo supera, el dinero sigue siendo tuyo.`)
        : tr("It is the share you chose to set aside for your taxes. When they are due, withdraw it and pay them.", "Es la parte que elegiste apartar para tus impuestos. Cuando venzan, retírala y págalos.")}</p>
      ${ttlLine()}
      <form id="withdraw" class="withdraw">
        <label class="field"><span class="lbl">${tr("Send reserve to", "Enviar la reserva a")}</span><input class="num" name="to" required placeholder="${tr("Stellar account (G… or C…)", "Cuenta Stellar (G… o C…)")}"></label>
        <label class="field amt"><span class="lbl">${tr("Amount (USDC)", "Monto (USDC)")}</span><input class="num" name="amount" required inputmode="decimal" pattern="\\d+(\\.\\d{1,7})?" value="${reserve ? fromUnits(reserve, 7).replace(/,/g, "").replace(/\.?0+$/, "") : ""}"></label>
        <button class="btn ghost" type="submit" ${!reserve ? "disabled" : ""}><i class="ph-light ph-arrow-square-out" aria-hidden="true"></i>${tr("Withdraw reserve", "Retirar reserva")}</button>
        ${peru && gap !== null && est.duePen === 0 && !est.provisional ? `<p class="u wd-hint">${tr(
          "This month is under the threshold, so this reserve is yours. It is still better to wait until the month closes: one more payment can push it over.",
          "Este mes no supera el umbral, así que esta reserva es tuya. Aun así conviene esperar al cierre del mes: un cobro más puede hacerlo cruzar.")}</p>` : ""}
        <p class="wd-out" role="status">${!reserve && !loading ? `<span class="u">${loadError
          ? tr("We couldn't read your reserve, so it can't be withdrawn yet.", "No pudimos leer tu reserva, así que todavía no se puede retirar.")
          : tr("No reserve to withdraw yet. It shows up here as soon as you receive a payment.", "Todavía no hay reserva que retirar. Aparece aquí en cuanto recibas un cobro.")}</span>` : ""}</p>
      </form>
    </div>
    <dl class="stats">
      <div><dt><i class="ph-light ph-wallet" aria-hidden="true"></i> ${tr("Net received this month", "Neto cobrado este mes")}</dt><dd class="num ${loading ? "sk" : ""}">${valList(() => fromUnits(net))} <small>USDC</small></dd></div>
      <div><dt><i class="ph-light ph-rows" aria-hidden="true"></i> ${tr("Payments this month", "Cobros del mes")}</dt><dd class="num ${loading ? "sk" : ""}">${valList(() => String(thisMonth.length))}</dd></div>
      <div><dt><i class="ph-light ph-percent" aria-hidden="true"></i> ${tr("Reserve rate for new receipts", "Tasa de reserva para recibos nuevos")}</dt><dd class="num">${rate ?? "—"}<small>%</small></dd></div>
    </dl>
  </section>
  <section class="grid2${peru ? "" : " plain"}">
    <div class="block rise" style="--i:1" id="threshold"></div>
    <form class="block rise" style="--i:2" id="newlink">
      <p class="lbl"><i class="ph-light ph-link-simple" aria-hidden="true"></i> ${tr("New receipt and payment link", "Nuevo recibo y link de cobro")}</p>
      <p class="u">${tr("You sign the receipt and it is recorded in the contract. Your client can pay only that amount, once.",
        "Firmas el recibo y queda registrado en el contrato. Tu cliente solo puede pagar ese monto, una vez.")}${
        rate !== null ? tr(` It sets aside ${rate}% of the payment, the rate in your tax settings today.`, ` Aparta el ${rate}% del cobro, la tasa que tienes hoy en tu configuración tributaria.`) : ""}</p>
      <div class="row2">
        <label class="field"><span class="lbl">${tr("Amount (USDC)", "Monto (USDC)")}</span><input class="num" name="amount" inputmode="decimal" required pattern="\\d+(\\.\\d{1,7})?" placeholder="500.00"></label>
        <label class="field"><span class="lbl">${tr("Receipt no.", "N° de recibo")}</span><input class="num" name="ref" required maxlength="20" placeholder="E001-2"></label>
      </div>
      <label class="field"><span class="lbl">${tr("Description", "Concepto")}</span><input name="concept" required maxlength="80" placeholder="${tr("Logo design", "Diseño de logo")}"></label>
      <label class="field"><span class="lbl">${tr("Display name", "Nombre visible")}</span><input name="name" maxlength="60" placeholder="${tr("Optional", "Opcional")}"></label>
      <button class="btn" type="submit"><i class="ph-light ph-plus" aria-hidden="true"></i>${tr("Issue receipt and create link", "Emitir recibo y crear link")}</button>
      <div id="linkout" class="linkout hidden"></div>
    </form>
  </section>
  ${pending.length ? `<section class="rise" style="--i:3">
    <div class="sec-h"><h2>${tr("Awaiting payment", "Por cobrar")}</h2><span class="lbl">${tr("Receipts issued on chain and not yet paid", "Recibos emitidos en la cadena y aún sin pagar")}</span></div>
    <ul class="pending">${pending.map((p, i) => `
      <li class="rise" style="--i:${Math.min(i, 7)}">
        <span class="num">${esc(p.ref)}</span><span>${esc(p.concept)}</span><span class="num">${fromUnits(p.gross)} <small>USDC</small></span>
        <span class="acts"><button type="button" class="btn ghost copy-link" data-ref="${esc(p.ref)}"><i class="ph-light ph-copy" aria-hidden="true"></i>${tr("Copy link", "Copiar link")}</button>
        <a class="btn ghost" href="${esc(payLink(p.ref))}" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>${tr("Open", "Abrir")}</a></span>
      </li>`).join("")}</ul>
  </section>` : ""}
  <section class="rise" style="--i:3">
    <div class="sec-h"><h2>${tr("Payments received", "Cobros recibidos")}</h2><span class="lbl">${tr("Read from the Stellar network", "Leídos de la red Stellar")}</span></div>
    <div class="cards">${
      loading
        ? `<div class="receipt sk" style="height:260px"></div><div class="receipt sk" style="height:260px"></div>`
        : loadError
          ? `<div class="emptybox"><i class="ph-light ph-cloud-slash" aria-hidden="true"></i><p>${tr("We couldn't read the network, so we don't know whether you have payments this month.", "No pudimos leer la red, así que no sabemos si tienes cobros este mes.")}</p></div>`
        : eventsFailed
          ? `<div class="emptybox"><i class="ph-light ph-cloud-slash" aria-hidden="true"></i><p>${tr(
              "We couldn't read the detail of your payments from the network. The figures above come from the contract and are correct; reload in a moment to see each payment.",
              "No pudimos leer de la red el detalle de tus cobros. Las cifras de arriba vienen del contrato y son correctas; recarga en un momento para ver cada cobro.")}</p></div>`
          : list.length
          ? list.map((p, i) => `<div class="rise" style="--i:${Math.min(i, 7)}">${receiptCard({
              gross: p.gross, title: tr(`From ${short(p.payer)}`, `De ${short(p.payer)}`), ref: p.ref, text: receiptPanelText(), taxBps: p.taxBps,
              actual: { net: p.net, tax: p.tax, fee: p.fee },
              badge: `<span class="badge ok"><i class="ph-light ph-check" aria-hidden="true"></i>${tr("Paid", "Pagado")}</span>`,
              footLeft: p.at.toLocaleDateString(dateLocale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
              txHash: p.txHash,
            })}${peru ? `<button class="btn ghost rhe-open" data-i="${i}"><i class="ph-light ph-file-text" aria-hidden="true"></i>${tr("Draft Recibo por Honorarios (fee receipt)", "Borrador del Recibo por Honorarios")}</button>` : ""}</div>`).join("")
          : (monthly !== null && monthly > 0n) || (reserve !== null && reserve > 0n)
          ? `<div class="emptybox"><i class="ph-light ph-clock-counter-clockwise" aria-hidden="true"></i><p>${tr(
              "The contract has payments of yours this month, but the node no longer keeps their events: testnet retains about a week. The figures above come from the contract and are exact. What is missing here is the detail of each payment.",
              "El contrato tiene cobros tuyos este mes, pero el nodo ya no guarda sus eventos: testnet conserva alrededor de una semana. Las cifras de arriba vienen del contrato y son exactas. Lo que falta aquí es el detalle de cada cobro.")}</p></div>`
          : `<div class="emptybox"><i class="ph-light ph-receipt" aria-hidden="true"></i><p>${tr("No payments yet. Create a link and send it to your client.", "Todavía no tienes cobros. Crea un link y envíalo a tu cliente.")}</p></div>`
    }</div>
  </section>`;

  // Without the contract's month-to-date total there is no reliable base: events only cover
  // the RPC window, and a short base produces the one error this product cannot make.
  if (peru) renderThreshold();
  else renderMonthPlain(thisMonth);
  app.querySelector("#settings")!.addEventListener("click", () => openSettings(""));
  bindLinkForm();
  bindWithdraw();
  app.querySelector("#retry")?.addEventListener("click", () => {
    loadError = false;
    eventsFailed = false;
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
      out.innerHTML = `<span class="error">${tr("The sample dashboard is read-only. Create your wallet with a passkey to withdraw.", "El panel de ejemplo es solo de lectura. Crea tu wallet con passkey para retirar.")}</span>`;
      return;
    }
    const d = new FormData(form);
    const to = String(d.get("to")).trim();
    const amount = toUnits(String(d.get("amount")));
    if (!StrKey.isValidEd25519PublicKey(to) && !StrKey.isValidContract(to)) {
      out.innerHTML = `<span class="error">${tr("That address is not valid on Stellar.", "Esa dirección no es válida en Stellar.")}</span>`;
      return;
    }
    if (amount <= 0n || (reserve !== null && amount > reserve)) {
      out.innerHTML = `<span class="error">${tr("The amount must be greater than 0 and no more than your reserve.", "El monto debe ser mayor que 0 y no pasar de tu reserva.")}</span>`;
      return;
    }
    const btn = form.querySelector("button")!;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>${mode === "passkey" ? tr("Confirm with your passkey", "Confirma con tu passkey") : tr("Sign with Freighter", "Firma con Freighter")}`;
    try {
      const hash = mode === "passkey" ? await withdrawWithPasskey(me, to, amount) : await withdrawWithWallet(me, to, amount);
      reserve = await taxReserve(me);
      renderPanel();
      app.querySelector("#withdraw .wd-out")!.innerHTML =
        `${tr(`You withdrew ${fromUnits(amount)} USDC.`, `Retiraste ${fromUnits(amount)} USDC.`)} <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${tr("View transaction", "Ver transacción")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>`;
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-light ph-arrow-square-out" aria-hidden="true"></i>${tr("Withdraw reserve", "Retirar reserva")}`;
      out.innerHTML = `<span class="error">${esc(err instanceof Error ? err.message : tr("Could not withdraw.", "No se pudo retirar."))}</span>`;
    }
  });
}

function renderThreshold() {
  const box = app.querySelector("#threshold")!;
  // While the chain has not answered, the estimate is not "impossible to compute", it is
  // simply not known yet. Without telling the two cases apart, the panel complained about a
  // missing exchange rate that was actually set. It is derived from module state so the
  // re-renders triggered by the fields below do not lose it.
  const loading = stillLoading();
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
  const month = new Date(Date.now() - PERU_OFFSET_MS).toLocaleDateString(dateLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
  const state =
    loading ? `<span class="badge"><i class="ph-light ph-circle-dashed" aria-hidden="true"></i>${tr("Reading the chain", "Leyendo la cadena")}</span>`
    : grossUnavailable ? `<span class="badge warn"><i class="ph-light ph-cloud-slash" aria-hidden="true"></i>${tr("Couldn't read this month's payments", "No se pudieron leer los cobros del mes")}</span>`
    : pen === null ? `<span class="badge"><i class="ph-light ph-question" aria-hidden="true"></i>${tr("Exchange rate missing", "Falta el tipo de cambio")}</span>`
    : !over && fxOdd ? `<span class="badge warn"><i class="ph-light ph-warning" aria-hidden="true"></i>${tr("Check the exchange rate", "Revisa el tipo de cambio")}</span>`
    : over ? `<span class="badge warn"><i class="ph-light ph-warning" aria-hidden="true"></i>${tr("Over the threshold", "Supera el umbral")}</span>`
    : est.provisional ? `<span class="badge"><i class="ph-light ph-dots-three-circle" aria-hidden="true"></i>${tr("Confirm your other income", "Confirma tus otras rentas")}</span>`
    : `<span class="badge ok"><i class="ph-light ph-check" aria-hidden="true"></i>${tr("Under the threshold", "Bajo el umbral")}</span>`;

  box.innerHTML = `
    <div class="rc-top"><p class="lbl"><i class="ph-light ph-calendar-blank" aria-hidden="true"></i> ${tr("Income-tax prepayment", "Pago a cuenta")} · ${month}</p>${state}</div>
    <p class="th-num num ${loading ? "sk" : ""}">${loading ? tr("Reading…", "Leyendo…") : due === null ? "S/ —" : soles(due)}</p>
    <p class="th-cap">${
      loading ? tr("reading this month's payments from the chain", "leyendo de la cadena los cobros del mes")
      : due === null ? tr("this app can't estimate it", "esta app no puede estimarlo")
      : tr(`estimate only, this is not your tax return · in soles at an exchange rate of ${fx}${fxIsSample ? " (sample rate)" : ", as you entered it"}`,
        `solo es un estimado, no es tu declaración · en soles a un tipo de cambio de ${fx}${fxIsSample ? " (de ejemplo)" : ", el que ingresaste"}`)}</p>
    <div class="meter" title="${tr(`${soles(threshold)} is the threshold`, `El umbral es ${soles(threshold)}`)}"><i style="transform:scaleX(${ratio})" class="${over ? "over" : ""}"></i></div>
    <p class="th-scale"><span>${pen === null ? tr("month to date", "acumulado del mes") : tr(`month to date ${soles(pen)}`, `acumulado del mes ${soles(pen)}`)}</span><span>${tr("threshold", "umbral")} ${soles(threshold)}${
      over && pen ? ` · ${(pen / threshold).toFixed(1).replace(".0", "")} ${tr("times the threshold", "veces el umbral")}` : ""}</span></p>
    <div class="th-body"><div>
    <dl class="th-rows">
      <div><dt>${tr("Received through this app", "Cobrado con esta app")}</dt><dd class="num">${viaApp === null ? "—" : soles(viaApp)}</dd></div>
      <div><dt>${tr("Other fourth-category income (independent work) this month", "Otras rentas de cuarta categoría del mes")}</dt><dd class="num">${soles(other)}</dd></div>
      <div><dt>${tr("<b>Prepayment base</b> (fourth category)", "<b>Base del pago a cuenta</b> (cuarta categoría)")}</dt><dd class="num">${fourthBase === null ? "—" : soles(fourthBase)}</dd></div>
      <div><dt>${tr("Fifth-category income (employment), for the threshold only", "Rentas de quinta categoría, solo para el umbral")}</dt><dd class="num">${soles(fifth)}</dd></div>
      <div><dt>${tr("Month total against the threshold", "Total del mes frente al umbral")}</dt><dd class="num">${pen === null ? "—" : soles(pen)} <span class="u">${tr("of", "de")} ${soles(threshold)}</span></dd></div>
      <div class="wide"><dt>${tr("Rule", "Regla")}</dt><dd>${tr(
        `if the month total goes over the threshold, 8% of the fourth-category base is due. If it doesn't, there is no prepayment this month. Your threshold is ${soles(threshold)}, the one in item ${director ? "b)" : "a)"} of article 3 of Resolución de Superintendencia 000390-2025/SUNAT (a SUNAT resolution)${director ? ", which applies to company directors, síndicos (trustees), mandatarios (agents), gestores de negocios (business managers), albaceas (executors) and regidores (city councillors)" : ""}.`,
        `si el total del mes supera el umbral, se paga el 8% de la base de cuarta categoría. Si no lo supera, no hay pago a cuenta este mes. Tu umbral es ${soles(threshold)}, el del literal ${director ? "b)" : "a)"} del artículo 3 de la Resolución de Superintendencia 000390-2025/SUNAT${director ? ", que aplica a directores de empresas, síndicos, mandatarios, gestores de negocios, albaceas y regidores" : ""}.`)}</dd></div>
      <div><dt>${tr("Fourth-category tax already withheld", "Retenciones de cuarta categoría que ya te hicieron")}</dt><dd class="num">− ${soles(withheld)}</dd></div>
    </dl>
    <p class="th-help">${
      loading
        ? tr("We're reading from the chain how much you've been paid this month. The estimate shows up here as soon as it answers.",
          "Estamos leyendo de la cadena cuánto llevas cobrado este mes. En cuanto responda, el estimado aparece aquí.")
      : grossUnavailable
        ? tr("The contract did not report how much you've been paid this month, so we are not estimating anything. We don't fall back on the payment list below: the node only keeps the last few days and the total would come up short, which is the worst possible error in a tax calculation. Reload in a moment.",
          "El contrato no informó cuánto llevas cobrado este mes, así que no estimamos nada. No usamos la lista de cobros de abajo para reemplazarlo: el nodo solo guarda los últimos días y la suma saldría corta, que en un cálculo de impuestos es el peor error posible. Recarga en un momento.")
      : pen === null
        ? tr("Enter the exchange rate to estimate this month's income-tax prepayment.", "Ingresa el tipo de cambio para estimar el pago a cuenta de este mes.")
        : over
          ? (() => {
              // Actually compare the reserve with the amount due, instead of claiming it covers it.
              const reserveInPen = reserve === null || !fx ? null : Number(fromUnits(reserve, 2).replace(/,/g, "")) * fx;
              if (reserveInPen === null) {
                return tr("The reserve is in USDC and the amount due is in soles, so the exchange rate on the day you pay moves the result.",
                  "La reserva está en USDC y el monto a pagar en soles, así que el tipo de cambio del día en que pagues mueve el resultado.");
              }
              const shortfall = (due ?? 0) - reserveInPen;
              return shortfall > 0.5
                ? tr(`At this exchange rate your reserve is worth ${soles(reserveInPen)}, which leaves you ${soles(shortfall)} short of the payment. The reserve is in USDC and the amount due is in soles, so the exchange rate on the day you pay moves the result.`,
                  `Con este tipo de cambio tu reserva equivale a ${soles(reserveInPen)}, así que te faltan ${soles(shortfall)} para cubrir el pago. La reserva está en USDC y el monto a pagar en soles, así que el tipo de cambio del día en que pagues mueve el resultado.`)
                : tr(`At this exchange rate your reserve is worth ${soles(reserveInPen)} and covers the payment. Since it is in USDC and the amount due is in soles, the exchange rate on the day you pay moves the result.`,
                  `Con este tipo de cambio tu reserva equivale a ${soles(reserveInPen)} y alcanza para el pago. Como está en USDC y el monto a pagar es en soles, el tipo de cambio del día en que pagues mueve el resultado.`);
            })()
          : est.provisional
            ? tr("What you were paid through this app does not cross the threshold, but the threshold is measured on everything you earned this month. Fill in your other income above and confirm it. Until then, the app does not say you owe nothing.",
              "Lo cobrado con esta app no cruza el umbral, pero el umbral se mide sobre todo lo que ganaste este mes. Completa arriba tus otras rentas y confírmalas. Hasta entonces, la app no dice que no debes nada.")
            : tr("Based on what you entered here there would be no prepayment, and the contract still set aside 8% of every payment: the reserve is a fixed rule and does not check the threshold. That money is yours and you can withdraw it. Wait until the month closes to do so, because one more payment can cross the threshold and the 8% applies to the whole month.",
              "Con lo que ingresaste aquí no habría pago a cuenta, y aun así el contrato apartó el 8% de cada cobro: la reserva es una regla fija y no consulta el umbral. Ese dinero es tuyo y puedes retirarlo. Espera al cierre del mes para hacerlo, porque un cobro más puede cruzar el umbral y el 8% se aplica a todo el mes.")
    }</p>
    <p class="th-help"><i class="ph-light ph-warning-circle" aria-hidden="true"></i> ${tr(
      "This is an estimate based on what this app can know. The threshold is measured on all your income for the month, including fourth-category income received outside this app and fifth-category income if you are on a payroll. And the 8% is a prepayment: in the annual return the tax is recalculated on net income, so you may end up with a balance to pay or a credit in your favor.",
      "Esto es un estimado con lo que esta app puede saber. El umbral se mide sobre todos tus ingresos del mes, incluidas las rentas de cuarta categoría cobradas fuera de esta app y las de quinta categoría si estás en planilla. Y el 8% es un pago a cuenta: en la declaración anual el impuesto se recalcula sobre la renta neta, así que puede quedarte saldo por pagar o a favor.")}</p>
    </div><div>
    <div class="row2">
      <label class="field"><span class="lbl">${tr("Other fourth-category income this month (S/)", "Otras rentas de cuarta categoría del mes (S/)")}</span><input class="num other-in" data-k="${OTHER_KEY}" inputmode="decimal" placeholder="0.00" value="${other || ""}"></label>
      <label class="field"><span class="lbl">${tr("Fifth-category income this month (S/)", "Rentas de quinta categoría del mes (S/)")}</span><input class="num other-in" data-k="${FIFTH_KEY}" inputmode="decimal" placeholder="0.00" value="${fifth || ""}"></label>
    </div>
    <label class="field"><span class="lbl">${tr("Tax already withheld from you this month (S/)", "Retenciones que ya te hicieron este mes (S/)")}</span><input class="num other-in" data-k="${HELD_KEY}" inputmode="decimal" placeholder="0.00" value="${withheld || ""}"></label>
    <label class="check"><input type="checkbox" id="done4" ${confirmed ? "checked" : ""}><span>${tr("I've checked: this is everything I earned this month", "Ya revisé: esto es todo lo que gané este mes")}<small>${tr(
      `The amounts above are for ${month}. Until you confirm, the app does not claim you have no prepayment due.`,
      `Los montos de arriba son de ${month}. Mientras no lo confirmes, la app no afirma que no tienes pago a cuenta.`)}</small></span></label>
    <label class="check"><input type="checkbox" id="dir4" ${director ? "checked" : ""}><span>${tr("My fourth-category income comes from serving as a director, mandatario (agent), regidor (city councillor), síndico (trustee) or albacea (executor)",
      "Mis rentas de cuarta categoría vienen de mi función como director, mandatario, regidor, síndico o albacea")}<small>${tr(
      `That group has its own threshold, S/ ${DIRECTOR_THRESHOLD_PEN.toLocaleString("en-US")} a month instead of S/ ${THRESHOLD_PEN.toLocaleString("en-US")}, under item b) of article 3 of the resolution. Tick it and the app compares you against that one.`,
      `Ese grupo tiene su propio umbral, S/ ${DIRECTOR_THRESHOLD_PEN.toLocaleString("en-US")} al mes en vez de S/ ${THRESHOLD_PEN.toLocaleString("en-US")}, según el literal b) del artículo 3 de la resolución. Márcalo y la app te compara contra ese.`)}</small></span></label>
    <details class="howto" ${sep ? "open" : ""}>
      <summary><i class="ph-light ph-list-numbers" aria-hidden="true"></i> ${tr("How to pay SUNAT", "Cómo pagarle a SUNAT")}</summary>
      <ol>
        <li>${tr("Withdraw the reserve to your wallet and convert it to soles. SUNAT only accepts soles.", "Retira la reserva a tu wallet y conviértela a soles. SUNAT solo recibe soles.")}
          <div id="offramp" class="offramp"><span class="spin"></span> ${tr("Checking soles anchors on Stellar…", "Consultando anclas de soles en Stellar…")}</div>
          <div id="sep24" class="offramp"></div>
        </li>
        <li>${tr("Log in to SUNAT Operaciones en Línea (SUNAT's online portal) with your Clave SOL (SUNAT login password) and go to Mis declaraciones y pagos (returns and payments), Trabajadores independientes (independent workers): Formulario Virtual 616 (SUNAT's online payment form).",
          "Entra a SUNAT Operaciones en Línea con tu Clave SOL y ve a Mis declaraciones y pagos, Trabajadores independientes: Formulario Virtual 616.")}</li>
        <li>${tr("Declare what you were paid in the month and pay with an NPS (Número de Pago SUNAT, a payment code) or online. The due date depends on the last digit of your RUC (taxpayer ID):",
          "Declara lo cobrado en el mes y paga con un NPS (Número de Pago SUNAT) o en línea. El vencimiento depende del último dígito de tu RUC:")} <a href="https://www.sunat.gob.pe" target="_blank" rel="noopener">${tr("check the monthly obligations schedule at sunat.gob.pe", "revisa el cronograma de obligaciones mensuales en sunat.gob.pe")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></li>
      </ol>
      <p>${tr(
        `If you expect to earn up to S/ ${SUSPENSION_CAP_PEN.toLocaleString("en-US")} in the year, you can request a suspension of prepayments (Formulario 1609). The suspension is not automatic: it applies from the moment SUNAT approves it, never retroactively, and it expires on December 31, so you have to request it again every year. If a Peruvian client already withheld 8% from you, that amount is deducted from the month's payment.`,
        `Si proyectas ganar hasta S/ ${SUSPENSION_CAP_PEN.toLocaleString("en-US")} en el año, puedes pedir la suspensión de pagos a cuenta (Formulario 1609). La suspensión no es automática: rige desde que SUNAT la aprueba, nunca hacia atrás, y caduca el 31 de diciembre, así que tienes que volver a pedirla cada año. Si un cliente peruano ya te retuvo el 8%, ese monto se descuenta del pago del mes.`)}</p>
      <p class="src"><i class="ph-light ph-seal-check" aria-hidden="true"></i> ${tr(
        "Where the figures come from: the 8% rate is article 86 of the TUO de la Ley del Impuesto a la Renta (Peru's consolidated Income Tax Law, D.S. 179-2004-EF). The thresholds are those in article 3 of",
        "De dónde salen las cifras: la tasa del 8% es el artículo 86 del TUO de la Ley del Impuesto a la Renta (D.S. 179-2004-EF). Los umbrales son los del artículo 3 de la")} <a href="https://www.sunat.gob.pe/legislacion/superin/2025/000390-2025.pdf" target="_blank" rel="noopener">Resolución de Superintendencia N.° 000390-2025/SUNAT <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>${tr(
        `, dated December 30, 2025: S/ ${THRESHOLD_PEN.toLocaleString("en-US")} a month and S/ ${SUSPENSION_CAP_PEN.toLocaleString("en-US")} a year in the general regime, and S/ ${DIRECTOR_THRESHOLD_PEN.toLocaleString("en-US")} a month and S/ ${DIRECTOR_CAP_PEN.toLocaleString("en-US")} a year for company directors, síndicos, mandatarios, gestores de negocios, albaceas and regidores. SUNAT adjusted them to the 2026 UIT (Unidad Impositiva Tributaria, Peru's tax reference unit), S/ ${UIT_PEN.toLocaleString("en-US")} under D.S. 301-2025-EF. We copied the amounts from the resolution; we did not derive them.`,
        `, del 30 de diciembre de 2025: S/ ${THRESHOLD_PEN.toLocaleString("en-US")} al mes y S/ ${SUSPENSION_CAP_PEN.toLocaleString("en-US")} al año en el régimen general, y S/ ${DIRECTOR_THRESHOLD_PEN.toLocaleString("en-US")} al mes y S/ ${DIRECTOR_CAP_PEN.toLocaleString("en-US")} al año para directores de empresas, síndicos, mandatarios, gestores de negocios, albaceas y regidores. SUNAT los ajustó a la UIT de 2026, S/ ${UIT_PEN.toLocaleString("en-US")} según el D.S. 301-2025-EF. Copiamos los montos de la resolución; no los calculamos nosotros.`)}</p>
    </details>
    <label class="field fx"><span class="lbl">${tr("Exchange rate (S/ per USDC)", "Tipo de cambio (S/ por USDC)")}</span>
      <input class="num" id="fx" inputmode="decimal" placeholder="${tr("SBS buying rate on the payment date", "TC compra SBS del día de cobro")}" value="${fx ?? ""}">
      ${fx !== null && (fx < FX_MIN || fx > FX_MAX) ? `<small class="warn-text"><i class="ph-light ph-warning" aria-hidden="true"></i> ${tr(
        `S/ ${fx} per dollar is outside what the market has seen (between ${FX_MIN} and ${FX_MAX}). A very low rate sinks your soles total and can make the app say you are under the threshold when you are over it. Please check it.`,
        `S/ ${fx} por dólar está fuera de lo que se ha visto en el mercado (entre ${FX_MIN} y ${FX_MAX}). Un tipo de cambio muy bajo hunde tu total en soles y puede hacer que la app diga que estás bajo el umbral cuando lo superas. Revísalo.`)}</small>` : ""}
      <small>${mode === "demo" ? tr(`${DEMO_FX} is filled in here as a sample, so the sample dashboard can compute something. `, `Aquí va ${DEMO_FX} como ejemplo, para que el panel de ejemplo pueda calcular algo. `) : ""}${tr(
        "The rule uses the SBS (Peru's banking regulator) buying rate on the day you get paid. Here a single rate is applied to the whole month as an approximation, so the soles total is close to the real one without being exact. SUNAT has published no criterion for payments received in crypto: confirm with your accountant.",
        "La norma usa el tipo de cambio compra SBS del día en que cobras. Aquí se aplica uno solo a todo el mes como aproximación, así que el total en soles se acerca al real sin ser exacto. SUNAT no ha publicado un criterio para cobros en cripto: confírmalo con tu contador.")}</small>
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
    const fee = typeof pen.fee_percent === "number" ? tr(` · ${pen.fee_percent}% fee`, ` · comisión de ${pen.fee_percent}%`) : "";
    box.innerHTML = `<i class="ph-light ph-bank" aria-hidden="true"></i> <b>${ANCHOR.name}</b> ${tr("pays out soles through SEP-24 on mainnet", "paga en soles por SEP-24 en mainnet")}${esc(fee)}.
      <a href="${ANCHOR.toml}" target="_blank" rel="noopener">${tr("View its stellar.toml", "Ver su stellar.toml")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>
      <small>${tr("Checked live. This app runs on testnet, so the withdrawal to a Peruvian bank is not executed from here.",
        "Consultado en vivo. Esta app corre en testnet, así que el retiro a un banco peruano no se ejecuta desde aquí.")}</small>`;
  } catch {
    box.innerHTML = `<i class="ph-light ph-bank" aria-hidden="true"></i> ${tr(
      "We couldn't reach the anchor right now. On mainnet there are anchors that pay out soles through SEP-24; see",
      "No pudimos contactar al ancla en este momento. En mainnet hay anclas que pagan en soles por SEP-24; mira")} <a href="${ANCHOR.home}" target="_blank" rel="noopener">${ANCHOR.name}</a>.`;
  }
}

/** How long the reserve lives on the network. After that it gets archived and has to be restored. */
function ttlLine(): string {
  if (!liveUntil || !reserve) return "";
  const days = Math.floor((liveUntil.getTime() - Date.now()) / 86_400_000);
  const date = liveUntil.toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });
  const canRenew = mode !== "demo" && days <= RENEW_DAYS;
  return `<p class="kpi-note ttl"><i class="ph-light ph-hourglass-medium" aria-hidden="true"></i> ${tr(
    `The network keeps this reserve until ${date} (${Math.max(days, 0)} days), and every payment or withdrawal extends that period.`,
    `La red guarda esta reserva hasta el ${date} (${Math.max(days, 0)} días), y cada cobro o retiro extiende ese plazo.`)} ${
    canRenew
      ? tr(`Time is running short: <button class="linkbtn renew">renew it now</button>, without moving funds.`,
        `Queda poco: <button class="linkbtn renew">renuévala ahora</button>, sin mover fondos.`)
      : tr(`If nobody touches it in that time, it gets archived and must be restored before you can withdraw.`,
        `Si nadie la toca en ese plazo, se archiva y hay que restaurarla antes de retirar.`)}</p>`;
}

async function renew(b: HTMLButtonElement) {
  b.disabled = true;
  b.textContent = mode === "passkey" ? tr("confirm with your passkey…", "confirma con tu passkey…") : tr("sign with Freighter…", "firma con Freighter…");
  try {
    await (mode === "passkey" ? extendWithPasskey(me) : extendWithWallet(me));
    loadError = false;
    await load();
  } catch (err) {
    b.disabled = false;
    b.textContent = err instanceof Error ? err.message : tr("Could not renew.", "No se pudo renovar.");
  }
}

async function copy(b: HTMLButtonElement, url: string) {
  try {
    await navigator.clipboard.writeText(url);
    b.innerHTML = `<i class="ph-light ph-check" aria-hidden="true"></i>${tr("Copied", "Copiado")}`;
  } catch {
    b.innerHTML = tr("Copy the link from Open", "Copia el link desde Abrir");
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
      show(`<p class="error">${tr(
        `Issuing a receipt needs the account's signature, and the sample dashboard is read-only. Below, under "Awaiting payment", there is an issued receipt you can open and pay.`,
        `Emitir un recibo necesita la firma de la cuenta, y el panel de ejemplo es solo de lectura. Abajo, en "Por cobrar", hay un recibo emitido que sí puedes abrir y pagar.`)}</p>`);
      return;
    }
    const d = new FormData(form);
    const gross = toUnits(String(d.get("amount")));
    const ref = String(d.get("ref")).trim();
    const concept = String(d.get("concept")).trim();
    if (gross <= 0n || !ref) return;
    // The contract refuses to issue without a rate: send the user to choose one instead of failing.
    if (profile === null) {
      openSettings("issue");
      return;
    }
    if (profile === undefined) {
      show(`<p class="error">${tr("We couldn't read your tax settings from the network. Reload in a moment before issuing.", "No pudimos leer tu configuración tributaria de la red. Recarga en un momento antes de emitir.")}</p>`);
      return;
    }
    if (new TextEncoder().encode(concept).length > MAX_CONCEPT_BYTES) {
      show(`<p class="error">${tr("The description is too long for the receipt. Please shorten it a little.", "El concepto es demasiado largo para el recibo. Acórtalo un poco.")}</p>`);
      return;
    }
    // Without a trustline the account cannot receive the net amount, and the payment would fail
    // on the client's side. It is checked right here, since the value from the load may not have arrived yet.
    if (me.startsWith("G")) {
      try {
        hasTrustline = (await usdcBalance(me)) !== null;
      } catch {
        show(`<p class="error">${tr("We couldn't check whether your account accepts USDC. Try again in a moment.", "No pudimos comprobar si tu cuenta acepta USDC. Intenta de nuevo en un momento.")}</p>`);
        return;
      }
    }
    if (me.startsWith("G") && !hasTrustline) {
      offerTrustline(show, out);
      return;
    }
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>${mode === "passkey" ? tr("Sign the receipt with your passkey", "Firma el recibo con tu passkey") : tr("Sign the receipt in Freighter", "Firma el recibo en Freighter")}`;
    try {
      const hash = await (mode === "passkey" ? issueWithPasskey(me, ref, gross, concept) : issueWithWallet(me, ref, gross, concept));
      const params = new URLSearchParams({ to: me, ref });
      const name = String(d.get("name") ?? "").trim();
      if (name) params.set("name", name);
      // You send this link to a client abroad, so it has to point to the public domain
      // and never to the machine you generated it on.
      const url = `${PUBLIC_BASE}/pay.html?${params}`;
      show(`<p class="u"><i class="ph-light ph-seal-check" aria-hidden="true"></i> ${tr(
        `Receipt ${esc(ref)} issued on chain for ${fromUnits(gross)} USDC.`, `Recibo ${esc(ref)} emitido en la cadena por ${fromUnits(gross)} USDC.`)} <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${tr("View transaction", "Ver transacción")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></p>
        <code class="mono">${esc(url)}</code>
        <div class="row2"><button type="button" class="btn ghost" id="copy"><i class="ph-light ph-copy" aria-hidden="true"></i>${tr("Copy", "Copiar")}</button>
        <a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>${tr("Open", "Abrir")}</a></div>`);
      out.querySelector<HTMLButtonElement>("#copy")!.addEventListener("click", (ev) => copy(ev.currentTarget as HTMLButtonElement, url));
      form.reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // passkey.ts may have thrown in either language.
      show(`<p class="error">${/#6\b|ReceiptExists|already used|ya usaste/.test(msg)
        ? tr(`You already issued a receipt with number ${esc(ref)}. Each receipt can be issued only once, so use the next number.`,
          `Ya emitiste un recibo con el número ${esc(ref)}. Cada recibo se emite una sola vez, así que usa el siguiente número.`)
        : esc(msg || tr("Could not issue the receipt.", "No se pudo emitir el recibo."))}</p>`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ph-light ph-plus" aria-hidden="true"></i>${tr("Issue receipt and create link", "Emitir recibo y crear link")}`;
    }
  });
}

function offerTrustline(show: (html: string) => void, out: Element) {
  show(`<p class="error">${tr("Your account doesn't accept USDC yet, so your client's payment would fail at signing. Enable it once and issue the receipt again.",
    "Tu cuenta todavía no acepta USDC, así que el pago de tu cliente fallaría al firmar. Actívalo una vez y vuelve a emitir el recibo.")}</p>
    <button type="button" class="btn ghost" id="trust"><i class="ph-light ph-plus-circle" aria-hidden="true"></i>${tr("Accept USDC on my account", "Aceptar USDC en mi cuenta")}</button>`);
  out.querySelector<HTMLButtonElement>("#trust")!.addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    b.innerHTML = `<span class="spin"></span>${tr("Sign with Freighter", "Firma con Freighter")}`;
    try {
      await addUsdcTrustline(me);
      hasTrustline = true;
      show(`<p class="u">${tr("Done: your account now accepts USDC. Issue the receipt again.", "Listo: tu cuenta ya acepta USDC. Vuelve a emitir el recibo.")}</p>`);
    } catch (err) {
      b.disabled = false;
      b.innerHTML = tr("Retry", "Reintentar");
      out.insertAdjacentHTML("beforeend", `<p class="error">${esc(err instanceof Error ? err.message : tr("Could not enable USDC.", "No se pudo activar USDC."))}</p>`);
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
      ? tr("With an account connected through Freighter, this step runs the full SEP-24 withdrawal on testnet against the SDF test anchor.",
        "Con una cuenta conectada por Freighter, este paso ejecuta en testnet el retiro completo por SEP-24 contra el ancla de pruebas de SDF.")
      : tr("Withdrawing through the test anchor works today with Freighter. A passkey wallet needs the anchor's SEP-45 authentication, which is not wired in.",
        "El retiro por el ancla de pruebas funciona hoy con Freighter. Una wallet con passkey necesita la autenticación SEP-45 del ancla, que no está conectada.")}</small>`;
    return;
  }
  const t = sep?.tx;
  const links = (sep?.hashes ?? []).map((h) => `<a href="${EXPLORER}/tx/${h}" target="_blank" rel="noopener">${short(h)} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>`).join(" · ");
  box.innerHTML = `
    <p>${tr(
      "<b>Try it on testnet.</b> The SDF test anchor speaks the same protocol, SEP-24, and simulates the payout to a bank: no real soles and no real bank are involved. Your reserve leaves the contract and reaches the anchor in two signatures. That anchor accepts up to 10 USDC per withdrawal, so withdraw part of it.",
      "<b>Pruébalo en testnet.</b> El ancla de pruebas de SDF habla el mismo protocolo, SEP-24, y simula el pago a un banco: no intervienen soles ni bancos reales. Tu reserva sale del contrato y llega al ancla en dos firmas. Esa ancla acepta hasta 10 USDC por retiro, así que retira una parte.")}</p>
    ${!sep ? `<button type="button" class="btn ghost" id="sep24-go" ${!reserve ? "disabled" : ""}><i class="ph-light ph-bank" aria-hidden="true"></i>${tr("Withdraw the reserve through the test anchor", "Retirar la reserva por el ancla de pruebas")}</button>` : ""}
    ${t?.status === "pending_user_transfer_start" && !sep?.busy
      ? `<button type="button" class="btn" id="sep24-send"><i class="ph-light ph-paper-plane-tilt" aria-hidden="true"></i>${tr(`Send ${esc(t.amount_in ?? "")} USDC to the anchor`, `Enviar ${esc(t.amount_in ?? "")} USDC al ancla`)}</button>` : ""}
    ${sep ? `<p class="u" role="status">${sep.busy ? `<span class="spin"></span> ` : ""}${esc(sep.msg)}${
      t?.more_info_url ? ` <a href="${esc(t.more_info_url)}" target="_blank" rel="noopener">${tr("View the withdrawal at the anchor", "Ver el retiro en el ancla")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>` : ""}</p>` : ""}
    ${links ? `<p class="u">${tr("Transactions:", "Transacciones:")} ${links}</p>` : ""}`;
  box.querySelector("#sep24-go")?.addEventListener("click", startSep24);
  box.querySelector("#sep24-send")?.addEventListener("click", sendSep24);
}

// A function, so each message comes out in the current language.
const sepStatus = (status: string): string | undefined => ({
  incomplete: tr("Fill in your details in the anchor's window.", "Completa tus datos en la ventana del ancla."),
  pending_user_transfer_start: tr("The anchor received your details and is waiting for the USDC.", "El ancla recibió tus datos y espera el USDC."),
  pending_anchor: tr("The anchor is processing the withdrawal.", "El ancla está procesando el retiro."),
  pending_stellar: tr("The anchor is confirming the payment on Stellar.", "El ancla está confirmando el pago en Stellar."),
  pending_external: tr("The anchor is sending the money to the test bank.", "El ancla está enviando el dinero al banco de prueba."),
  completed: tr("Withdrawal completed by the test anchor.", "Retiro completado por el ancla de pruebas."),
  error: tr("The anchor marked the withdrawal as failed with an error.", "El ancla marcó el retiro como fallido."),
  expired: tr("The withdrawal expired before it completed.", "El retiro venció antes de completarse."),
  refunded: tr("The anchor refunded the money.", "El ancla devolvió el dinero."),
} as Record<string, string>)[status];

async function startSep24() {
  // The window opens inside the click: if it opens after an await, the browser blocks it.
  const popup = window.open("", "_blank");
  sep = { token: "", id: "", msg: tr("Sign with Freighter to identify yourself to the anchor.", "Firma con Freighter para identificarte ante el ancla."), busy: true, hashes: [] };
  renderSep24();
  try {
    const lim = await withdrawLimits();
    const available = Number(fromUnits(reserve ?? 0n, 7).replace(/,/g, ""));
    if (available < lim.min) {
      throw new Error(tr(`The test anchor needs at least ${lim.min} USDC per withdrawal and your reserve holds ${available}.`,
        `El ancla de pruebas pide al menos ${lim.min} USDC por retiro y tu reserva tiene ${available}.`));
    }
    // The test anchor caps each withdrawal, so propose the smaller of the two.
    const amount = Math.min(available, lim.max);
    sep.token = await anchorLogin(me);
    sep.msg = tr(`Opening the anchor's form for ${amount} USDC (it accepts between ${lim.min} and ${lim.max} per withdrawal)…`,
      `Abriendo el formulario del ancla por ${amount} USDC (acepta entre ${lim.min} y ${lim.max} por retiro)…`);
    renderSep24();
    const { id, url } = await startWithdraw(sep.token, me, String(amount));
    sep.id = id;
    if (popup) popup.location.href = url;
    sep.msg = popup ? sepStatus("incomplete")! : tr("Your browser blocked the anchor's window.", "Tu navegador bloqueó la ventana del ancla.");
    renderSep24();
    if (!popup) app.querySelector("#sep24 [role=status]")?.insertAdjacentHTML("beforeend", ` <a href="${esc(url)}" target="_blank" rel="noopener">${tr("Open the form", "Abrir el formulario")}</a>`);
    pollSep24(0);
  } catch (err) {
    popup?.close();
    sep = { token: "", id: "", msg: err instanceof Error ? err.message : tr("Could not start the withdrawal.", "No se pudo iniciar el retiro."), busy: false, hashes: [] };
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
      sep.msg = sepStatus(tx.status) ?? tr(`Anchor status: ${tx.status}.`, `Estado del ancla: ${tx.status}.`);
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
    sep.msg = tr("The anchor is asking for more than your reserve holds. Fix the amount in its form.", "El ancla pide más de lo que tiene tu reserva. Corrige el monto en su formulario.");
    renderSep24();
    return;
  }
  sep.busy = true;
  sep.msg = tr("Signature 1 of 2: you withdraw the reserve from the contract to your account.", "Firma 1 de 2: retiras la reserva del contrato a tu cuenta.");
  renderSep24();
  try {
    sep.hashes.push(await withdrawWithWallet(me, me, amount));
    sep.msg = tr("Signature 2 of 2: you send the USDC to the anchor with the withdrawal reference.", "Firma 2 de 2: envías el USDC al ancla con la referencia del retiro.");
    renderSep24();
    sep.hashes.push(await sendUsdcWithMemo(me, t.withdraw_anchor_account, t.amount_in, t.withdraw_memo ?? "", t.withdraw_memo_type ?? "text"));
    sep.msg = tr("Sent. Waiting for the anchor to confirm…", "Enviado. Esperando que el ancla lo confirme…");
    renderSep24();
  } catch (err) {
    sep.busy = false;
    sep.msg = err instanceof Error ? err.message : tr("Could not send to the anchor.", "No se pudo enviar al ancla.");
    renderSep24();
  }
}

/** Month block for a profile outside the Peru preset: income and reserve, no threshold logic.
 *  The app does not know that country's rules, so it does not estimate anything. */
function renderMonthPlain(thisMonth: Paid[]) {
  const box = app.querySelector("#threshold")!;
  const loading = stillLoading() || profile === undefined;
  const month = new Date(Date.now() + offsetNow() * 60_000).toLocaleDateString(dateLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
  const setAside = thisMonth.reduce((s, p) => s + p.tax, 0n);
  const val = (fn: () => string) => (loading ? "" : loadError ? "—" : fn());
  box.innerHTML = `
    <div class="rc-top"><p class="lbl"><i class="ph-light ph-calendar-blank" aria-hidden="true"></i> ${tr("This month", "Este mes")} · ${month}</p></div>
    <p class="th-num num ${loading ? "sk" : ""}">${val(() => (monthly === null ? "—" : fromUnits(monthly)))}<small>USDC</small></p>
    <p class="th-cap">${tr("received this month, read from the contract", "cobrado este mes, leído del contrato")}</p>
    <dl class="th-rows">
      <div><dt><i class="ph-light ph-vault" aria-hidden="true"></i> ${tr("Set aside from this month's payments", "Apartado de los cobros del mes")}</dt><dd class="num ${loading ? "sk" : ""}">${eventsFailed ? "—" : val(() => fromUnits(setAside))} <small>USDC</small></dd></div>
      <div><dt><i class="ph-light ph-percent" aria-hidden="true"></i> ${tr("Your reserve rate for new receipts", "Tu tasa de reserva para recibos nuevos")}</dt><dd class="num">${profile ? `${pctOf(profile.taxBps)}%` : "—"}</dd></div>
      <div><dt><i class="ph-light ph-clock" aria-hidden="true"></i> ${tr("Your tax month closes at midnight", "Tu mes tributario cierra a la medianoche")}</dt><dd class="num">${profile ? offsetLabel(profile.utcOffsetMin) : "—"}</dd></div>
    </dl>
    <p class="th-help"><i class="ph-light ph-info" aria-hidden="true"></i> ${tr(
      "This app does not know the tax rules of your country, so it shows no threshold and no estimate of what you owe. The reserve is the share you chose. Confirm the right amount with your accountant.",
      "Esta app no conoce las reglas tributarias de tu país, así que no muestra umbral ni estimado de lo que debes. La reserva es la parte que elegiste. Confirma el monto correcto con tu contador.")}</p>`;
}

function openSettings(reason: typeof settingsReason) {
  settingsOpen = true;
  settingsReason = reason;
  render();
  window.scrollTo(0, 0);
}

// UTC offsets in use around the world, in minutes. The browser's own offset is added if missing.
const OFFSETS = [-720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840];

function renderSettings(out = "") {
  const browserOffset = -new Date().getTimezoneOffset();
  const peruNow = profile ? isPeru(profile) : true;
  const tzSel = profile && !isPeru(profile) ? profile.utcOffsetMin : browserOffset;
  const offsets = [...new Set([...OFFSETS, browserOffset, tzSel])].sort((a, b) => a - b);
  const pctNow = profile && !isPeru(profile) ? pctOf(profile.taxBps) : "";
  const reason =
    settingsReason === "first" ? tr("First step: choose how much of each payment to set aside. The contract needs it before you issue your first receipt.",
      "Primer paso: elige cuánto apartar de cada cobro. El contrato lo necesita antes de que emitas tu primer recibo.")
    : settingsReason === "issue" ? tr("Before your first receipt, choose how much of each payment to set aside. Then come back and issue it.",
      "Antes de tu primer recibo, elige cuánto apartar de cada cobro. Luego vuelve y emítelo.")
    : "";
  app.innerHTML = `
  <section class="settings rise">
    <p class="lbl"><i class="ph-light ph-sliders-horizontal" aria-hidden="true"></i> ${tr("Tax settings", "Configuración tributaria")}</p>
    <h1>${tr("Where do you pay taxes?", "¿Dónde pagas tus impuestos?")}</h1>
    ${reason ? `<p class="note" role="status"><i class="ph-light ph-info" aria-hidden="true"></i> ${esc(reason)}</p>` : ""}
    ${profile ? `<p class="note"><i class="ph-light ph-seal-check" aria-hidden="true"></i> ${tr(
      `Saved on chain: ${isPeru(profile) ? "Peru preset, " : ""}${pctOf(profile.taxBps)}% of every payment, tax month in ${offsetLabel(profile.utcOffsetMin)}. If you change it, receipts you already issued keep the rate they were issued with. Only new receipts use the new one.`,
      `Guardado en la cadena: ${isPeru(profile) ? "configuración de Perú, " : ""}${pctOf(profile.taxBps)}% de cada cobro, mes tributario en ${offsetLabel(profile.utcOffsetMin)}. Si lo cambias, los recibos que ya emitiste mantienen la tasa con la que se emitieron. Solo los recibos nuevos usan la nueva.`)}</p>` : ""}
    <form id="profile-form" class="settings-form">
      <fieldset class="choices">
        <legend class="sr">${tr("Country", "País")}</legend>
        <label class="choice"><input type="radio" name="where" value="peru" ${peruNow ? "checked" : ""}>
          <span><b>${tr("Peru", "Perú")}</b> <span class="tag ok"><i class="ph-light ph-seal-check" aria-hidden="true"></i>${tr("Verified preset", "Configuración verificada")}</span>
          <small>${tr(
            `${pctOf(PERU.taxBps)}% of every payment, the rate of the fourth-category income-tax prepayment. Your tax month closes on Lima time (${offsetLabel(PERU.utcOffsetMin)}). The dashboard tracks SUNAT's monthly threshold and drafts your Recibo por Honorarios Electrónico (electronic fee receipt).`,
            `${pctOf(PERU.taxBps)}% de cada cobro, la tasa del pago a cuenta de rentas de cuarta categoría. Tu mes tributario cierra en hora de Lima (${offsetLabel(PERU.utcOffsetMin)}). El panel sigue el umbral mensual de SUNAT y te prepara el borrador de tu Recibo por Honorarios Electrónico.`)}</small></span></label>
        <label class="choice"><input type="radio" name="where" value="other" ${peruNow ? "" : "checked"}>
          <span><b>${tr("Another country", "Otro país")}</b><small>${tr("You choose the share of each payment to set aside and the time zone your tax month closes in.",
            "Eliges qué parte de cada cobro apartar y la zona horaria en la que cierra tu mes tributario.")}</small></span></label>
      </fieldset>
      <div class="other-fields" ${peruNow ? "hidden" : ""}>
        <div class="row2">
          <label class="field"><span class="lbl">${tr("Share to set aside (%)", "Parte a apartar (%)")}</span><input class="num" name="pct" inputmode="decimal" placeholder="${tr("0 to 50", "0 a 50")}" value="${pctNow}"><small>${tr("Between 0 and 50, one decimal at most.", "Entre 0 y 50, con un decimal como máximo.")}</small></label>
          <label class="field"><span class="lbl">${tr("Time zone", "Zona horaria")}</span><select name="tz">${offsets.map((o) =>
            `<option value="${o}" ${o === tzSel ? "selected" : ""}>${offsetLabel(o)}${o === browserOffset ? tr(" (this device)", " (este dispositivo)") : ""}</option>`).join("")}</select></label>
        </div>
        <p class="note"><i class="ph-light ph-warning-circle" aria-hidden="true"></i> ${tr(
          "This app does not know the tax rules of your country. Pick the share you want set aside from each payment, and confirm it with your accountant.",
          "Esta app no conoce las reglas tributarias de tu país. Elige la parte que quieres apartar de cada cobro y confírmala con tu contador.")}</p>
      </div>
      <div class="actions">
        <button class="btn" type="submit"><i class="ph-light ph-floppy-disk" aria-hidden="true"></i>${tr("Save on chain", "Guardar en la cadena")}</button>
        ${profile ? `<button class="btn ghost" type="button" id="cancel">${tr("Back to the dashboard", "Volver al panel")}</button>` : ""}
      </div>
      <p class="wd-out" role="status">${out}</p>
    </form>
  </section>`;

  const form = app.querySelector<HTMLFormElement>("#profile-form")!;
  const other = form.querySelector<HTMLElement>(".other-fields")!;
  form.querySelectorAll<HTMLInputElement>('input[name="where"]').forEach((r) =>
    r.addEventListener("change", () => (other.hidden = form.querySelector<HTMLInputElement>('input[value="peru"]')!.checked)));
  app.querySelector("#cancel")?.addEventListener("click", () => {
    settingsOpen = false;
    settingsReason = "";
    render();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveProfile(form);
  });
}

async function saveProfile(form: HTMLFormElement) {
  const status = form.querySelector(".wd-out")!;
  const fail = (msg: string) => (status.innerHTML = `<span class="error">${esc(msg)}</span>`);
  if (mode === "demo") {
    return fail(tr("The sample dashboard is read-only. Create your wallet with a passkey to save your own settings.",
      "El panel de ejemplo es solo de lectura. Crea tu wallet con passkey para guardar tu propia configuración."));
  }
  const d = new FormData(form);
  let next: Profile;
  if (d.get("where") === "peru") {
    next = { taxBps: PERU.taxBps, utcOffsetMin: PERU.utcOffsetMin };
  } else {
    const bps = bpsFromPct(String(d.get("pct") ?? ""));
    if (bps === null) return fail(tr("Enter a share between 0 and 50, with one decimal at most.", "Ingresa una parte entre 0 y 50, con un decimal como máximo."));
    next = { taxBps: bps, utcOffsetMin: Number(d.get("tz")) };
  }
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>${mode === "passkey" ? tr("Confirm with your passkey", "Confirma con tu passkey") : tr("Sign with Freighter", "Firma con Freighter")}`;
  try {
    const hash = await (mode === "passkey" ? setProfileWithPasskey(me, next) : setProfileWithWallet(me, next));
    profile = next;
    settingsOpen = false;
    settingsReason = "";
    render();
    app.insertAdjacentHTML("afterbegin", `<p class="note" role="status"><i class="ph-light ph-check" aria-hidden="true"></i> ${tr(
      `Tax settings saved: new receipts set aside ${pctOf(next.taxBps)}%.`, `Configuración tributaria guardada: los recibos nuevos apartan el ${pctOf(next.taxBps)}%.`)} <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${tr("View transaction", "Ver transacción")} <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></p>`);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<i class="ph-light ph-floppy-disk" aria-hidden="true"></i>${tr("Save on chain", "Guardar en la cadena")}`;
    fail(err instanceof Error ? err.message : tr("Could not save your tax settings.", "No se pudo guardar tu configuración tributaria."));
  }
}
