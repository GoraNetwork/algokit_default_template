# Demonstrate the sample contract in this directory by building, deploying and calling the contract
import algokit_utils
import sys
import os
import subprocess
import base64
import json
from pathlib import Path
from algosdk import atomic_transaction_composer as atc, abi,encoding
from algosdk.transaction import LogicSigAccount

from dotenv import load_dotenv
load_dotenv()

path = os.getcwd()
parent = os.path.dirname(path)
sys.path.append(parent)
default_app_path = path + "/default_app"
protocol_filepath = path + "/protocol"
sys.path.append('.')

import default_app
from utils import *
from abi_structures import response_body_type
from build import build

app = default_app.app

def demo() -> None:
    with open(default_app_path + "/feed_examples.json") as f:
        feed_examples = json.load(f)
    feed_type = "defi"
    feed_example = feed_examples[feed_type]
    feed_result_bytes = convert_feed_result_json(feed_example)

    # cli: algokit localnet start
    subprocess.run(["algokit","localnet","reset"])
    subprocess.run(["algokit","localnet","start"])

    # import algod with localnet params
    client = ALGOD_CLIENT

    # get suggested params
    suggested_params = client.suggested_params()

    # fund owner account
    owner = generate_account()
    fund_account(owner.address,1_000_000_000_000)

    # deploy test Gora token
    asset_id = deploy_token(owner)

    # compile the vote_verify_lsig
    vote_verify_lsig_out = subprocess.run(["python", protocol_filepath + "/assets/vote_verify_lsig.py", ""],capture_output=True)
    vote_verify_lsig_compiled = compileTeal(vote_verify_lsig_out.stdout)
    vote_verify_lsig_bytes = base64.b64decode(vote_verify_lsig_compiled["result"])
    vote_verify_lsig_acct = LogicSigAccount(vote_verify_lsig_bytes)

    # fund the lsig
    fund_account(vote_verify_lsig_acct.address(),1_000_000_000)

    # get hash of main contract's abi
    main_abi_hash = get_ABI_hash(protocol_filepath+"/assets/abi/main-contract.json")

    # compile vote contract
    vote_approval_out = subprocess.run(["python", protocol_filepath + "/assets/voting_approval.py", f"{{CONTRACT_VERSION: {main_abi_hash}, VOTE_VERIFY_LSIG_ADDRESS: {vote_verify_lsig_acct.address()}}}"],capture_output=True)
    vote_approval_out_compiled = compileTeal(vote_approval_out.stdout)
    vote_approval_out_b64 = vote_approval_out_compiled["result"]
    vote_clear_out = subprocess.run(["python", protocol_filepath + "/assets/voting_clear.py", ""],capture_output=True)
    vote_clear_out_compiled = compileTeal(vote_clear_out.stdout)
    vote_clear_out_b64 = vote_clear_out_compiled["result"]

    # deploy main contract
    main_approval_out = subprocess.run(
        [
            "python", protocol_filepath + "/assets/main_approval.py", 
            f"{{\
                TOKEN_ASSET_ID: {asset_id}, \
                CONTRACT_VERSION: {main_abi_hash},\
                VOTE_APPROVAL_PROGRAM: {vote_approval_out_b64},\
                VOTE_CLEAR_PROGRAM: {vote_clear_out_b64},\
                MINIMUM_STAKE: {500},\
            }}"],
            capture_output=True
    )
    main_approval_out_compiled = compileTeal(main_approval_out.stdout)
    main_approval_out_bytes = base64.b64decode(main_approval_out_compiled["result"])
    main_clear_out = subprocess.run(["python", protocol_filepath + "/assets/main_clear.py", ""],capture_output=True)
    main_clear_out_compiled = compileTeal(main_clear_out.stdout)
    main_clear_out_bytes = base64.b64decode(main_clear_out_compiled["result"])

    main_app = Main_Contract(
        client,
        owner,
        asset_id,
        main_approval_out_bytes,
        main_clear_out_bytes,
        owner.address
    )

    #generate a requester and opt into Gora token
    requester = generate_account()
    fund_account(requester.address,1_000_000)
    opt_in(token_id=asset_id,user=requester)

    send_asa(owner,requester,asset_id,50_000_000_000)

    fund_account(main_app.address, 202_000)
    # fund_account(main_app_address, 2955000)

    # compile the app spec and teal files
    default_app_client = None
    app_spec_path_str = default_app_path + "/artifacts/application.json"
    app_spec_path = Path(app_spec_path_str)
    build(main_app.id,True)

    default_app_client = algokit_utils.ApplicationClient(
        algod_client=ALGOD_CLIENT,
        app_spec=app_spec_path,
        signer=requester,
    )

    # Deploy the app on-chain
    create_response = default_app_client.create()
    default_app_id = default_app_client.app_id
    default_app_address = default_app_client.app_address
    fund_account(default_app_address, 100_000+3200) # TODO: can't figure out why I need the extra 3200
    print(
        f"""
            Deployed app in txid {create_response.tx_id}
            App ID: {default_app_client.app_id}
            Address: {default_app_client.app_address}
        """
    )

    # Create a data box
    data_box_name = bytes(feed_type,"utf-8")

    # we add 8 to account for the abi array length indicator at the beginning
    print(len(feed_result_bytes))
    data_box_cost = (len(data_box_name) + len(feed_result_bytes) + 8) * 400 + 2500
    
    signer = atc.AccountTransactionSigner(owner.private_key)

    # Set up app to make requests
    fund_account(default_app_address, 602_500 + data_box_cost)

    default_app_client.call(
        default_app.opt_in_gora,
        asset_reference=asset_id,
        main_app_reference=main_app.id
    )

    main_app.deposit_algo(owner,100_000,default_app_address)
    main_app.deposit_token(owner,7_000_000_000,default_app_address)

    # Form request inputs
    key = b"foo"
    form_values = {
        "assets":"eth",
        "curr": "usd",
        "destinationAppId": default_app_id,
        "destMethod": "TODO"
    }
    url_params = json.dumps(form_values)
    source_args_arr = \
        [int(i) for i in b"v2/crypto/prices"] + \
        [int(i) for i in b"TODO api key needed?"] + \
        [int(i) for i in bytes(url_params,"utf-8")] + \
        [int(i) for i in b"number"] + \
        [int(i) for i in b"$.price"]
    

    app_public_key = encoding.decode_address(default_app_address)
    hash = SHA512.new(truncate="256")
    hash.update(app_public_key + key)
    box_name_hex = hash.hexdigest()
    box_name = [int(box_name_hex[i:i+2],16) for i in range(0,len(box_name_hex),2)]
    box_name_type = abi.ArrayStaticType(abi.ByteType(),32)

    # Make a request
    call_response = default_app_client.call(
        default_app.send_request,
        transaction_parameters=algokit_utils.OnCompleteCallParameters(
            signer=signer,
            sender=owner.address,
            suggested_params=suggested_params,
            boxes=[(main_app.id,box_name_type.encode(box_name))]
        ),
        box_name=data_box_name,
        key=key,
        token_asset_id=asset_id,
        source_arr=[[6,source_args_arr,60]],
        agg_method=3,
        user_data=b"test",
        main_app_reference=main_app.id
    )
    print("Request tx_id: ", call_response.tx_id)
    print("\n")
    print("## Request successfully submitted! ##")

    # Here we will assume votes have passed and will now pass "validated" data to the contract
    # Normally this will be done by a voter from the voting contract
    response_body = response_body_type.encode([
        bytes([0]*32),
        default_app_address,
        feed_result_bytes,
        b"this_is_user_data",
        0,
        10
    ])

    default_app_client.call(
        default_app.write_to_data_box,
        transaction_parameters=algokit_utils.OnCompleteCallParameters(
            signer=signer,
            sender=owner.address,
            suggested_params=suggested_params,
            boxes=[(default_app_id,data_box_name)]
        ),
        response_type_bytes=abi.ArrayDynamicType(abi.ByteType()).encode([1]),
        response_body_bytes=response_body
    )
    
    # now we'll hop over to dappflow and you can view the box information
    subprocess.run(["algokit", "localnet", "explore"])

if __name__ == "__main__":
    demo()
