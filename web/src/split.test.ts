import { describe, expect, test } from "vitest";
import { PERU, bpsFromPct, isPeru, offsetLabel, pctOf, periodOf, split, toUnits } from "./stellar";

/* This is the calculation the client sees on the screen where they sign. It must give
   exactly the same result as `pay` in contracts/split/src/lib.rs. */
describe("split shown before signing", () => {
  const usdc = (n: string) => toUnits(n);

  test("without a fee, 500 splits into 460 and 40", () => {
    const r = split(usdc("500"), 800);
    expect(r.net).toBe(usdc("460"));
    expect(r.tax).toBe(usdc("40"));
    expect(r.fee).toBe(0n);
  });

  test("with a 50 bps fee, the net goes down and the reserve is untouched", () => {
    const r = split(usdc("500"), 800, 50n);
    expect(r.tax).toBe(usdc("40"));
    expect(r.fee).toBe(usdc("2.5"));
    expect(r.net).toBe(usdc("457.5"));
  });

  test("the three parts always add up to the gross", () => {
    for (const amount of ["0.0000001", "0.33", "1", "999999.9999999"]) {
      for (const bps of [0n, 1n, 50n, 100n]) {
        const g = usdc(amount);
        const r = split(g, 800, bps);
        expect(r.net + r.tax + r.fee).toBe(g);
      }
    }
  });

  test("the reserve rounds up, like the contract", () => {
    // 0.0000001 USDC: 8% is 0.000000008, which does not exist with 7 decimals.
    const r = split(1n, 800);
    expect(r.tax).toBe(1n);
    expect(r.net).toBe(0n);
  });

  test("the fee truncates down, like the contract", () => {
    const r = split(1n, 800, 100n);
    expect(r.fee).toBe(0n);
  });
});

describe("split at the receipt's own rate", () => {
  const usdc = (n: string) => toUnits(n);

  test("12.5% of 500 sets aside 62.5 and sends 437.5", () => {
    const r = split(usdc("500"), 1250);
    expect(r.tax).toBe(usdc("62.5"));
    expect(r.net).toBe(usdc("437.5"));
  });

  test("a 0% rate sends everything to the freelancer", () => {
    const r = split(usdc("500"), 0, 50n);
    expect(r.tax).toBe(0n);
    expect(r.net + r.fee).toBe(usdc("500"));
  });

  test("the 50% cap still rounds the reserve up and adds up to the gross", () => {
    const r = split(3n, 5000);
    expect(r.tax).toBe(2n);
    expect(r.net).toBe(1n);
  });
});

describe("tax profile", () => {
  test("only 8% on Lima time counts as the Peru preset", () => {
    expect(isPeru(PERU)).toBe(true);
    expect(isPeru({ taxBps: 800, utcOffsetMin: 0 })).toBe(false);
    expect(isPeru({ taxBps: 1000, utcOffsetMin: -300 })).toBe(false);
    expect(isPeru(null)).toBe(false);
  });

  test("the percentage typed by the user becomes basis points, 0 to 50 with one decimal", () => {
    expect(bpsFromPct("12.5")).toBe(1250);
    expect(bpsFromPct("0")).toBe(0);
    expect(bpsFromPct("50")).toBe(5000);
    expect(bpsFromPct("7,5")).toBe(750);
    expect(bpsFromPct("50.1")).toBeNull();
    expect(bpsFromPct("12.55")).toBeNull();
    expect(bpsFromPct("-1")).toBeNull();
    expect(bpsFromPct("")).toBeNull();
  });

  test("rates and offsets are written without noise", () => {
    expect(pctOf(800)).toBe("8");
    expect(pctOf(1250)).toBe("12.5");
    expect(offsetLabel(-300)).toBe("UTC-5");
    expect(offsetLabel(330)).toBe("UTC+5:30");
    expect(offsetLabel(0)).toBe("UTC+0");
  });

  test("the tax month follows the freelancer's offset, like the contract", () => {
    // 1 Oct 2026 03:00 UTC is still September in Lima and already October in UTC.
    const d = new Date(Date.UTC(2026, 9, 1, 3));
    expect(periodOf(d, -300)).toBe(2026 * 12 + 8);
    expect(periodOf(d, 0)).toBe(2026 * 12 + 9);
  });
});

describe("amount conversion", () => {
  test("respects Stellar's seven decimals", () => {
    expect(toUnits("1")).toBe(10_000_000n);
    expect(toUnits("0.0000001")).toBe(1n);
    expect(toUnits("500.50")).toBe(5_005_000_000n);
  });

  test("a negative amount is rejected instead of being read as positive", () => {
    expect(() => toUnits("-0.5")).toThrow();
  });
});
