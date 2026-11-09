# Leave request workflow
1. Authenticate the employee.
2. Resolve leave type, requested dates, duration, and required details.
3. Read the tenant's approved leave policy and verified balance.
4. Create a pending request; do not approve automatically unless explicit tenant policy and permission authorize it.
5. Route to the configured approver.
6. Record approver identity, decision, timestamp, and policy version.
7. Update the leave ledger only after an authorized decision.
8. Notify the employee of verified status.
