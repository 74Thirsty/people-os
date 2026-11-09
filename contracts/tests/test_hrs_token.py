import boa
import pytest


@pytest.fixture
def actors():
    return {
        "admin": boa.env.generate_address(),
        "minter": boa.env.generate_address(),
        "burner": boa.env.generate_address(),
        "treasury": boa.env.generate_address(),
        "custody_wallet": boa.env.generate_address(),
        "spender": boa.env.generate_address(),
        "outsider": boa.env.generate_address(),
    }


@pytest.fixture
def token(actors):
    deployed = boa.load(
        "contracts/src/HrsToken.vy",
        "PeopleOS Hours",
        "HRS",
        actors["admin"],
    )
    with boa.env.prank(actors["admin"]):
        deployed.set_custodian(actors["treasury"], True)
        deployed.set_custodian(actors["custody_wallet"], True)
        deployed.set_custodian(actors["spender"], True)
    return deployed


def test_deployment_sets_metadata_and_separates_roles(token, actors):
    assert token.name() == "PeopleOS Hours"
    assert token.symbol() == "HRS"
    assert token.decimals() == 18
    assert token.totalSupply() == 0
    assert token.admin() == actors["admin"]
    assert token.minters(actors["admin"]) is True
    assert token.burners(actors["admin"]) is True
    assert token.custodians(actors["admin"]) is True


def test_only_admin_can_grant_mint_and_burn_roles(token, actors):
    with boa.env.prank(actors["admin"]):
        token.set_minter(actors["minter"], True)
        token.set_burner(actors["burner"], True)

    assert token.minters(actors["minter"]) is True
    assert token.burners(actors["burner"]) is True

    with boa.env.prank(actors["outsider"]), boa.reverts("admin only"):
        token.set_minter(actors["outsider"], True)


def test_authorized_minter_can_mint_to_company_custody_wallet(token, actors):
    amount = 40 * 10**18
    with boa.env.prank(actors["admin"]):
        token.mint(actors["treasury"], amount)

    assert token.balanceOf(actors["treasury"]) == amount
    assert token.totalSupply() == amount


def test_unprivileged_account_cannot_mint(token, actors):
    with boa.env.prank(actors["outsider"]), boa.reverts("minter only"):
        token.mint(actors["treasury"], 10**18)


def test_authorized_burner_can_burn_from_custodied_wallet(token, actors):
    amount = 40 * 10**18
    with boa.env.prank(actors["admin"]):
        token.mint(actors["custody_wallet"], amount)
        token.set_burner(actors["burner"], True)

    with boa.env.prank(actors["burner"]):
        token.burn_from(actors["custody_wallet"], 5 * 10**18)

    assert token.balanceOf(actors["custody_wallet"]) == 35 * 10**18
    assert token.totalSupply() == 35 * 10**18


def test_burn_cannot_exceed_custodied_balance(token, actors):
    with boa.env.prank(actors["admin"]):
        token.mint(actors["custody_wallet"], 2 * 10**18)

    with boa.env.prank(actors["admin"]), boa.reverts("insufficient balance"):
        token.burn_from(actors["custody_wallet"], 3 * 10**18)


def test_erc20_transfer_and_allowance_flow(token, actors):
    with boa.env.prank(actors["admin"]):
        token.mint(actors["treasury"], 40 * 10**18)

    with boa.env.prank(actors["treasury"]):
        token.approve(actors["spender"], 12 * 10**18)

    with boa.env.prank(actors["spender"]):
        token.transferFrom(actors["treasury"], actors["custody_wallet"], 7 * 10**18)

    assert token.balanceOf(actors["treasury"]) == 33 * 10**18
    assert token.balanceOf(actors["custody_wallet"]) == 7 * 10**18
    assert token.allowance(actors["treasury"], actors["spender"]) == 5 * 10**18


def test_pausing_blocks_mint_burn_transfer_and_approval(token, actors):
    with boa.env.prank(actors["admin"]):
        token.mint(actors["treasury"], 10**18)
        token.pause()

    with boa.env.prank(actors["admin"]), boa.reverts("paused"):
        token.mint(actors["treasury"], 10**18)

    with boa.env.prank(actors["admin"]), boa.reverts("paused"):
        token.burn_from(actors["treasury"], 1)

    with boa.env.prank(actors["treasury"]), boa.reverts("paused"):
        token.transfer(actors["custody_wallet"], 1)

    with boa.env.prank(actors["treasury"]), boa.reverts("paused"):
        token.approve(actors["spender"], 1)

    with boa.env.prank(actors["admin"]):
        token.unpause()

    with boa.env.prank(actors["treasury"]):
        assert token.transfer(actors["custody_wallet"], 1) is True


def test_zero_address_is_rejected(token, actors):
    with boa.env.prank(actors["admin"]), boa.reverts("zero receiver"):
        token.mint("0x0000000000000000000000000000000000000000", 10**18)

    with boa.env.prank(actors["admin"]):
        token.mint(actors["treasury"], 10**18)

    with boa.env.prank(actors["treasury"]), boa.reverts("zero receiver"):
        token.transfer("0x0000000000000000000000000000000000000000", 1)


def test_admin_transfer_does_not_silently_grant_mint_or_burn_roles(token, actors):
    with boa.env.prank(actors["admin"]):
        token.transfer_admin(actors["outsider"])

    assert token.admin() == actors["outsider"]
    assert token.minters(actors["outsider"]) is False
    assert token.burners(actors["outsider"]) is False
    assert token.minters(actors["admin"]) is False
    assert token.burners(actors["admin"]) is False
    assert token.custodians(actors["admin"]) is False

    with boa.env.prank(actors["admin"]), boa.reverts("admin only"):
        token.pause()

    with boa.env.prank(actors["outsider"]):
        token.set_minter(actors["outsider"], True)


def test_non_custodial_addresses_cannot_receive_or_spend_hrs(token, actors):
    with boa.env.prank(actors["admin"]):
        token.mint(actors["treasury"], 2 * 10**18)

    with boa.env.prank(actors["treasury"]), boa.reverts("receiver not custodian"):
        token.transfer(actors["outsider"], 10**18)

    with boa.env.prank(actors["treasury"]), boa.reverts("spender not custodian"):
        token.approve(actors["outsider"], 10**18)

    with boa.env.prank(actors["admin"]), boa.reverts("receiver not custodian"):
        token.mint(actors["outsider"], 10**18)


def test_admin_can_authorize_and_revoke_a_custody_address(token, actors):
    with boa.env.prank(actors["admin"]):
        token.set_custodian(actors["outsider"], True)
        token.mint(actors["treasury"], 10**18)

    with boa.env.prank(actors["treasury"]):
        token.transfer(actors["outsider"], 10**18)

    assert token.balanceOf(actors["outsider"]) == 10**18

    with boa.env.prank(actors["admin"]):
        token.set_custodian(actors["outsider"], False)

    with boa.env.prank(actors["outsider"]), boa.reverts("sender not custodian"):
        token.transfer(actors["treasury"], 1)


def test_authorized_burner_can_retire_balance_after_custodian_revocation(token, actors):
    with boa.env.prank(actors["admin"]):
        token.mint(actors["custody_wallet"], 3 * 10**18)
        token.set_custodian(actors["custody_wallet"], False)

    with boa.env.prank(actors["admin"]):
        token.burn_from(actors["custody_wallet"], 3 * 10**18)

    assert token.balanceOf(actors["custody_wallet"]) == 0
    assert token.totalSupply() == 0
