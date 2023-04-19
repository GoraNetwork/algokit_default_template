from algokit_utils import LogicError
import application
from beaker import client, sandbox, consts
from algosdk import encoding, abi


def main() -> None:
    accts = sandbox.get_accounts()
    acct = accts.pop()
    member = accts.pop()

    algod_client = sandbox.get_algod_client()
    app_client = client.ApplicationClient(
        algod_client, application.app, signer=acct.signer
    )

    # create the app
    app_id, app_address, _ = app_client.create()
    print(f"Deployed Application ID: {app_id} Address: {app_address}")

    # fund the app with enough to cover the min balance for the boxes we need
    # plus some extra to cover any boxes created with `fill_box`
    min_balance = application.compute_min_balance(application.MAX_MEMBERS) * 2
    app_client.fund(min_balance)

    # bootstrap to create the BoxList `members`
    # note this must happen _after_ its been funded
    app_client.call(application.bootstrap, boxes=[(0, b"members")])

    # Call the method to add a new member
    boxes = [(0, encoding.decode_address(member.address)), (0, b"members")]
    app_client.call(application.add_member, addr=member.address, boxes=boxes)

    # We can read a box directly
    box_contents = app_client.get_box_contents(encoding.decode_address(member.address))
    decoded_box_contents = abi.ABIType.from_string("uint64").decode(box_contents)
    print(decoded_box_contents)

    # Or call the read-only method we've implemented
    # to get the parsed version
    result = app_client.call(application.read_balance, addr=member.address, boxes=boxes)
    print(result.return_value)

    # Set the balance and read it back out
    app_client.call(
        application.set_balance, addr=member.address, amount=100, boxes=boxes
    )
    result = app_client.call(application.read_balance, addr=member.address, boxes=boxes)
    print(result.return_value)

    # fill the box with some data
    box_name = "mybox"
    app_client.call(
        application.fill_box,
        box_name=box_name,
        box_data=["hello", "world"],
        boxes=[(0, box_name.encode())],
    )
    # read it back out
    box_contents = app_client.get_box_contents(box_name.encode())
    print(box_contents)
    # decode it using the sdk ABI methods
    decoded_box_contents = abi.ABIType.from_string("string[]").decode(box_contents)
    print(decoded_box_contents)


if __name__ == "__main__":
    main()
