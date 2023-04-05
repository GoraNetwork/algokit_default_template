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

    result = app_client.call("sum_tuple_elements_with_use", t=(123, 456))
    print(f"{result.method.name} returned {result.return_value}")

    result = app_client.call("sum_tuple_elements_with_store_into", t=(123, 456))
    print(f"{result.method.name} returned {result.return_value}")

    result = app_client.call("sum_dynamic_array", v=[1, 2, 3, 4, 5, 6])
    print(f"{result.method.name} returned {result.return_value}")

    result = app_client.call("concat_dynamic_arrays", a=[1, 2, 3], b=[4, 5, 6])
    print(f"{result.method.name} returned {result.return_value}")

    result = app_client.call("concat_static_arrays", a=[1, 2, 3], b=[4, 5, 6])
    print(f"{result.method.name} returned {result.return_value}")

    result = app_client.call(
        "concat_dynamic_string_arrays", a=["a", "b", "c"], b=["d", "e", "f"]
    )
    print(f"{result.method.name} returned {result.return_value}")


if __name__ == "__main__":
    main()
