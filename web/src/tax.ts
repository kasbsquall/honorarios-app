/** Estimate of the monthly tax prepayment (pago a cuenta) on cuarta categoria, that is
 * fourth-category income (independent work). Kept apart from the UI so it can be tested.
 *
 * All of the product's tax responsibility lives here. It is the only place where a mistake
 * turns into someone declaring too little, so it has no DOM and no network.
 */

/** UIT (Unidad Impositiva Tributaria, Peru's tax reference unit) for 2026: S/ 5,500, set by
 *  D.S. 301-2025-EF. The SUNAT resolution cites it as the reason for the adjustment, and it
 *  stays here as a reference for where the amounts come from. */
export const UIT_PEN = 5500;

/* The four amounts below are NOT derived. They are the ones set by article 3 of
 * Resolucion de Superintendencia N.o 000390-2025/SUNAT (Lima, December 30, 2025),
 * "Excepcion de la obligacion de efectuar pagos a cuenta y suspension de la obligacion de
 * efectuar retenciones y/o pagos a cuenta por rentas de cuarta categoria correspondientes
 * al ejercicio gravable 2026" (exception from the obligation to make prepayments, and
 * suspension of withholdings and/or prepayments on fourth-category income for tax year 2026).
 * Copy in evidencias/2026-09-20-resolucion-umbral/.
 *
 * Until now the app derived them from the UIT (8.75 and 7 UIT) and warned about it on screen.
 * The derivation gave the same numbers, but a tax app should not be guessing its own
 * main constant. */

/** Article 3.a): monthly threshold for the general fourth-category regime. */
export const THRESHOLD_PEN = 4010;

/** Article 3.b): monthly threshold for income under inciso b) of article 33 of the LIR
 *  (Ley del Impuesto a la Renta, the income tax law): company director, trustee
 *  (sindico), agent (mandatario), business manager (gestor de negocios), executor (albacea)
 *  and municipal councilor (regidor). */
export const DIRECTOR_THRESHOLD_PEN = 3208;

/** Article 3.c): projected annual cap for requesting the suspension (Formulario 1609). */
export const SUSPENSION_CAP_PEN = 48_125;

/** Article 3.d): the same annual cap for income under inciso b). */
export const DIRECTOR_CAP_PEN = 38_500;

export const PAYMENT_RATE = 0.08;

export type TaxInput = {
  /** Received through the app this month, already converted to soles. null if it cannot be known yet. */
  appGrossPen: number | null;
  /** Fourth-category income for the month received outside the app. */
  otherFourthPen: number;
  /** Fifth-category income (employment) for the month. It counts toward the threshold and stays out of the 8% base. */
  fifthPen: number;
  /** Fourth-category withholdings already applied this month. */
  withheldPen: number;
  /** Income under inciso b) of article 33: director, agent, councilor, trustee, executor.
   *  That group has its own, lower monthly threshold in article 3.b) of the resolution. */
  isDirectorIncome: boolean;
  /** The user confirmed that the month's manual fields are complete.
   *  Without that confirmation, "you are under the threshold" would be a claim based on nothing. */
  confirmedComplete?: boolean;
};

export type TaxEstimate = {
  /** Base of the prepayment: fourth-category income only. */
  fourthBasePen: number | null;
  /** Month total compared against the threshold: fourth plus fifth category. */
  monthTotalPen: number | null;
  overThreshold: boolean;
  /** Estimated prepayment. null when the app cannot state a figure. */
  duePen: number | null;
  /** The threshold this month was compared against, so it can be shown on screen. */
  thresholdPen: number;
  /** true when the result is "no prepayment due" but the user has not confirmed that they
   *  entered all their income for the month. The UI must not present that as settled. */
  provisional: boolean;
  /** Why there is no figure, when duePen is null. */
  reason: "missing-fx" | null;
};

/** An amount the user types: negative, NaN or infinite count as zero.
 *  A negative slipped into other income would shrink the base and produce a short declaration. */
const amount = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function estimate(input: TaxInput): TaxEstimate {
  const { appGrossPen: rawGross, isDirectorIncome } = input;
  const otherFourthPen = amount(input.otherFourthPen);
  const fifthPen = amount(input.fifthPen);
  const withheldPen = amount(input.withheldPen);
  // A blank exchange rate arrives as 0 and cannot convert anything.
  const appGrossPen = rawGross === null || !Number.isFinite(rawGross) || rawGross < 0 ? null : rawGross;

  // Income under inciso b) is compared against its own, lower threshold. Applying the general
  // one would give a reassuring "you are under" when the obligation already applies.
  const thresholdPen = isDirectorIncome ? DIRECTOR_THRESHOLD_PEN : THRESHOLD_PEN;

  if (appGrossPen === null) {
    return { fourthBasePen: null, monthTotalPen: null, overThreshold: false, duePen: null, thresholdPen, provisional: false, reason: "missing-fx" };
  }

  const fourthBasePen = appGrossPen + otherFourthPen;
  const monthTotalPen = fourthBasePen + fifthPen;
  // The rule exempts when the total "does not exceed" the threshold, so matching it creates no obligation.
  const overThreshold = monthTotalPen > thresholdPen;
  // Rounded to centimos, which is how it is declared and how the screen shows it.
  const duePen = overThreshold ? Math.round(Math.max(fourthBasePen * PAYMENT_RATE - withheldPen, 0) * 100) / 100 : 0;

  return {
    fourthBasePen, monthTotalPen, overThreshold, duePen, thresholdPen,
    provisional: !overThreshold && input.confirmedComplete !== true,
    reason: null,
  };
}
