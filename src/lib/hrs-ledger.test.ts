import { describe, expect, it } from "vitest";
import {
  consumeWorkedHrs,
  formatHrs,
  getHrsBalance,
  mintScheduledHrs,
  releaseUnusedHrs
} from "./hrs-ledger";

describe("HRS allocation ledger rules", () => {
  it("mints scheduled hours without representing earned wages", () => {
    const allocation = mintScheduledHrs("allocation-1", 40 * 60);
    expect(getHrsBalance(allocation)).toEqual({
      issuedMinutes: 2400,
      consumedMinutes: 0,
      releasedMinutes: 0,
      remainingMinutes: 2400
    });
  });

  it("consumes only verified time and preserves fractional hours exactly", () => {
    const allocation = mintScheduledHrs("allocation-1", 40 * 60);
    const afterShift = consumeWorkedHrs(allocation, 7 * 60 + 30);
    expect(getHrsBalance(afterShift)).toMatchObject({
      consumedMinutes: 450,
      remainingMinutes: 1950
    });
    expect(formatHrs(450)).toBe("7.50");
  });

  it("rejects work time beyond the scheduled allocation", () => {
    const allocation = mintScheduledHrs("allocation-1", 8 * 60);
    expect(() => consumeWorkedHrs(allocation, 8 * 60 + 1)).toThrow(/exceeds/);
  });

  it("releases only unused scheduled HRS", () => {
    const allocation = consumeWorkedHrs(mintScheduledHrs("allocation-1", 40 * 60), 32 * 60);
    const closed = releaseUnusedHrs(allocation);
    expect(getHrsBalance(closed)).toEqual({
      issuedMinutes: 2400,
      consumedMinutes: 1920,
      releasedMinutes: 480,
      remainingMinutes: 0
    });
  });

  it("rejects invalid, negative, fractional-minute and over-release values", () => {
    expect(() => mintScheduledHrs("a", 0)).toThrow();
    expect(() => mintScheduledHrs("a", 1.5)).toThrow();
    const allocation = mintScheduledHrs("a", 60);
    expect(() => releaseUnusedHrs(allocation, 61)).toThrow(/release/);
    expect(() => formatHrs(-1)).toThrow();
  });

  it("requires an allocation identifier", () => {
    expect(() => mintScheduledHrs(" ", 60)).toThrow(/allocationId/);
  });
});
