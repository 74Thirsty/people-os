#pragma version ~=0.4.3

"""
Idempotent PeopleOS HRS issuance and retirement controller.

Only approved backend operators may submit an operation. Each operation ID
can be executed exactly once across both mint and burn operations.
"""

interface HrsToken:
    def mint(receiver: address, amount: uint256) -> bool: nonpayable
    def burn_from(holder: address, amount: uint256) -> bool: nonpayable


token: public(address)
admin: public(address)
operators: public(HashMap[address, bool])
processed_operations: public(HashMap[bytes32, bool])

event OperatorUpdated:
    account: indexed(address)
    enabled: bool

event AdminTransferred:
    previous_admin: indexed(address)
    new_admin: indexed(address)

event OperationExecuted:
    operation_id: indexed(bytes32)
    operation_kind: indexed(uint8)
    account: indexed(address)
    amount: uint256


@deploy
def __init__(token_: address, admin_: address):
    assert token_ != empty(address), "zero token"
    assert admin_ != empty(address), "zero admin"
    self.token = token_
    self.admin = admin_


@external
def set_operator(account: address, enabled: bool):
    assert msg.sender == self.admin, "admin only"
    assert account != empty(address), "zero operator"
    self.operators[account] = enabled
    log OperatorUpdated(account=account, enabled=enabled)


@external
def transfer_admin(new_admin: address):
    assert msg.sender == self.admin, "admin only"
    assert new_admin != empty(address), "zero admin"
    previous: address = self.admin
    self.admin = new_admin
    self.operators[previous] = False
    log AdminTransferred(previous_admin=previous, new_admin=new_admin)


@external
def mint_once(operation_id: bytes32, receiver: address, amount: uint256) -> bool:
    assert self.operators[msg.sender], "operator only"
    assert operation_id != empty(bytes32), "zero operation id"
    assert not self.processed_operations[operation_id], "operation already processed"
    assert receiver != empty(address), "zero receiver"
    assert amount > 0, "zero amount"

    # A failed token call reverts this write as part of the same EVM transaction.
    self.processed_operations[operation_id] = True
    minted: bool = extcall HrsToken(self.token).mint(receiver, amount)
    assert minted, "token mint failed"
    log OperationExecuted(
        operation_id=operation_id,
        operation_kind=1,
        account=receiver,
        amount=amount
    )
    return True


@external
def burn_once(operation_id: bytes32, holder: address, amount: uint256) -> bool:
    assert self.operators[msg.sender], "operator only"
    assert operation_id != empty(bytes32), "zero operation id"
    assert not self.processed_operations[operation_id], "operation already processed"
    assert holder != empty(address), "zero holder"
    assert amount > 0, "zero amount"

    self.processed_operations[operation_id] = True
    burned: bool = extcall HrsToken(self.token).burn_from(holder, amount)
    assert burned, "token burn failed"
    log OperationExecuted(
        operation_id=operation_id,
        operation_kind=2,
        account=holder,
        amount=amount
    )
    return True
