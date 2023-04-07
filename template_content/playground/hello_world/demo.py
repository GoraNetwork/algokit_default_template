# Demonstrate the sample contract in this directory by building, deploying and calling the contract
import algokit_utils

import helloworld
from build import build


def demo() -> None:
    # build the app and get back the Path to app spec file
    app_spec_path = build()
    # Get LocalNet algod client
    algod_client = algokit_utils.get_algod_client(algokit_utils.AlgoClientConfig("http://localhost:4001", "a" * 64))
    # Get default account from LocalNet, this will be used as the signer
    account = algokit_utils.get_localnet_default_account(algod_client)
    # Create an Application client
    app_client = algokit_utils.ApplicationClient(
        algod_client=algod_client,
        app_spec=app_spec_path,
        signer=account,
    )

    # Deploy the app on-chain
    create_response = app_client.create()
    print(
        f"""Deployed app in txid {create_response.tx_id}
        App ID: {app_client.app_id} 
        Address: {app_client.app_address} 
    """
    )

    # Call the `hello` method
    call_response = app_client.call(helloworld.hello, name="Beaker")
    print(call_response.return_value)  # "Hello, Beaker"


if __name__ == "__main__":
    demo()
