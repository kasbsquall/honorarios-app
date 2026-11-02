import "./styles.css";
import "./pay.css";
import { StrKey } from "@stellar/stellar-sdk";
import { initLang, mountLangSwitch, tr } from "./i18n";
import { EXPLORER, connectWallet, ensureUsdc, fromUnits, isPeru, paidEvents, pctOf, payInvoice, readReceipt, serviceFee, short } from "./stellar";
import { MARK, esc, receiptCard, receiptPayText } from "./ui";

type Step = "connect" | "fund" | "sign" | "done";
const steps = (): { id: Step; icon: string; title: string; hint: string }[] => [
  { id: "connect", icon: "ph-plugs-connected", title: tr("Connect wallet", "Conecta tu wallet"), hint: tr("Freighter on testnet", "Freighter en testnet") },
  { id: "fund", icon: "ph-arrows-left-right", title: tr("Get USDC", "Consigue USDC"), hint: tr("Swaps XLM through a Stellar path payment if needed", "Si hace falta, cambia XLM con un path payment de Stellar") },
  { id: "sign", icon: "ph-signature", title: tr("Sign payment", "Firma el pago"), hint: tr("One contract call splits it on-chain", "Una sola llamada al contrato lo reparte en la cadena") },
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
// Reserve rate and time zone recorded in the receipt when it was issued: the contract applies
// exactly these, whatever the freelancer's profile says today.
let taxBps = 0;
let utcOffsetMin = 0;
const validTo = StrKey.isValidEd25519PublicKey(to) || StrKey.isValidContract(to);
let payer = "";
// What the contract will actually charge, read from the chain. If the screen computed it
// on its own, the client would sign a breakdown the contract has no obligation to honor.
let feeBps: bigint | null = null;
let feeState: "loading" | "ready" | "failed" = "loading";
// Repaints whatever is on screen; the language switch calls it.
let view: () => void = () => {};

const empty = (label: string, title: string, body: string) =>
  (app.innerHTML = `<section class="empty rise"><p class="lbl">${label}</p><h1>${title}</h1><p>${body}</p></section>`);

function show(v: () => void) {
  view = v;
  v();
}

initLang().then(() => {
  mountLangSwitch(() => view());
  if (!validTo || !ref) {
    show(() => empty(tr("Invalid link", "Link no válido"), tr("This payment link is incomplete.", "Este link de pago está incompleto."),
      tr("Ask the freelancer to send you a new link from their Honorarios panel.", "Pídele al freelancer que te envíe un link nuevo desde su panel de Honorarios.")));
  } else {
    app.innerHTML = `<section class="summary"><div class="receipt sk" style="height:420px"></div></section>
    <section class="side"><div class="receipt sk" style="height:300px"></div></section>`;
    start();
  }
});

async function start() {
  const [receipt, fee] = await Promise.allSettled([readReceipt(to, ref), serviceFee()]);
  if (fee.status === "fulfilled") { feeBps = fee.value.bps; feeState = "ready"; } else { feeState = "failed"; }
  if (receipt.status === "rejected") {
    show(() => empty(tr("Network error", "Error de red"), tr("We could not read this receipt from Stellar.", "No pudimos leer este recibo en Stellar."),
      tr("Nothing was charged. Reload the page in a moment.", "No se cobró nada. Recarga la página en un momento.")));
    return;
  }
  const r = receipt.value;
  if (!r) {
    show(() => empty(tr("Unknown receipt", "Recibo desconocido"), tr(`Receipt ${esc(ref)} was never issued.`, `El recibo ${esc(ref)} nunca se emitió.`),
      tr("The contract only accepts payments for receipts the freelancer signed. Ask them for a new link.",
        "El contrato solo acepta pagos de recibos que el freelancer firmó. Pídele un link nuevo.")));
    return;
  }
  gross = r.gross;
  concept = r.concept;
  taxBps = r.taxBps;
  utcOffsetMin = r.utcOffsetMin;
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

function render(current: Step, opts: { error?: unknown; busy?: boolean; txHash?: string; already?: boolean } = {}) {
  view = () => render(current, opts);
  const done = current === "done";
  const peru = isPeru({ taxBps, utcOffsetMin });
  const title = concept || tr("Professional services", "Servicios profesionales");
  const badge = done
    ? `<span class="badge ok"><i class="ph-light ph-check" aria-hidden="true"></i>${tr("Paid", "Pagado")}</span>`
    : `<span class="badge"><i class="ph-light ph-hourglass-simple" aria-hidden="true"></i>${tr("Due", "Por pagar")}</span>`;
  const action =
    current === "connect" ? tr("Connect Freighter", "Conectar Freighter")
    : current === "fund" ? tr("Prepare USDC", "Preparar USDC")
    : current === "sign" ? tr(`Pay ${fromUnits(gross)} USDC`, `Pagar ${fromUnits(gross)} USDC`)
    : "";

  app.innerHTML = `
  <section class="summary rise" style="--i:0">
    <p class="lbl">${peru ? tr("Invoice from a freelancer in Peru", "Recibo de un freelancer en Perú") : tr("Invoice from a freelancer", "Recibo de un freelancer")}</p>
    <h1>${esc(name || (peru ? tr("A freelancer in Peru", "Un freelancer en Perú") : tr("A freelancer", "Un freelancer")))}</h1>
    <p class="to-addr num">${short(to)}</p>
    <p class="due num">${fromUnits(gross)}<small>USDC</small></p>
    <dl class="lines">
      <div><dt>${tr("Service", "Servicio")}</dt><dd>${esc(title)}</dd></div>
      <div><dt>${tr("Receipt", "Recibo")}</dt><dd class="num">${esc(ref)} · <span class="u">${tr("issued on-chain by the freelancer", "emitido en la cadena por el freelancer")}</span></dd></div>
      <div><dt>${tr("Pay to", "Pagar a")}</dt><dd class="num">${short(to)}</dd></div>
      <div><dt>${tr("Network", "Red")}</dt><dd>Stellar testnet</dd></div>
    </dl>
    <ol class="steps">
      ${steps().map((s, i) => `
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
            gross, title, ref, badge, text: receiptPayText(), taxBps, feeBps: feeBps ?? 0n,
            footLeft: payer ? tr(`from ${short(payer)}`, `de ${short(payer)}`) : "",
            txHash: opts.txHash,
          })}</div>
    <p class="note">${tr(
      `You pay the full amount. The contract keeps ${pctOf(taxBps)}% in a reserve that only the freelancer can withdraw, ${peru ? "for their Peruvian tax prepayment" : "to pay their own taxes"}. That rate was fixed in the receipt when it was issued.`,
      `Pagas el monto completo. El contrato guarda el ${pctOf(taxBps)}% en una reserva que solo el freelancer puede retirar, ${peru ? "para su pago a cuenta del impuesto a la renta en Perú" : "para pagar sus propios impuestos"}. Esa tasa quedó fijada en el recibo cuando se emitió.`)}${
      feeState === "loading" ? tr(" Reading the split from the contract…", " Leyendo el reparto del contrato…")
      : feeState === "failed" ? tr(" We could not read the service fee from the contract, so the split above is the default one. Check the contract before you sign.",
        " No pudimos leer la comisión del servicio en el contrato, así que el reparto de arriba es el predeterminado. Revisa el contrato antes de firmar.")
      : feeBps === 0n ? tr(" This contract charges no service fee: the split above is read from the contract itself.",
        " Este contrato no cobra comisión del servicio: el reparto de arriba se lee del propio contrato.")
      : tr(` This contract charges a ${(Number(feeBps) / 100).toString()}% service fee, read from the contract itself.`,
        ` Este contrato cobra una comisión del servicio de ${(Number(feeBps) / 100).toString()}%, leída del propio contrato.`)}</p>
    ${done && opts.already ? `<p class="note"><i class="ph-light ph-seal-check" aria-hidden="true"></i> ${tr(
      "This receipt is already paid. The contract rejects a second payment of the same receipt, so nothing else can be charged for it.",
      "Este recibo ya está pagado. El contrato rechaza un segundo pago del mismo recibo, así que no se puede cobrar nada más por él.")}</p>` : ""}
    ${done && opts.txHash
      ? `<a class="btn wide" href="${EXPLORER}/tx/${opts.txHash}" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>${tr("View on Stellar Expert", "Ver en Stellar Expert")}</a>`
      : done ? ""
      : `<p class="note desktop-only-note"><i class="ph-light ph-desktop" aria-hidden="true"></i> ${tr(
          "Freighter is a desktop browser extension. Open this link on your computer to pay.",
          "Freighter es una extensión para navegadores de escritorio. Abre este link en tu computadora para pagar.")}</p>
         <button class="btn wide" id="go" ${opts.busy ? "disabled" : ""}>${opts.busy ? `<span class="spin"></span>${tr("Waiting for wallet", "Esperando a la wallet")}` : action}</button>`}
    ${opts.error !== undefined ? `<p class="error" role="alert">${esc(friendly(opts.error))}</p>` : ""}
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
    // The raw error is kept and turned into text on each render, so it follows the language switch.
    render(current, { error: e });
  }
}

