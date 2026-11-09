import boa
import pytest


def operation_id(value: int) -> bytes:
    return value.to_bytes(32, byteorder="big")


@pytest.fixture
def actors():
    return {
        "admin": boa.env.generate_address(),
        "operator": boa.env.generate_address(),
        "treasury": boa.env.generate_address(),
        "custody_wallet": boa.env.generate_address(),
        "spender": boa.env.generate_address(),
        "outsider": boa.env.generate_address(),
        "new_admin": boa.env.generate_address(),
    }


@pytest.fixture
def system(actors):
    token = boa.load(
        "contracts/src/HrsToken.vy",
        "PeopleOS Hours",
        "HRS",
        actors["admin"],
    )
    controller = boa.load(
        "contracts/src/HrsController.vy",
        token.address,
        actors["admin"],
    )

    with boa.env.prank(actors["admin"]):
        token.set_minter(controller.address, True)
        token.set_burner(controller.address, True)
        token.set_custodian(actors["treasury"], True)
        token.set_custodian(actors["custody_wallet"], True)
        token.set_custodian(actors["spender"], True)
        controller.set_operator(actors["operator"], True)

    return {"token": token, "controller": controller}


def test_token_deployment_has_no_direct_admin_mint_or_burn(system, actors):
    token = system["token"]
    assert token.name() == "PeopleOS Hours"
    assert token.symbol() == "HRS"
    assert token.decimals() == 18
    assert token.totalSupply() == 0
    assert token.admin() == actors["admin"]
    assert token.minters(actors["admin"]) is False
    assert token.burners(actors["admin"]) is False
    assert token.custodians(actors["admin"]) is True


def test_only_admin_can_configure_token_roles(system, actors):
    token = system["token"]
    with boa.env.prank(actors["outsider"]), boa.reverts("admin only"):
        token.set_minter(actors["outsider"], True)
    with boa.env.prank(actors["outsider"]), boa.reverts("admin only"):
        token.set_burner(actors["outsider"], True)


def test_only_admin_can_configure_controller_operators(system, actors):
    controller = system["controller"]
    with boa.env.prank(actors["outsider"]), boa.reverts("admin only"):
        controller.set_operator(actors["outsider"], True)


def test_authorized_operator_mints_once_to_custodied_wallet(system, actors):
    token = system["token"]
    controller = system["controller"]
    amount = 40 * 10**18

    with boa.env.prank(actors["operator"]):
        assert controller.mint_once(operation_id(1), actors["treasury"], amount) is True

    assert token.balanceOf(actors["treasury"]) == amount
    assert token.totalSupply() == amount
    assert controller.processed_operations(operation_id(1)) is True


def test_duplicate_mint_operation_cannot_issue_twice(system, actors):
    token = system["token"]
    controller = system["controller"]
    amount = 40 * 10**18

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(2), actors["treasury"], amount)

    with boa.env.prank(actors["operator"]), boa.reverts("operation already processed"):
        controller.mint_once(operation_id(2), actors["treasury"], amount)

    assert token.balanceOf(actors["treasury"]) == amount
    assert token.totalSupply() == amount


def test_unapproved_account_cannot_issue_even_if_token_admin(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["outsider"]), boa.reverts("operator only"):
        controller.mint_once(operation_id(3), actors["treasury"], 10**18)

    with boa.env.prank(actors["admin"]), boa.reverts("minter only"):
        token.mint(actors["treasury"], 10**18)


def test_authorized_operator_burns_once(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(4), actors["custody_wallet"], 40 * 10**18)
        controller.burn_once(operation_id(5), actors["custody_wallet"], 5 * 10**18)

    assert token.balanceOf(actors["custody_wallet"]) == 35 * 10**18
    assert token.totalSupply() == 35 * 10**18
    assert controller.processed_operations(operation_id(5)) is True


def test_duplicate_burn_operation_cannot_retire_twice(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(6), actors["custody_wallet"], 10 * 10**18)
        controller.burn_once(operation_id(7), actors["custody_wallet"], 4 * 10**18)

    with boa.env.prank(actors["operator"]), boa.reverts("operation already processed"):
        controller.burn_once(operation_id(7), actors["custody_wallet"], 4 * 10**18)

    assert token.balanceOf(actors["custody_wallet"]) == 6 * 10**18
    assert token.totalSupply() == 6 * 10**18


def test_same_operation_id_cannot_be_reused_for_opposite_action(system, actors):
    controller = system["controller"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(8), actors["treasury"], 2 * 10**18)

    with boa.env.prank(actors["operator"]), boa.reverts("operation already processed"):
        controller.burn_once(operation_id(8), actors["treasury"], 2 * 10**18)


