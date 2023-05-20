# Demonstrate the sample contract in this directory by building, deploying and calling the contract
import algokit_utils
import pathlib
import sys
import os
from dotenv import load_dotenv

from algosdk.transaction import LogicSigAccount
from algosdk.logic import get_application_address

load_dotenv()

# from build import build
# from utils import *
# sys.path.append('.')
import default_app
from protocol.assets import vote_verify_lsig
from protocol.assets import voting_approval
from protocol.assets import voting_clear


def demo() -> None:
    # cli: algokit localnet start

    # import algod with localnet params
    client = ALGOD_CLIENT

    # get suggested params
    suggested_params = client.suggested_params()
    # fund owner account
    owner = generate_account()
    fund_account(owner,1e12)

    # deploy test Gora token
    asset_id = deploy_token(owner)

    # compile the vote_verify_lsig
    vote_verify_lsig_binary = vote_verify_lsig()
    # vote_verify_lsig_binary = [char for char in vote_verify_lsig_binary]
    vote_verify_lsig_acct = LogicSigAccount(vote_verify_lsig_binary)

    # fund the lsig
    fund_account(vote_verify_lsig_acct.address(),1e9)

    # get hash of main contract
    abi_hash = get_ABI_hash(pathlib.Path(__file__).parent.resolve()+"../protocol/assets/abi/main-contract.json")

    # compile vote contract
    voting_approval_code = voting_approval(
        CONTRACT_VERSION=abi_hash,
        VOTE_VERIFY_LSIG_ADDRESS=vote_verify_lsig_acct.address()
    )
    voting_clear_code = voting_clear()
    # deploy main contract
    main_app_id = deploy_main_contract(
        owner,
        abi_hash=abi_hash,
        vote_approval_bytes=voting_approval_code,
        vote_clear_bytes=voting_clear_code,
        token_id=asset_id,
        minimum_stake=500
    )
    main_app_address = get_application_address(main_app_id)

    #generate a requester and opt into Gora token
    requester = generate_account()
    fund_account(requester.address,1e6)
    opt_in(token_id=asset_id,user=requester)

    send_asa(owner,requester,asset_id,50_000_000_000)

    fund_account(main_app_address, 202_000)
    # fund_account(main_app_address, 2955000)

    # build the app and get back the Path to app spec file
    default_app_spec_path = build(MAIN_APP_ADDRESS=main_app_address,MAIN_APP_ID=main_app_id)

    # Create an Application client
    default_app_client = algokit_utils.ApplicationClient(
        algod_client=ALGOD_CLIENT,
        app_spec=default_app_spec_path,
        signer=requester,
    )

    # Deploy the app on-chain
    create_response = default_app_client.create()
    print(
        f"""
            Deployed app in txid {create_response.tx_id}
            App ID: {default_app_client.app_id}
            Address: {default_app_client.app_address}
        """
    )

    # Make a request
    call_response = default_app_client.call(
        default_app.send_request,
        name="Beaker"
    )
    print(call_response.return_value)  # Submit a request to a local Goracle instance


if __name__ == "__main__":
    demo()
