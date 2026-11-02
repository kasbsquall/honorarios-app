import { dateLocale, getLang, tr } from "./i18n";
import { EXPLORER, type Paid, fromUnits } from "./stellar";
import { esc } from "./ui";

// Draft to copy when issuing the Recibo por Honorarios Electrónico (electronic fee receipt)
// on SUNAT. The app does not issue or send anything to SUNAT.
// Lines of the draft that match a field of SUNAT's Spanish form keep that field's Spanish
// name in parentheses, so the freelancer can find it in the portal.
const PROFILE_KEY = "honorarios.rhe.profile";

type Profile = { name: string; ruc: string };


/** The panel decides the effective exchange rate: in sample mode it uses a sample rate
 *  that is not in localStorage. If the draft read it on its own, it would say
 *  "exchange rate missing" next to a panel that does have one. */

const usd = (p: Paid) => fromUnits(p.gross, 2);
const pen = (p: Paid, fx: number | null) =>
  fx ? (Number(usd(p).replace(/,/g, "")) * fx).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;

// The payment date is read in Lima time, like the tax month: a payment on the last night
// of the month cannot be dated the next day because the user happens to be travelling.
// The month is written as a word so the date cannot be misread as day/month or month/day.
const fmtDate = (d: Date) =>
  new Date(d.getTime() - 5 * 3_600_000).toLocaleDateString(dateLocale(), { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function readProfile(): Profile {
  try {
    return { name: "", ruc: "", ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") };
  } catch {
    return { name: "", ruc: "" };
  }
}

function saveProfile(p: Profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* no storage */ }
}

/** A client not domiciled in Peru is not a withholding agent. A domiciled client can be,
 *  and then withholds on receipts above the minimum set by SUNAT. We do not show that
 *  minimum because we have not verified it: the user has to check it. */
function withholdingLine(abroad: boolean) {
  return abroad
    ? tr("Does not apply. A client not domiciled in Peru is not a withholding agent.",
      "No aplica. Un cliente no domiciliado en Perú no es agente de retención.")
    : tr("May apply. If your client is domiciled in Peru and is a withholding agent, they must withhold 8% when the receipt exceeds the minimum amount set by SUNAT. Check that minimum and subtract what was withheld in the panel.",
      "Puede aplicar. Si tu cliente está domiciliado en Perú y es agente de retención, debe retenerte el 8% cuando el recibo supera el monto mínimo que fija SUNAT. Verifica ese mínimo y descuenta lo retenido en el panel.");
}

function draftText(p: Paid, f: Record<string, string>) {
  // In Spanish the lines already carry the names of SUNAT's form, so no glosses are needed.
  if (getLang() === "es") return [
    "BORRADOR · Recibo por Honorarios Electrónico",
    `Emisor: ${f.name || "(tu nombre)"} · RUC ${f.ruc || "(tu RUC)"}`,
    `Cliente: ${f.client || "(nombre del cliente)"} · ${f.docType} ${f.docNum || "(número)"}`,
    `Descripción del servicio: ${f.desc || "(descripción)"}`,
    `Fecha del cobro: ${fmtDate(p.at)}`,
    `Moneda: Dólares americanos (US$)`,
    `Monto total de honorarios: US$ ${usd(p)} (cobrado como ${fromUnits(p.gross)} USDC, 1 USDC = 1 US$)`,
    `Equivalente para tu pago a cuenta: ${f.pen ? `S/ ${f.pen} (tipo de cambio ${f.fx})` : "(ingresa el tipo de cambio en el panel)"}`,
    `Retención de cuarta categoría: ${withholdingLine(f.abroad !== "no")}`,
    `Referencia interna: ${p.ref} · tx ${p.txHash}`,
  ].join("\n");
  return [
    "DRAFT · Recibo por Honorarios Electrónico (electronic fee receipt)",
    `Issuer (Emisor): ${f.name || "(your name)"} · RUC ${f.ruc || "(your RUC)"}`,
    `Client (Cliente): ${f.client || "(client name)"} · ${f.docType} ${f.docNum || "(number)"}`,
    `Service description (Descripción del servicio): ${f.desc || "(description)"}`,
    `Payment date: ${fmtDate(p.at)}`,
    `Currency (Moneda): US dollars (Dólares americanos, US$)`,
    `Total fees (Monto total de honorarios): US$ ${usd(p)} (paid as ${fromUnits(p.gross)} USDC, 1 USDC = 1 US$)`,
    `Equivalent for your tax prepayment (pago a cuenta): ${f.pen ? `S/ ${f.pen} (exchange rate ${f.fx})` : "(enter the exchange rate in the panel)"}`,
    `Withholding on independent-work income (Retención de cuarta categoría): ${withholdingLine(f.abroad !== "no")}`,
    `Internal reference: ${p.ref} · tx ${p.txHash}`,
  ].join("\n");
}

export function openRheDraft(p: Paid, fx: number | null) {
  const prof = readProfile();
  const dlg = document.createElement("dialog");
  dlg.className = "rhe";
  dlg.innerHTML = `
  <form method="dialog" class="rhe-body">
    <div class="rc-top">
      <div><p class="lbl"><i class="ph-light ph-file-text" aria-hidden="true"></i> ${tr("Draft · Recibo por Honorarios Electrónico (electronic fee receipt)", "Borrador · Recibo por Honorarios Electrónico")}</p><h3>${tr("Payment", "Cobro")} ${esc(p.ref)}</h3></div>
      <button class="btn ghost icon" value="close" aria-label="${tr("Close", "Cerrar")}"><i class="ph-light ph-x" aria-hidden="true"></i></button>
    </div>
    <dl class="rhe-fixed">
      <div><dt>${tr("Payment date", "Fecha del cobro")}</dt><dd class="num">${fmtDate(p.at)}</dd></div>
      <div><dt>${tr("Receipt amount", "Monto del recibo")}</dt><dd class="num">US$ ${usd(p)}</dd></div>
      <div><dt>${tr("In soles", "En soles")}</dt><dd class="num">${pen(p, fx) ? `S/ ${pen(p, fx)}` : tr("Exchange rate missing", "Falta el tipo de cambio")}</dd></div>
      <div><dt>${tr("Withholding (4th category)", "Retención de cuarta categoría")}</dt><dd id="rhe-ret">${tr("Does not apply · client abroad", "No aplica · cliente del exterior")}</dd></div>
      <div><dt>${tr("Client", "Cliente")}</dt><dd><select name="abroad" class="inline"><option value="yes">${tr("Outside Peru", "Fuera de Perú")}</option><option value="no">${tr("Domiciled in Peru", "Domiciliado en Perú")}</option></select></dd></div>
      <div><dt>${tr("Evidence", "Evidencia")}</dt><dd><a class="num" href="${EXPLORER}/tx/${p.txHash}" target="_blank" rel="noopener">${p.txHash.slice(0, 10)}… <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></dd></div>
    </dl>
    <div class="row2">
      <label class="field"><span class="lbl">${tr("Your name", "Tu nombre")}</span><input name="name" value="${esc(prof.name)}" maxlength="80"></label>
      <label class="field"><span class="lbl">${tr("Your RUC (Peruvian taxpayer number)", "Tu RUC")}</span><input class="num" name="ruc" value="${esc(prof.ruc)}" inputmode="numeric" pattern="\\d{11}" maxlength="11" placeholder="10XXXXXXXXX"></label>
    </div>
    <label class="field"><span class="lbl">${tr("Client", "Cliente")}</span><input name="client" maxlength="80" placeholder="${tr("Name or company name", "Nombre o razón social")}"></label>
    <div class="row2">
      <label class="field"><span class="lbl">${tr("Client ID document", "Documento del cliente")}</span>
        <select name="docType">${tr(
          "<option>Passport (Pasaporte)</option><option>Tax ID from the client's country (Doc. tributario del país del cliente)</option><option>Other document (Otro documento)</option>",
          "<option>Pasaporte</option><option>Doc. tributario del país del cliente</option><option>Otro documento</option>")}</select></label>
      <label class="field"><span class="lbl">${tr("Number", "Número")}</span><input class="num" name="docNum" maxlength="20"></label>
    </div>
    <label class="field"><span class="lbl">${tr("Service description", "Descripción del servicio")}</span><input name="desc" maxlength="120" placeholder="${tr("Brand identity design", "Diseño de identidad visual")}"></label>
    <pre class="rhe-preview num" aria-live="polite"></pre>
    <p class="rhe-note"><i class="ph-light ph-info" aria-hidden="true"></i> ${tr(
      "Draft to copy when you issue your receipt in SUNAT Operaciones en Línea (SUNAT's online portal). The receipt can be issued in dollars; the soles equivalent is what you add up for the threshold and for the month's tax prepayment. We take 1 USDC as 1 US$. There is no SUNAT rule for crypto payments, so confirm it with your accountant.",
      "Borrador para copiar cuando emitas tu recibo en SUNAT Operaciones en Línea. El recibo se puede emitir en dólares; el equivalente en soles es lo que sumas para el umbral y para el pago a cuenta del mes. Tomamos 1 USDC como 1 US$. No hay una regla de SUNAT para cobros en cripto, así que confírmalo con tu contador.")}</p>
    <div class="actions">
      <button type="button" class="btn" id="rhe-copy"><i class="ph-light ph-copy" aria-hidden="true"></i>${tr("Copy draft", "Copiar borrador")}</button>
      <a class="btn ghost" href="https://www.sunat.gob.pe/sol.html" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>${tr("Go to SUNAT online", "Ir a SUNAT en línea")}</a>
    </div>
  </form>`;
  document.body.appendChild(dlg);

  const form = dlg.querySelector("form")!;
  const pre = dlg.querySelector(".rhe-preview")!;
  const fields = () => Object.fromEntries(new FormData(form)) as Record<string, string>;
  const refresh = () => {
    const f = fields();
    const extra = { pen: pen(p, fx) ?? "", fx: fx ? String(fx) : "" };
    const abroad = f.abroad !== "no";
    dlg.querySelector("#rhe-ret")!.textContent = abroad
      ? tr("Does not apply · client abroad", "No aplica · cliente del exterior")
      : tr("May apply · client domiciled in Peru", "Puede aplicar · cliente domiciliado en Perú");
    dlg.querySelector("#rhe-ret")!.className = abroad ? "" : "warn-text";
    pre.textContent = draftText(p, { ...f, ...extra });
    saveProfile({ name: f.name, ruc: f.ruc });
  };
  form.addEventListener("input", refresh);
  refresh();

  dlg.querySelector("#rhe-copy")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(pre.textContent ?? "");
      b.innerHTML = `<i class="ph-light ph-check" aria-hidden="true"></i>${tr("Copied", "Copiado")}`;
    } catch {
      b.textContent = tr("Select the text and copy it", "Selecciona el texto y cópialo");
    }
  });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
}
