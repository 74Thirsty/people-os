# HRS smart-contract layer

## Implemented in this branch

- `src/HrsToken.vy`: Vyper 0.4.3 ERC-20 token with 18 decimals.
- Admin-controlled, separately assignable mint and burn roles.
- Pause/unpause control.
- Standard ERC-20 transfers, approvals, and delegated transfers.
- Privileged `burn_from` lets an authorized PeopleOS burner retire units from a company-custodied address without giving that address's key to the burner.
- `tests/test_hrs_token.py`: local EVM tests using Titanoboa.
- CI compiles the Vyper contract and runs the EVM tests.

## Custody model

The token contract does not give employees keys or wallet access. PeopleOS must control every address that holds HRS. The admin, minter, and burner addresses must be controlled by a multisig or an appropriately secured custody system before any live deployment. Do not use a developer EOA or a hot application key as the permanent admin.

The ERC-20 transfer interface is intentionally standard so PeopleOS-controlled wallets and approved smart-contract integrations can move HRS. It does not make employee access permissible: no employee address may be provisioned as a signer or receive a private key.

## Important boundaries

This is the first on-chain token contract, not a complete launch. It is not deployed and has not received an independent security audit. The chain, production custody provider, multisig threshold, admin succession policy, supply policy, market venue/router, swap asset, liquidity design, and payout settlement model are not yet configured. No deployment keys, RPC secrets, or wallet private keys belong in this repository.

The existing PostgreSQL HRS ledger remains the operational record until a separately tested chain adapter and reconciliation process are implemented. The adapter must be idempotent, persist transaction hashes and confirmations, reconcile reorgs, and prevent duplicate mint/burn actions across database and chain boundaries.

Do not deploy this contract to mainnet or enable live minting until:
1. The production chain and token economics are explicitly approved.
2. Admin/minter/burner control is moved to audited multisig/custody infrastructure.
3. The chain adapter and database reconciliation are implemented and tested.
4. Independent smart-contract security review is complete.
5. Legal review clears issuance, transfers, swaps, custody, and any payout/redemption feature.

Swaps and payouts are deliberately not implemented in this initial contract. A swap requires a selected chain, quote asset, venue/router, slippage and price-impact limits, liquidity source, and approval policy. A payout requires a separately defined settlement asset, beneficiary model, provider, authorization, idempotency, and reconciliation. These are not safe to invent inside a generic token contract.
