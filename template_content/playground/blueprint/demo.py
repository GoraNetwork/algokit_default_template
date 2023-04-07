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

    # refer to the method by name
    result = app_client.call("add", a=10, b=20)
    print(f"add result: {result.return_value}")
    assert result.return_value == 30

    result = app_client.call("sub", a=10, b=5)
    print(f"sub result: {result.return_value}")
    assert result.return_value == 5

    result = app_client.call("mul", a=10, b=5)
    print(f"mul result: {result.return_value}")
    assert result.return_value == 50

    result = app_client.call("div", a=10, b=5)
    print(f"div result: {result.return_value}")
    assert result.return_value == 2

    # Since we set `n=5` in the blueprint, we can call the method
    # and expect the result to be 15
    result = app_client.call("add_n", a=10)
    print(f"add_n result: {result.return_value}")
    assert result.return_value == 15


if __name__ == "__main__":
    main()
