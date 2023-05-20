# ruff: noqa: I001

import os
import algokit_utils
import json
import base64
from Crypto.Hash import SHA512

from typing import Any
from algosdk.transaction import (
    ApplicationCreateTxn,
    AssetCreateTxn,
    AssetTransferTxn,
    OnComplete,
    PaymentTxn,
    StateSchema,
    wait_for_confirmation
)
from algosdk.account import generate_account as ga
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer as ATC,
    TransactionSigner,
    AccountTransactionSigner
)
from algosdk.abi.method import get_method_by_name

import protocol.assets.main_approval as main_approval
import protocol.assets.main_clear as main_clear


ALGOD_CLIENT = algokit_utils.get_algod_client(
        algokit_utils.AlgoClientConfig(
            os.environ['ALGOD_SERVER'] +
            os.environ['ALGOD_PORT'],
            os.environ['ALGOD_TOKEN']
        )
    )

class Account(algokit_utils.Account):
    def __init__(self):
        pass

def generate_account() -> Account:
    new_account = ga()
    conformed_account = Account()
    conformed_account.address = new_account[0]
    conformed_account.private_key = new_account[1]

    return conformed_account

def fund_account(receiver:str,amount:int):
    # get dispenser account
    dispenser_account = algokit_utils.get_dispenser_account(ALGOD_CLIENT)
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = PaymentTxn(
        sender=dispenser_account.address,
        sp=suggested_params,
        receiver=receiver,
        amt=amount
    )
    signed_txn = unsigned_txn.sign(dispenser_account.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)

    print(json.dumps(txn_result, indent=4))

def deploy_token(account:Account):
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = AssetCreateTxn(
        asset_name="GORA",
        unitName="GORA",
        assetURL="goracle.io",
        decimals=6,
        total=1e16,
        sender=account.address,
        sp=suggested_params,
        assetMetadataHash="",
        defaultFrozen=False
    )
    signed_txn = unsigned_txn.sign(account.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)
    asset_id = txn_result["asset-index"]

    print(json.dumps(txn_result, indent=4))

    return asset_id

def get_methods_list(file_path:str):
    with open(file_path) as json_file:
        abi_json = json.load(json_file)
    abi_methods = abi_json["methods"]
    sorted_abi_json = sorted(abi_methods, key=lambda k: k["name"])

    return sorted_abi_json



def get_ABI_hash(file_path:str):
    sorted_abi_json = get_methods_list(file_path=file_path)

    for key in sorted_abi_json:
        if key["desc"]:
            del(sorted_abi_json["desc"])

    print(sorted_abi_json)
    h = SHA512.new(truncate="256")
    h.update(json.dumps(sorted_abi_json,separators=(",")))

def deploy_main_contract(
        deployer: Account,
        abi_hash,
        vote_approval_bytes,
        vote_clear_bytes,
        token_id,
        minimum_stake
    ):
    vote_approval_b64 = base64.b64decode(vote_approval_bytes)
    vote_clear_b64 = base64.b64decode(vote_clear_bytes)

    main_approval_code = main_approval(
        TOKEN_ASSET_ID=token_id,
        CONTRACT_VERSION=abi_hash,
        VOTE_APPROVAL_PROGRAM=vote_approval_b64,
        VOTE_CLEAR_PROGRAM=vote_clear_b64,
        MINIMUM_STAKE=minimum_stake
    )
    main_clear_code = main_clear()

    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = ApplicationCreateTxn(
        suggested_params=suggested_params,
        sender=deployer.address,
        on_complete=OnComplete.NoOpOC,
        approval_program=main_approval_code,
        clear_program=main_clear_code,
        extra_pages=3,
        global_schema=StateSchema(13,3),
        local_schema=StateSchema(7,4)
    )
    signed_txn = unsigned_txn.sign(deployer.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)

    print(json.dumps(txn_result, indent=4))
    return txn_result["application-index"]

def opt_in(token_id:int,user:Account):
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = AssetTransferTxn(
        suggested_params=suggested_params,
        sender=user.address,
        receiver=user.address,
        index=token_id,
        amt=0
    )
    signed_txn = unsigned_txn.sign(user.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)

    print(json.dumps(txn_result, indent=4))

def send_asa(
    main_account:Account,
    user:Account,
    asset_id,
    amount
):
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = AssetTransferTxn(
        suggested_params=suggested_params,
        sender=main_account.address,
        receiver=user.address,
        index=asset_id,
        amt=amount
    )
    signed_txn = unsigned_txn.sign(main_account.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)

    # print(json.dumps(txn_result, indent=4))

def init(
    gora_asset_id,
    user:Account,
    app_id,
    suggested_params,
    manager,
    path_to_abi_spec
):
    init_group = ATC()
    init_group.add_method_call(
        app_id=app_id,
        method=get_method_by_name(
            get_methods_list(path_to_abi_spec),
            "init"
        ),
        sender=user.address,
        sp=suggested_params,
        signer=AccountTransactionSigner(user.private_key),
        method_args=[
            gora_asset_id,
            manager
        ]
    )
    response = init_group.execute(ALGOD_CLIENT,4)

    print(response.abi_results)
