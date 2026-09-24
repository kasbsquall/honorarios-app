import { describe, expect, test } from "vitest";
import { DIRECTOR_CAP_PEN, DIRECTOR_THRESHOLD_PEN, PAYMENT_RATE, SUSPENSION_CAP_PEN, THRESHOLD_PEN, UIT_PEN, estimate } from "./tax";

const base = { appGrossPen: 0, otherFourthPen: 0, fifthPen: 0, withheldPen: 0, isDirectorIncome: false, confirmedComplete: true };

describe("the amounts are the ones cited by the resolution, never derived", () => {
  // Article 3 of R.S. 000390-2025/SUNAT, copy in evidencias/2026-09-20-resolucion-umbral.
  test("general regime: items a) and c)", () => {
    expect(THRESHOLD_PEN).toBe(4010);
    expect(SUSPENSION_CAP_PEN).toBe(48_125);
  });

  test("income under inciso b) of article 33: items b) and d)", () => {
    expect(DIRECTOR_THRESHOLD_PEN).toBe(3208);
    expect(DIRECTOR_CAP_PEN).toBe(38_500);
  });

  test("the inciso b) threshold is lower than the general one, which is why they are kept apart", () => {
    expect(DIRECTOR_THRESHOLD_PEN).toBeLessThan(THRESHOLD_PEN);
  });

  test("the 2026 UIT stays as the reference for the adjustment", () => {
    expect(UIT_PEN).toBe(5500);
  });
});

describe("fourth-category prepayment (pago a cuenta)", () => {
  test("below the threshold there is no prepayment", () => {
    const r = estimate({ ...base, appGrossPen: 1875 });
    expect(r.overThreshold).toBe(false);
    expect(r.duePen).toBe(0);
  });

  test("matching the threshold creates no obligation: the rule exempts when it is not exceeded", () => {
    const r = estimate({ ...base, appGrossPen: THRESHOLD_PEN });
    expect(r.overThreshold).toBe(false);
    expect(r.duePen).toBe(0);
  });

  test("one centimo over the threshold already creates the obligation", () => {
    const r = estimate({ ...base, appGrossPen: THRESHOLD_PEN + 0.01 });
    expect(r.overThreshold).toBe(true);
    expect(r.duePen).toBe(Math.round((THRESHOLD_PEN + 0.01) * PAYMENT_RATE * 100) / 100);
  });

  test("fifth-category income counts toward the threshold and stays out of the 8% base", () => {
    const r = estimate({ ...base, appGrossPen: 1875, fifthPen: 3000 });
    expect(r.monthTotalPen).toBe(4875);
    expect(r.overThreshold).toBe(true);
    expect(r.fourthBasePen).toBe(1875);
    expect(r.duePen).toBeCloseTo(150, 6); // 8% of 1875, never of 4875
  });

  test("other fourth-category income does go into the base", () => {
    const r = estimate({ ...base, appGrossPen: 1875, otherFourthPen: 2500 });
    expect(r.fourthBasePen).toBe(4375);
    expect(r.duePen).toBeCloseTo(350, 6);
  });

  test("withholdings already applied are subtracted from the month's payment", () => {
    const r = estimate({ ...base, appGrossPen: 5000, withheldPen: 100 });
    expect(r.duePen).toBeCloseTo(300, 6); // 400 - 100
  });

  test("a withholding larger than the payment does not produce a negative number", () => {
    const r = estimate({ ...base, appGrossPen: 5000, withheldPen: 900 });
    expect(r.duePen).toBe(0);
  });

  test("without an exchange rate no figure is stated", () => {
    const r = estimate({ ...base, appGrossPen: null, fifthPen: 9999 });
    expect(r.duePen).toBeNull();
    expect(r.reason).toBe("missing-fx");
    expect(r.overThreshold).toBe(false);
  });

  test("fifth-category income only: nothing to pay on fourth-category income even if the threshold is crossed", () => {
    const r = estimate({ ...base, appGrossPen: 0, fifthPen: 8000 });
    expect(r.overThreshold).toBe(true);
    expect(r.fourthBasePen).toBe(0);
    expect(r.duePen).toBe(0);
  });

  test("a negative amount cannot shrink the base and produce a short declaration", () => {
    const r = estimate({ ...base, appGrossPen: 5000, otherFourthPen: -3000 });
    expect(r.fourthBasePen).toBe(5000);
    expect(r.duePen).toBe(400);
  });

  test("a mistyped field arrives as NaN and counts as zero without breaking the calculation", () => {
    const r = estimate({ ...base, appGrossPen: 5000, fifthPen: Number.NaN, withheldPen: Number.NaN });
    expect(r.duePen).toBe(400);
  });

  test("the amount to declare is rounded to centimos", () => {
    const r = estimate({ ...base, appGrossPen: 4444.44 });
    expect(r.duePen).toBe(355.56); // 355.5552 rounded
  });

  test("without confirming there is no other income, a result under the threshold is provisional", () => {
    const r = estimate({ ...base, appGrossPen: 1875, confirmedComplete: false });
    expect(r.overThreshold).toBe(false);
    expect(r.provisional).toBe(true);
  });

  test("exceeding the threshold is not provisional: the obligation already applies", () => {
    const r = estimate({ ...base, appGrossPen: 9000, confirmedComplete: false });
    expect(r.provisional).toBe(false);
  });

  test("a director is compared against their own threshold, never the general one", () => {
    const r = estimate({ ...base, appGrossPen: 3500, isDirectorIncome: true });
    expect(r.thresholdPen).toBe(DIRECTOR_THRESHOLD_PEN);
    // With the general threshold (4,010) this month would have come out as "you owe nothing".
    expect(r.overThreshold).toBe(true);
    expect(r.duePen).toBe(280); // 8% of 3,500
  });

  test("a director below their threshold does not pay either", () => {
    const r = estimate({ ...base, appGrossPen: 3000, isDirectorIncome: true });
    expect(r.overThreshold).toBe(false);
    expect(r.duePen).toBe(0);
  });

  test("matching the inciso b) threshold creates no obligation", () => {
    const r = estimate({ ...base, appGrossPen: DIRECTOR_THRESHOLD_PEN, isDirectorIncome: true });
    expect(r.overThreshold).toBe(false);
  });

  test("fifth-category income also adds to the inciso b) threshold without entering the base", () => {
    const r = estimate({ ...base, appGrossPen: 1000, fifthPen: 2500, isDirectorIncome: true });
    expect(r.monthTotalPen).toBe(3500);
    expect(r.overThreshold).toBe(true);
    expect(r.duePen).toBe(80); // 8% of 1,000
  });

  test("without an exchange rate, the applicable threshold is already known and can be shown", () => {
    const r = estimate({ ...base, appGrossPen: null, isDirectorIncome: true });
    expect(r.thresholdPen).toBe(DIRECTOR_THRESHOLD_PEN);
    expect(r.duePen).toBeNull();
  });

  test("the director case still shows the month's running total", () => {
    const r = estimate({ ...base, appGrossPen: 1875, otherFourthPen: 500, fifthPen: 1000, isDirectorIncome: true });
    expect(r.fourthBasePen).toBe(2375);
    expect(r.monthTotalPen).toBe(3375);
    expect(r.thresholdPen).toBe(DIRECTOR_THRESHOLD_PEN);
  });
});
