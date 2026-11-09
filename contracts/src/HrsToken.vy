#pragma version ~=0.4.3

"""
PeopleOS HRS fungible token.

All token-holder addresses are expected to be company-controlled custody
addresses. Employees must never receive signing keys or direct wallet access.
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
    self.minters[admin_] = True
    self.burners[admin_] = True
    self.paused = False


@external
def set_minter(account: address, enabled: bool):
    assert msg.sender == self.admin, "admin only"
    assert account != empty(address), "zero account"
    self.minters[account] = enabled
    log MinterUpdated(account, enabled)


@external
def set_burner(account: address, enabled: bool):
    assert msg.sender == self.admin, "admin only"
    assert account != empty(address), "zero account"
    self.burners[account] = enabled
    log BurnerUpdated(account, enabled)


@external
def transfer_admin(new_admin: address):
    assert msg.sender == self.admin, "admin only"
    assert new_admin != empty(address), "zero admin"
    previous: address = self.admin
    self.admin = new_admin
    log AdminTransferred(previous, new_admin)


@external
def pause():
    assert msg.sender == self.admin, "admin only"
    assert not self.paused, "already paused"
    self.paused = True
    log PauseChanged(True)


@external
def unpause():
    assert msg.sender == self.admin, "admin only"
    assert self.paused, "not paused"
    self.paused = False
    log PauseChanged(False)


@external
def mint(receiver: address, amount: uint256) -> bool:
    assert self.minters[msg.sender], "minter only"
    assert not self.paused, "paused"
    assert receiver != empty(address), "zero receiver"
    assert amount > 0, "zero amount"
    self.totalSupply += amount
    self.balanceOf[receiver] += amount
    log Transfer(empty(address), receiver, amount)
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
    log Transfer(holder, empty(address), amount)
    return True


@internal
def _transfer(sender: address, receiver: address, amount: uint256):
    assert sender != empty(address), "zero sender"
    assert receiver != empty(address), "zero receiver"
    assert self.balanceOf[sender] >= amount, "insufficient balance"
    self.balanceOf[sender] -= amount
    self.balanceOf[receiver] += amount
    log Transfer(sender, receiver, amount)


@external
def transfer(receiver: address, amount: uint256) -> bool:
    assert not self.paused, "paused"
    self._transfer(msg.sender, receiver, amount)
    return True


@external
def approve(spender: address, amount: uint256) -> bool:
    assert not self.paused, "paused"
    assert spender != empty(address), "zero spender"
    self.allowance[msg.sender][spender] = amount
    log Approval(msg.sender, spender, amount)
    return True


@external
def transferFrom(sender: address, receiver: address, amount: uint256) -> bool:
    assert not self.paused, "paused"
    if msg.sender != sender:
        approved: uint256 = self.allowance[sender][msg.sender]
        assert approved >= amount, "allowance exceeded"
        self.allowance[sender][msg.sender] = approved - amount
        log Approval(sender, msg.sender, approved - amount)
    self._transfer(sender, receiver, amount)
    return True
