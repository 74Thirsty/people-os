import { describe, expect, it } from "vitest";
import {
  HRS_TOKEN_SCALE,
  hrsTokenUnitsDelta,
  hrsTokenUnitsForMinutes,
  remainingHrsTokenUnits
} from "./hrs-token-units";

describe("HRS token base-unit conversion", () => {
  it("maps 40 scheduled hours to exactly 40 HRS", () => {
    expect(hrsTokenUnitsForMinutes(40 * 60)).toBe(BigInt(40) * HRS_TOKEN_SCALE);
  });

  it("preserves fractional hours", () => {
    expect(hrsTokenUnitsForMinutes(7 * 60 + 30)).toBe(BigInt(7) * HRS_TOKEN_SCALE + HRS_TOKEN_SCALE / BigInt(2));
  });

  it("uses cumulative rounding so sixty one-minute events equal exactly one HRS", () => {
    let cumulative = 0;
    let totalUnits = BigInt(0);
    for (let i = 0; i < 60; i += 1) {
      const next = cumulative + 1;
      totalUnits += hrsTokenUnitsDelta(cumulative, next);
      cumulative = next;
    }
    expect(totalUnits).toBe(HRS_TOKEN_SCALE);
  });

  it("does not mint or burn again for a repeated cumulative minute total", () => {
    expect(hrsTokenUnitsDelta(450, 450)).toBe(BigInt(0));
  });

  it("calculates release/remaining units from total accounted minutes", () => {
    const scheduled = hrsTokenUnitsForMinutes(40 * 60);
    const accounted = hrsTokenUnitsForMinutes(32 * 60);
    expect(remainingHrsTokenUnits(40 * 60, 32 * 60)).toBe(scheduled - accounted);
    expect(remainingHrsTokenUnits(40 * 60, 40 * 60)).toBe(BigInt(0));
  });

  it("rejects invalid, unsafe, negative, and decreasing minute totals", () => {
    expect(() => hrsTokenUnitsForMinutes(-1)).toThrow();
    expect(() => hrsTokenUnitsForMinutes(1.5)).toThrow();
    expect(() => hrsTokenUnitsForMinutes(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => hrsTokenUnitsDelta(61, 60)).toThrow(/less than/);
    expect(() => remainingHrsTokenUnits(60, 61)).toThrow(/exceed/);
  });
});
