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
  new Date(d.getTime() - 5 * 3_600_000).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

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
    ? "Does not apply. A client not domiciled in Peru is not a withholding agent."
    : "May apply. If your client is domiciled in Peru and is a withholding agent, they must withhold 8% when the receipt exceeds the minimum amount set by SUNAT. Check that minimum and subtract what was withheld in the panel.";
}

function draftText(p: Paid, f: Record<string, string>) {
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
      <div><p class="lbl"><i class="ph-light ph-file-text" aria-hidden="true"></i> Draft · Recibo por Honorarios Electrónico (electronic fee receipt)</p><h3>Payment ${esc(p.ref)}</h3></div>
      <button class="btn ghost icon" value="close" aria-label="Close"><i class="ph-light ph-x" aria-hidden="true"></i></button>
    </div>
    <dl class="rhe-fixed">
      <div><dt>Payment date</dt><dd class="num">${fmtDate(p.at)}</dd></div>
      <div><dt>Receipt amount</dt><dd class="num">US$ ${usd(p)}</dd></div>
      <div><dt>In soles</dt><dd class="num">${pen(p, fx) ? `S/ ${pen(p, fx)}` : "Exchange rate missing"}</dd></div>
      <div><dt>Withholding (4th category)</dt><dd id="rhe-ret">Does not apply · client abroad</dd></div>
      <div><dt>Client</dt><dd><select name="abroad" class="inline"><option value="yes">Outside Peru</option><option value="no">Domiciled in Peru</option></select></dd></div>
      <div><dt>Evidence</dt><dd><a class="num" href="${EXPLORER}/tx/${p.txHash}" target="_blank" rel="noopener">${p.txHash.slice(0, 10)}… <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a></dd></div>
    </dl>
    <div class="row2">
      <label class="field"><span class="lbl">Your name</span><input name="name" value="${esc(prof.name)}" maxlength="80"></label>
      <label class="field"><span class="lbl">Your RUC (Peruvian taxpayer number)</span><input class="num" name="ruc" value="${esc(prof.ruc)}" inputmode="numeric" pattern="\\d{11}" maxlength="11" placeholder="10XXXXXXXXX"></label>
    </div>
    <label class="field"><span class="lbl">Client</span><input name="client" maxlength="80" placeholder="Name or company name"></label>
    <div class="row2">
      <label class="field"><span class="lbl">Client ID document</span>
        <select name="docType"><option>Passport (Pasaporte)</option><option>Tax ID from the client's country (Doc. tributario del país del cliente)</option><option>Other document (Otro documento)</option></select></label>
      <label class="field"><span class="lbl">Number</span><input class="num" name="docNum" maxlength="20"></label>
    </div>
    <label class="field"><span class="lbl">Service description</span><input name="desc" maxlength="120" placeholder="Brand identity design"></label>
    <pre class="rhe-preview num" aria-live="polite"></pre>
    <p class="rhe-note"><i class="ph-light ph-info" aria-hidden="true"></i> Draft to copy when you issue your receipt in SUNAT Operaciones en Línea (SUNAT's online portal). The receipt can be issued in dollars; the soles equivalent is what you add up for the threshold and for the month's tax prepayment. We take 1 USDC as 1 US$. There is no SUNAT rule for crypto payments, so confirm it with your accountant.</p>
    <div class="actions">
      <button type="button" class="btn" id="rhe-copy"><i class="ph-light ph-copy" aria-hidden="true"></i>Copy draft</button>
      <a class="btn ghost" href="https://www.sunat.gob.pe/sol.html" target="_blank" rel="noopener"><i class="ph-light ph-arrow-up-right" aria-hidden="true"></i>Go to SUNAT online</a>
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
      ? "Does not apply · client abroad"
      : "May apply · client domiciled in Peru";
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
      b.innerHTML = `<i class="ph-light ph-check" aria-hidden="true"></i>Copied`;
    } catch {
      b.textContent = "Select the text and copy it";
    }
  });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
}
