import algokit_utils
import dotenv

from playground.hello_world import helloworld
from playground.hello_world.build import build


def demo() -> None:
    dotenv.load_dotenv()

    algod_client = algokit_utils.get_algod_client()

    # build the app spec
    app_spec_json = build().read_text()
    app_spec = algokit_utils.ApplicationSpecification.from_json(app_spec_json)

    # Create an Application client
    app_client = algokit_utils.ApplicationClient(
        # Get sandbox algod client
        algod_client=algod_client,
        # Pass instance of app to client
        app_spec=app_spec,
        # Get acct from sandbox and pass the signer
        signer=algokit_utils.get_sandbox_default_account(algod_client),
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
    call_response = app_client.call(helloworld.hello.method_spec(), {"name": "Beaker"})
    print(call_response.abi_result.return_value)  # "Hello, Beaker"


if __name__ == "__main__":
    demo()
