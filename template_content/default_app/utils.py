# ruff: noqa: I001
import os
import algokit_utils
import json
import io
from Crypto.Hash import SHA512
from pprint import pprint
import sys
path = os.getcwd()
parent = os.path.dirname(path)
sys.path.append(parent)
protocol_filepath = path + "/protocol"
sys.path.append(".")

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
    AtomicTransactionComposer,
    TransactionWithSigner,
    AccountTransactionSigner
)
from algosdk.abi.method import get_method_by_name, Method
from algosdk.logic import *
from algokit_utils import ApplicationClient,Account
from algosdk.v2client.algod import AlgodClient

ALGOD_CLIENT = algokit_utils.get_algod_client()

class Main_Contract():
    def __init__(
        self,
        algod_client: AlgodClient,
        deployer: Account,
        gora_asset_id: int,
        main_approval_code: bytes,
        main_clear_code: bytes,
        manager: str
    ):
        self.id = 0
        self.address = None
        self.owner = None
        self.client = algod_client
        self.gora_asset_id = gora_asset_id
        self.manager = manager
        self.init_processed = False

        self._deploy(
            deployer,
            main_approval_code,
            main_clear_code
        )
        
        fund_account(self.address, 2_955_000)

        self._init(
            deployer
        )

    def _deploy(
        self,
        user: Account,
        main_approval_code: bytes,
        main_clear_code: bytes,
    ):
        if self.id != 0:
            raise RuntimeError("Contract has already been deployed")
        
        else:
            unsigned_txn = ApplicationCreateTxn(
                sp=self.client.suggested_params(),
                sender=user.address,
                on_complete=OnComplete.NoOpOC,
                approval_program=main_approval_code,
                clear_program=main_clear_code,
                extra_pages=3,
                global_schema=StateSchema(13,3),
                local_schema=StateSchema(7,4)
            )
            signed_txn = unsigned_txn.sign(user.private_key)

            txid = self.client.send_transaction(signed_txn)
            txn_result = wait_for_confirmation(self.client,txid,4)
            
            self.id = txn_result["application-index"]
            self.address = get_application_address(self.id)
            self.owner = user

            return self.id
    
    def _init(
        self,
        user:Account,
    ):
        if self.id == 0:
            raise RuntimeError("contract must be deployed first")
        
        if self.init_processed == True:
            raise RuntimeError("contract has already been initiated")
        
        else:
            path_to_abi_spec = protocol_filepath + "/assets/abi/main-contract.json"

            init_group = AtomicTransactionComposer()
            init_group.add_method_call(
                app_id=self.id,
                method=get_method_by_name(
                    get_methods_list(path_to_abi_spec),
                    "init"
                ),
                sender=user.address,
                sp=self.client.suggested_params(),
                signer=AccountTransactionSigner(user.private_key),
                method_args=[
                    self.gora_asset_id,
                    self.manager
                ]
            )
            response = init_group.execute(self.client,4)
            
            # update the contract object to show that it has been initialized
            self.init_processed = True

            return response.abi_results
    
    def deposit_algo(
        self,
        user:Account,
        amount:int,
        address_if_other=None
    ):
        # TODO: don't like how this is done and input naming is confusing
        # will need to change later
        account_to_deposit_to = user.address

        if type(address_if_other) is str:
            account_to_deposit_to = address_if_other
        
        atc = AtomicTransactionComposer()

        unsigned_payment_txn = PaymentTxn(
            sender=user.address,
            sp=self.client.suggested_params(),
            receiver=get_application_address(self.id),
            amt=amount
        )
        signer = AccountTransactionSigner(user.private_key)
        signed_payment_txn = TransactionWithSigner(
            unsigned_payment_txn,
            signer
        )

        path_to_abi_spec = protocol_filepath + "/assets/abi/main-contract.json"
        
        atc.add_method_call(
            app_id=self.id,
            method=get_method_by_name(
                get_methods_list(path_to_abi_spec),
                "deposit_algo"
            ),
            sender=user.address,
            sp=self.client.suggested_params(),
            signer=signer,
            method_args=[
                signed_payment_txn,
                account_to_deposit_to
            ]
        )

        result = atc.execute(self.client,4)
        return result
    
    def deposit_token(
        self,
        user:Account,
        amount:int,
        address_if_other=None
    ):
        account_to_deposit_to = user.address

        if type(address_if_other) is str:
            account_to_deposit_to = address_if_other
        
        atc = AtomicTransactionComposer()

        unsigned_transfer_txn = AssetTransferTxn(
            sender=user.address,
            sp=self.client.suggested_params(),
            receiver=get_application_address(self.id),
            amt=amount,
            index=self.gora_asset_id
        )
        signer = AccountTransactionSigner(user.private_key)
        signed_transfer_txn = TransactionWithSigner(
            unsigned_transfer_txn,
            signer
        )

        path_to_abi_spec = protocol_filepath + "/assets/abi/main-contract.json"
        
        atc.add_method_call(
            app_id=self.id,
            method=get_method_by_name(
                get_methods_list(path_to_abi_spec),
                "deposit_token"
            ),
            sender=user.address,
            sp=self.client.suggested_params(),
            signer=signer,
            method_args=[
                signed_transfer_txn,
                self.gora_asset_id,
                account_to_deposit_to
            ]
        )

        result = atc.execute(self.client,4)
        return result

