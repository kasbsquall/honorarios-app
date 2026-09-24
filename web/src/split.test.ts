import { describe, expect, test } from "vitest";
import { split, toUnits } from "./stellar";

/* This is the calculation the client sees on the screen where they sign. It must give
   exactly the same result as `pay` in contracts/split/src/lib.rs. */
describe("split shown before signing", () => {
  const usdc = (n: string) => toUnits(n);

  test("without a fee, 500 splits into 460 and 40", () => {
    const r = split(usdc("500"));
    expect(r.net).toBe(usdc("460"));
    expect(r.tax).toBe(usdc("40"));
    expect(r.fee).toBe(0n);
  });

  test("with a 50 bps fee, the net goes down and the reserve is untouched", () => {
    const r = split(usdc("500"), 50n);
    expect(r.tax).toBe(usdc("40"));
    expect(r.fee).toBe(usdc("2.5"));
    expect(r.net).toBe(usdc("457.5"));
  });

  test("the three parts always add up to the gross", () => {
    for (const amount of ["0.0000001", "0.33", "1", "999999.9999999"]) {
      for (const bps of [0n, 1n, 50n, 100n]) {
        const g = usdc(amount);
        const r = split(g, bps);
        expect(r.net + r.tax + r.fee).toBe(g);
      }
    }
  });

  test("the reserve rounds up, like the contract", () => {
    // 0.0000001 USDC: 8% is 0.000000008, which does not exist with 7 decimals.
    const r = split(1n);
    expect(r.tax).toBe(1n);
    expect(r.net).toBe(0n);
  });

  test("the fee truncates down, like the contract", () => {
    const r = split(1n, 100n);
    expect(r.fee).toBe(0n);
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