def test_failed_token_call_does_not_consume_operation_id(system, actors):
    controller = system["controller"]
    token = system["token"]

    with boa.env.prank(actors["operator"]), boa.reverts("receiver not custodian"):
        controller.mint_once(operation_id(9), actors["outsider"], 10**18)

    assert controller.processed_operations(operation_id(9)) is False
    assert token.totalSupply() == 0


def test_burn_cannot_exceed_custodied_balance(system, actors):
    controller = system["controller"]
    token = system["token"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(10), actors["custody_wallet"], 2 * 10**18)

    with boa.env.prank(actors["operator"]), boa.reverts("insufficient balance"):
        controller.burn_once(operation_id(11), actors["custody_wallet"], 3 * 10**18)

    assert controller.processed_operations(operation_id(11)) is False
    assert token.balanceOf(actors["custody_wallet"]) == 2 * 10**18


def test_erc20_transfer_and_allowance_flow(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(12), actors["treasury"], 40 * 10**18)

    with boa.env.prank(actors["treasury"]):
        token.approve(actors["spender"], 12 * 10**18)

    with boa.env.prank(actors["spender"]):
        token.transferFrom(actors["treasury"], actors["custody_wallet"], 7 * 10**18)

    assert token.balanceOf(actors["treasury"]) == 33 * 10**18
    assert token.balanceOf(actors["custody_wallet"]) == 7 * 10**18
    assert token.allowance(actors["treasury"], actors["spender"]) == 5 * 10**18


def test_pause_blocks_token_movement_and_controller_operations(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(13), actors["treasury"], 10**18)

    with boa.env.prank(actors["admin"]):
        token.pause()

    with boa.env.prank(actors["operator"]), boa.reverts("paused"):
        controller.mint_once(operation_id(14), actors["treasury"], 10**18)

    with boa.env.prank(actors["operator"]), boa.reverts("paused"):
        controller.burn_once(operation_id(15), actors["treasury"], 1)

    with boa.env.prank(actors["treasury"]), boa.reverts("paused"):
        token.transfer(actors["custody_wallet"], 1)

    assert controller.processed_operations(operation_id(14)) is False
    assert controller.processed_operations(operation_id(15)) is False

    with boa.env.prank(actors["admin"]):
        token.unpause()


def test_zero_addresses_and_zero_operation_ids_are_rejected(system, actors):
    controller = system["controller"]

    with boa.env.prank(actors["operator"]), boa.reverts("zero operation id"):
        controller.mint_once(bytes(32), actors["treasury"], 10**18)

    with boa.env.prank(actors["operator"]), boa.reverts("zero receiver"):
        controller.mint_once(operation_id(16), "0x0000000000000000000000000000000000000000", 10**18)


def test_non_custodial_addresses_cannot_receive_or_spend_hrs(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(17), actors["treasury"], 2 * 10**18)

    with boa.env.prank(actors["treasury"]), boa.reverts("receiver not custodian"):
        token.transfer(actors["outsider"], 10**18)

    with boa.env.prank(actors["treasury"]), boa.reverts("spender not custodian"):
        token.approve(actors["outsider"], 10**18)

    with boa.env.prank(actors["operator"]), boa.reverts("receiver not custodian"):
        controller.mint_once(operation_id(18), actors["outsider"], 10**18)


def test_revoked_custody_balance_can_be_burned_by_controller(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["operator"]):
        controller.mint_once(operation_id(19), actors["custody_wallet"], 3 * 10**18)

    with boa.env.prank(actors["admin"]):
        token.set_custodian(actors["custody_wallet"], False)

    with boa.env.prank(actors["operator"]):
        controller.burn_once(operation_id(20), actors["custody_wallet"], 3 * 10**18)

    assert token.balanceOf(actors["custody_wallet"]) == 0
    assert token.totalSupply() == 0


def test_admin_succession_revokes_old_admin_operator_and_custody_access(system, actors):
    token = system["token"]
    controller = system["controller"]

    with boa.env.prank(actors["admin"]):
        controller.set_operator(actors["admin"], True)
        token.transfer_admin(actors["new_admin"])
        controller.transfer_admin(actors["new_admin"])

    assert token.admin() == actors["new_admin"]
    assert token.custodians(actors["admin"]) is False
    assert controller.admin() == actors["new_admin"]
    assert controller.operators(actors["admin"]) is False

    with boa.env.prank(actors["admin"]), boa.reverts("admin only"):
        controller.set_operator(actors["outsider"], True)

    with boa.env.prank(actors["new_admin"]):
        controller.set_operator(actors["operator"], False)
