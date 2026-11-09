# Scheduled HRS and verified time workflow

## Trigger
A manager publishes or changes an employee schedule, or an employee submits a clock event through an authenticated company channel.

## Schedule publication
1. Resolve tenant, employee, effective schedule, timezone, pay period, and schedule version.
2. Validate employee status and manager authorization in the schedule service.
3. Calculate scheduled duration in integer minutes, excluding unpaid breaks.
4. Call createHrsWorkflowService(...).createAndMintApprovedSchedule(...) only after the schedule authorization verifier succeeds. One database transaction creates the schedule allocation, provisions or resolves the employee-attributed custodial wallet, and mints exactly the approved scheduled minutes. The database locks the wallet, enforces tenant/employee linkage and schedule-version idempotency, and posts the mint atomically.
5. If a prior allocation is superseded, post a release for its unused remainder. Never edit or delete prior ledger entries.
6. Notify the employee through the configured phone channel. Never expose HRS wallet access or balance controls.

## Clock-in and clock-out
1. Verify employee identity and tenant context using the configured authentication policy.
2. Validate source signature, timestamp, replay protection, and event idempotency in the trusted timekeeping service.
3. Record the raw clock event and source reference in the audit trail.
4. Calculate compensable minutes using tenant timezone, break rules, and applicable policy.
5. Call consumeVerifiedClockEvent(...) only after the clock verification callback succeeds.
6. The database locks the wallet/allocation and rejects consumption beyond remaining HRS. Work beyond allocation becomes a time exception; do not overdraw HRS or discard work.
7. Reconcile the shift and send the employee a confirmation of recorded time.

## Schedule modification and close
- Recalculate affected allocation from the approved schedule version.
- Release only unused scheduled minutes.
- Preserve all prior entries and source evidence.
- Corrections are positive manager/administrator-authorized credits in the current posting RPC. A negative correction/debit workflow is not yet implemented.
- At period close, reconcile issued, consumed, released, corrected, and exception minutes against approved time records.
- Route approved time to the deterministic payroll engine.

## Security boundary
- The SQL posting functions are executable only by Supabase service_role.
- Do not call these RPCs from browsers, employee clients, LLM tools, or agent credentials.
- The TypeScript workflow accepts verifier callbacks; production must wire these to actual schedule approval, employee identity, signed clock event, and replay-protection services.
- A service-role caller is trusted. The database does not independently prove that a caller's clock evidence is authentic.

## Cash-out boundary
This workflow never sends money. An employee request to cash out routes to the separate earned-wage eligibility and provider payout workflow. Scheduled or unconsumed HRS are never cash-out eligible. Only verified, legally eligible earned wages may be considered.
