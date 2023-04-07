from algokit_utils import LogicError
import application
from beaker import client, sandbox


def main() -> None:
    acct = sandbox.get_accounts().pop()
    algod_client = sandbox.get_algod_client()
    app_client = client.ApplicationClient(
        algod_client, application.app, signer=acct.signer
    )
    app_id, app_address, _ = app_client.create()
    print(f"Deployed Application ID: {app_id} Address: {app_address}")

    app_client.opt_in()
    print("Opted in")

    app_client.call(application.set_local_state_val, v=123)
    app_client.call(application.incr_local_state_val, v=1)
    result = app_client.call(application.get_local_state_val)
    print(f"Set/get acct state result: {result.return_value}")

    app_client.call(application.set_reserved_local_state_val, k=123, v="stuff")
    result = app_client.call(application.get_reserved_local_state_val, k=123)
    print(f"Set/get dynamic acct state result: {result.return_value}")

    try:
        app_client.call(application.set_global_state_val, v="Expect fail")
    except LogicError as e:
        print(f"Task failed successfully: {e}")

    result = app_client.call(application.get_global_state_val)
    print(f"Set/get app state result: {result.return_value}")

    app_client.call(application.set_reserved_global_state_val, k=15, v=123)
    result = app_client.call(application.get_reserved_global_state_val, k=15)
    print(f"Set/get dynamic app state result: {result.return_value}")

    msg = "abc123"

    # Account state blob
    app_client.call(application.write_local_blob, v=msg)
    result = app_client.call(application.read_local_blob)
    got_msg = bytes(result.return_value[: len(msg)]).decode()
    assert msg == got_msg
    print(f"wrote and read the message to local state {got_msg}")

    # App state blob
    app_client.call(application.write_global_blob, v=msg)
    print("wrote message to global state")


if __name__ == "__main__":
    main()
