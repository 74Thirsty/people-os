/**
 * Exact conversion between the minute-based PeopleOS HRS ledger and 18-decimal
 * HRS token base units.
 *
 * 1 HRS = 1 scheduled hour = 10^18 token base units.
 * For cumulative minute accounting, floor the cumulative total and mint/burn
 * only the difference from the previous cumulative total. This prevents
 * repeated per-minute rounding from accumulating token drift.
 */

export const HRS_TOKEN_DECIMALS = BigInt(18);
export const HRS_TOKEN_SCALE = BigInt(10) ** HRS_TOKEN_DECIMALS;
export const MINUTES_PER_HOUR = BigInt(60);

function toMinutes(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer number of minutes`);
  }
  return BigInt(value);
}

function unitsForMinuteCount(minutes: bigint): bigint {
  return (minutes * HRS_TOKEN_SCALE) / MINUTES_PER_HOUR;
}

/** Convert a cumulative minute quantity into HRS token base units. */
export function hrsTokenUnitsForMinutes(minutes: number): bigint {
  return unitsForMinuteCount(toMinutes(minutes, "minutes"));
}

/**
 * Calculate the token amount for a new cumulative minute total.
 * The caller stores the previous cumulative total and supplies it on every
 * subsequent consume/release event. A repeated total returns zero.
 */
export function hrsTokenUnitsDelta(
  previousCumulativeMinutes: number,
  nextCumulativeMinutes: number
): bigint {
  const previous = toMinutes(previousCumulativeMinutes, "previousCumulativeMinutes");
  const next = toMinutes(nextCumulativeMinutes, "nextCumulativeMinutes");
  if (next < previous) {
    throw new Error("next cumulative minutes cannot be less than previous cumulative minutes");
  }
  const previousUnits = unitsForMinuteCount(previous);
  const nextUnits = unitsForMinuteCount(next);
  return nextUnits - previousUnits;
}

/** Remaining token units for an allocation after cumulative consumed/released minutes. */
export function remainingHrsTokenUnits(
  scheduledMinutes: number,
  consumedAndReleasedMinutes: number
): bigint {
  const scheduled = toMinutes(scheduledMinutes, "scheduledMinutes");
  const accounted = toMinutes(consumedAndReleasedMinutes, "consumedAndReleasedMinutes");
  if (accounted > scheduled) {
    throw new Error("consumed and released minutes cannot exceed scheduled minutes");
  }
  return unitsForMinuteCount(scheduled) - unitsForMinuteCount(accounted);
}
