#pragma version ~=0.4.3

"""
PeopleOS HRS fungible token.

All holder, spender, and receiver addresses must be explicitly approved
PeopleOS-controlled custody addresses or approved protocol contracts.
Employees must never receive signing keys or direct wallet access.
"""

name: public(String[64])
symbol: public(String[16])
decimals: public(uint8)
totalSupply: public(uint256)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])

admin: public(address)
minters: public(HashMap[address, bool])
burners: public(HashMap[address, bool])
custodians: public(HashMap[address, bool])
paused: public(bool)

event Transfer:
    sender: indexed(address)
    receiver: indexed(address)
    value: uint256

event Approval:
    owner: indexed(address)
    spender: indexed(address)
    value: uint256

event MinterUpdated:
    account: indexed(address)
    enabled: bool

event BurnerUpdated:
    account: indexed(address)
    enabled: bool

event CustodianUpdated:
    account: indexed(address)
    enabled: bool

event AdminTransferred:
    previous_admin: indexed(address)
    new_admin: indexed(address)

event PauseChanged:
    paused: bool


@deploy
def __init__(name_: String[64], symbol_: String[16], admin_: address):
    assert admin_ != empty(address), "zero admin"
    self.name = name_
    self.symbol = symbol_
    self.decimals = 18
    self.admin = admin_
    # Minting and burning are delegated to the idempotent HrsController.
    self.custodians[admin_] = True
    self.paused = False


@external
def set_minter(account: address, enabled: bool):
    assert msg.sender == self.admin, "admin only"
    assert account != empty(address), "zero account"
    self.minters[account] = enabled
    log MinterUpdated(account=account, enabled=enabled)


@external
def set_burner(account: address, enabled: bool):
    assert msg.sender == self.admin, "admin only"
    assert account != empty(address), "zero account"
    self.burners[account] = enabled
    log BurnerUpdated(account=account, enabled=enabled)


@external
def set_custodian(account: address, enabled: bool):
    assert msg.sender == self.admin, "admin only"
    assert account != empty(address), "zero account"
    self.custodians[account] = enabled
    log CustodianUpdated(account=account, enabled=enabled)


@external
def transfer_admin(new_admin: address):
    assert msg.sender == self.admin, "admin only"
    assert new_admin != empty(address), "zero admin"
    previous: address = self.admin
    self.admin = new_admin
    self.minters[previous] = False
    self.burners[previous] = False
    self.custodians[previous] = False
    log AdminTransferred(previous_admin=previous, new_admin=new_admin)


@external
def pause():
    assert msg.sender == self.admin, "admin only"
    assert not self.paused, "already paused"
    self.paused = True
    log PauseChanged(paused=True)


@external
def unpause():
    assert msg.sender == self.admin, "admin only"
    assert self.paused, "not paused"
    self.paused = False
    log PauseChanged(paused=False)


@external
def mint(receiver: address, amount: uint256) -> bool:
    assert self.minters[msg.sender], "minter only"
    assert not self.paused, "paused"
    assert receiver != empty(address), "zero receiver"
    assert self.custodians[receiver], "receiver not custodian"
    assert amount > 0, "zero amount"
    self.totalSupply += amount
    self.balanceOf[receiver] += amount
    log Transfer(sender=empty(address), receiver=receiver, value=amount)
    return True


@external
def burn_from(holder: address, amount: uint256) -> bool:
    assert self.burners[msg.sender], "burner only"
    assert not self.paused, "paused"
    assert holder != empty(address), "zero holder"
    assert amount > 0, "zero amount"
    assert self.balanceOf[holder] >= amount, "insufficient balance"
    self.balanceOf[holder] -= amount
    self.totalSupply -= amount
    log Transfer(sender=holder, receiver=empty(address), value=amount)
    return True


@internal
def _transfer(sender: address, receiver: address, amount: uint256):
    assert sender != empty(address), "zero sender"
    assert receiver != empty(address), "zero receiver"
    assert self.custodians[sender], "sender not custodian"
    assert self.custodians[receiver], "receiver not custodian"
    assert self.balanceOf[sender] >= amount, "insufficient balance"
    self.balanceOf[sender] -= amount
    self.balanceOf[receiver] += amount
    log Transfer(sender=sender, receiver=receiver, value=amount)


@external
def transfer(receiver: address, amount: uint256) -> bool:
    assert not self.paused, "paused"
    self._transfer(msg.sender, receiver, amount)
    return True


@external
def approve(spender: address, amount: uint256) -> bool:
    assert not self.paused, "paused"
    assert spender != empty(address), "zero spender"
    assert self.custodians[msg.sender], "owner not custodian"
    assert self.custodians[spender], "spender not custodian"
    self.allowance[msg.sender][spender] = amount
    log Approval(owner=msg.sender, spender=spender, value=amount)
    return True


@external
def transferFrom(sender: address, receiver: address, amount: uint256) -> bool:
    assert not self.paused, "paused"
    if msg.sender != sender:
        assert self.custodians[msg.sender], "spender not custodian"
        approved: uint256 = self.allowance[sender][msg.sender]
        assert approved >= amount, "allowance exceeded"
        self.allowance[sender][msg.sender] = approved - amount
        log Approval(owner=sender, spender=msg.sender, value=approved - amount)
    self._transfer(sender, receiver, amount)
    return True
