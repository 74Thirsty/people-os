# Scheduled HRS and verified time workflow

## Trigger
A manager publishes or changes an employee schedule, or an employee submits a clock event through an authenticated company channel.

## Schedule publication
1. Resolve tenant, employee, effective schedule, timezone, pay period, and schedule version.
2. Validate the employee is active and the actor may publish or modify the schedule.
3. Calculate scheduled duration in integer minutes, excluding unpaid breaks.
4. Create an HRS allocation and append a `schedule_mint` ledger entry with a unique idempotency key and schedule source reference.
5. If a prior allocation is superseded, append a `schedule_release` entry for its unused remainder. Never edit or delete prior ledger entries.
6. Notify the employee through the configured phone channel.

## Clock-in and clock-out
1. Verify employee identity and tenant context using the configured authentication policy.
2. Validate event signature, timestamp, replay protection, and idempotency.
3. Record the raw clock event and source reference in the audit trail.
4. Calculate elapsed compensable minutes using the tenant's timezone, break rules, and applicable policy.
5. Consume HRS only for verified compensable minutes and only up to the allocation remainder.
6. If time exceeds the allocation, create a time exception for review; do not overdraw HRS or discard work.
7. Reconcile the shift and send the employee a confirmation of recorded time.

## Schedule modification and close
- Recalculate the affected allocation from the approved schedule version.
- Release only unused scheduled minutes.
- Preserve all prior entries and source evidence.
- At period close, reconcile issued, consumed, released, and exception minutes against approved time records.
- Route approved time to the deterministic payroll engine.

## Cash-out boundary
This workflow never sends money. An employee's request to cash out routes to the separate earned-wage eligibility and provider payout workflow. Scheduled or unconsumed HRS are never cash-out eligible. Only verified, legally eligible earned wages may be considered.