// The messages thrown by stellar.ts come in the language that was active when they were thrown,
// so each pattern matches both.
function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Freighter|Testnet|signature was cancelled|rejected the connection/.test(msg)) return translate(msg);
  if (/#8|AlreadyPaid/.test(msg)) return tr("This receipt was already paid. Nothing was charged.", "Este recibo ya fue pagado. No se cobró nada.");
  if (/rejected the transaction|rechazó la transacción/.test(msg)) {
    return tr("The network rejected the transaction. No funds were moved. You can try again.",
      "La red rechazó la transacción. No se movió ningún fondo. Puedes volver a intentarlo.");
  }
  if (/did not return the transaction hash|cannot be negative|no devolvió el hash|no puede ser negativo/.test(msg)) {
    return tr("The network did not confirm the transaction. Check your wallet before paying again.",
      "La red no confirmó la transacción. Revisa tu wallet antes de volver a pagar.");
  }
  if (/op_underfunded|insufficient|balance/i.test(msg)) return tr("Not enough XLM to cover this payment.", "No tienes XLM suficiente para cubrir este pago.");
  if (/No XLM to USDC route|No hay ruta de XLM/.test(msg)) {
    return tr("No XLM to USDC route is available right now. Try again in a minute.",
      "No hay una ruta de XLM a USDC disponible ahora. Vuelve a intentarlo en un minuto.");
  }
  return tr("Something went wrong sending the payment. Try again.", "Algo falló al enviar el pago. Vuelve a intentarlo.");
}

function translate(msg: string) {
  if (msg.includes("Testnet")) return tr("Switch Freighter to Testnet to continue.", "Cambia Freighter a Testnet para continuar.");
  if (/signature was cancelled|firma se canceló/.test(msg)) return tr("You cancelled the signature in Freighter.", "Cancelaste la firma en Freighter.");
  return tr("Freighter did not connect. Make sure the extension is installed and unlocked.",
    "Freighter no se conectó. Revisa que la extensión esté instalada y desbloqueada.");
}
