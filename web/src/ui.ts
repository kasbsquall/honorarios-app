import { EXPLORER, fromUnits, split } from "./stellar";

export const MARK = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g transform="rotate(-90 12 12)" fill="none" stroke-width="4"><circle cx="12" cy="12" r="8.5" pathLength="100" stroke="currentColor" stroke-dasharray="90 10" stroke-dashoffset="-9"/><circle cx="12" cy="12" r="8.5" pathLength="100" stroke="var(--accent)" stroke-dasharray="6 94" stroke-dashoffset="-1"/></g></svg>`;

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type ReceiptText = { kicker: string; net: string; tax: string; fee: string; stub: string };

export const RECEIPT_PANEL: ReceiptText = {
  kicker: "Payment",
  net: "Net to you",
  tax: "Tax reserve · 8%",
  fee: "Service fee",
  stub: "Reserve 8%",
};

export const RECEIPT_EN: ReceiptText = {
  kicker: "Invoice",
  net: "To the freelancer",
  tax: "Peru tax reserve · 8%",
  fee: "Service fee",
  stub: "Tax reserve",
};

export function receiptCard(opts: {
  gross: bigint;
  title: string;
  ref: string;
  badge: string;
  text: ReceiptText;
  feeBps?: bigint;
  /** Actual split of a settled payment, as published by the contract. */
  actual?: { net: bigint; tax: bigint; fee: bigint };
  footLeft?: string;
  txHash?: string;
}) {
  const { net, tax, fee } = opts.actual ?? split(opts.gross, opts.feeBps ?? 0n);
  const pct = (part: bigint) =>
    opts.gross === 0n ? "" : ` · ${(Number((part * 10000n) / opts.gross) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  const t = opts.text;
  return `
  <article class="receipt">
    <div class="body">
      <div class="rc-top">
        <div><p class="lbl">${t.kicker} · ${esc(opts.ref)}</p><p>${esc(opts.title)}</p></div>
        ${opts.badge}
      </div>
      <p class="rc-amt">${fromUnits(opts.gross)}<small>USDC</small></p>
      <div class="bar" role="img" aria-label="${fromUnits(net)} / ${fromUnits(tax)}"><i class="n" style="flex:${Number(net)}"></i>${
        fee > 0n ? `<i class="f" style="flex:${Number(fee)}"></i>` : ""}<i class="s" style="flex:${Number(tax)}"></i></div>
      <dl class="legend">
        <dt><span class="sq" style="background:var(--ink)"></span><i class="ph-light ph-wallet" aria-hidden="true"></i>${t.net}${pct(net)}</dt><dd>${fromUnits(net)}</dd>
        <dt><span class="sq" style="background:var(--accent)"></span><i class="ph-light ph-vault" aria-hidden="true"></i>${t.tax}</dt><dd>${fromUnits(tax)}</dd>
        ${fee > 0n ? `<dt><span class="sq" style="background:var(--ink-3)"></span><i class="ph-light ph-receipt" aria-hidden="true"></i>${t.fee}${pct(fee)}</dt><dd>${fromUnits(fee)}</dd>` : ""}
      </dl>
      ${
        opts.footLeft || opts.txHash
          ? `<div class="rc-foot"><span>${opts.footLeft ?? ""}</span>${
              opts.txHash
                ? `<a href="${EXPLORER}/tx/${opts.txHash}" target="_blank" rel="noopener">tx ${opts.txHash.slice(0, 8)}… <i class="ph-light ph-arrow-up-right" aria-hidden="true"></i></a>`
                : ""
            }</div>`
          : ""
      }
    </div>
    <div class="stub"><span>${t.stub}</span></div>
  </article>`;
}