def generate_account() -> Account:
    new_account = ga()
    # conformed_account = Account(new_account[0],new_account[1])
    # conformed_account.private_key = new_account[0]
    # conformed_account.address = new_account[1]

    # return conformed_account
    return Account(private_key=new_account[0],address=new_account[1])

def fund_account(receiver_address,amount:int):
    # get dispenser account
    dispenser_account = algokit_utils.get_dispenser_account(ALGOD_CLIENT)
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = PaymentTxn(
        sender=dispenser_account.address,
        sp=suggested_params,
        receiver=receiver_address,
        amt=amount
    )
    signed_txn = unsigned_txn.sign(dispenser_account.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)

    return json.dumps(txn_result, indent=4)

def deploy_token(account:Account):
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = AssetCreateTxn(
        asset_name="GORA",
        unit_name="GORA",
        url="goracle.io",
        decimals=6,
        total=1e16,
        sender=account.address,
        sp=suggested_params,
        metadata_hash="",
        default_frozen=False
    )
    signed_txn = unsigned_txn.sign(account.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)
    asset_id = txn_result["asset-index"]

    # print(json.dumps(txn_result, indent=4))

    return asset_id

def get_methods_list(file_path:str):
    with open(file_path) as json_file:
        abi_json = json.load(json_file)
    abi_methods = abi_json["methods"]

    methods_list = []
    for method in abi_methods:
        json_string = json.dumps(method)
        abi_method = Method.from_json(json_string)
        methods_list.append(abi_method)
    return methods_list

def get_ABI_hash(file_path:str):
    with open(file_path) as json_file:
        abi_json = json.load(json_file)
    abi_methods = abi_json["methods"]
    sorted_abi_json = sorted(abi_methods, key=lambda k: k["name"])
    for method in sorted_abi_json:
        if method["desc"]:
            del(method["desc"])
    sorted_abi_json_str = json.dumps(sorted_abi_json,sort_keys=True)

    h = SHA512.new(truncate="256")
    h.update(sorted_abi_json_str.encode())
    return h.hexdigest()

def compileTeal(program_source:bytes | str):
    program_source_str = None

    if type(program_source) == bytes:
        program_source_str = program_source.decode()
    elif type(program_source) == str:
        program_source_str = program_source
    else:
        raise TypeError(program_source)

    compile_response = ALGOD_CLIENT.compile(program_source_str)

    return compile_response

def opt_in(token_id:int,user:Account):
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = AssetTransferTxn(
        sp=suggested_params,
        sender=user.address,
        receiver=user.address,
        index=token_id,
        amt=0
    )
    signed_txn = unsigned_txn.sign(user.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)

    return json.dumps(txn_result, indent=4)

def send_asa(
    main_account:Account,
    user:Account,
    asset_id,
    amount
):
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = AssetTransferTxn(
        sp=suggested_params,
        sender=main_account.address,
        receiver=user.address,
        index=asset_id,
        amt=amount
    )
    signed_txn = unsigned_txn.sign(main_account.private_key)

    txid = ALGOD_CLIENT.send_transaction(signed_txn)
    txn_result = wait_for_confirmation(ALGOD_CLIENT,txid,4)

    return json.dumps(txn_result, indent=4)
