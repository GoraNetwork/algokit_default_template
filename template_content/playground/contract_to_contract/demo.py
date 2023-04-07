import application
import beaker


def demo() -> None:
    algod_client = beaker.sandbox.get_algod_client()
    account = beaker.sandbox.get_accounts().pop()

    # create a couple of clients for the same underlying application
    # definition
    first_app_client = beaker.client.ApplicationClient(
        algod_client,
        application.app,
        signer=account.signer,
    )

    second_app_client = beaker.client.ApplicationClient(
        algod_client,
        application.app,
        signer=account.signer,
    )

    # Deploy the apps on-chain
    first_app_client.create()
    second_app_client.create()

    # fund the first app client

    # Set up our suggested params
    # to cover the fee for the inner transaction
    # that the app executes
    sp = algod_client.suggested_params()
    sp.fee = sp.min_fee * 2
    sp.flat_fee = True

    # Call the `call_other_application` method
    call_response = first_app_client.call(
        application.call_other_application,
        other_application=second_app_client.app_id,
        string_to_echo="Echo this",
        suggested_params=sp,
    )
    print(call_response.return_value)  # "Echo this"


if __name__ == "__main__":
    demo()
