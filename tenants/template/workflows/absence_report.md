# Absence report workflow
1. Authenticate the employee using configured identity policy.
2. Capture intended shift/date and whether this is an absence or late arrival.
3. Read the tenant's approved attendance policy.
4. Create an immutable absence-report event with source message/call reference.
5. Notify the configured manager or attendance queue.
6. If leave usage is requested, create a separate leave request; do not silently debit a balance.
7. Confirm only actions acknowledged by the backend.
8. Escalate policy conflicts and safety-related reports.
