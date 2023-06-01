# ruff: noqa: I001
import os
import algokit_utils
import json
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
    ApplicationCallTxn,
    ApplicationOptInTxn,
    AssetCreateTxn,
    AssetTransferTxn,
    LogicSigAccount,
    OnComplete,
    PaymentTxn,
    StateSchema,
    wait_for_confirmation
)
from algosdk.account import generate_account as ga
from algosdk.encoding import decode_address
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    TransactionWithSigner,
    AccountTransactionSigner
)
from algosdk.abi.method import get_method_by_name, Method
from algosdk import abi
from algosdk.logic import *
from algokit_utils import ApplicationClient,Account
from algosdk.v2client.algod import AlgodClient
from abi_structures import *

ALGOD_CLIENT = algokit_utils.get_algod_client()

class VoteContract():
    def __init__(
        self,
        algod_client: AlgodClient,
        id: int,
        main_app_id: int
    ):
        self.id = id
        self.address = get_application_address(self.id)
        self.client = algod_client
        self.main_app_id = main_app_id

    def _get_vote_hash(
        destination_app_id:int,
        destination_sig:bytes,
        requester_address:str,
        request_id:bytes,
        user_vote:str | bytes,
        user_data:str,
        error_code:int,
        bit_field:int
    ):
        response_body = response_body_type.encode([
            request_id,
            requester_address,
            user_vote,
            user_data,
            error_code,
            bit_field
        ])
        response_body_bytes = response_body_bytes_type.encode(response_body)

    def register_voter(
        self,
        participation_account: Account,
        primary_account_address: str,
    ):        
        atc = AtomicTransactionComposer()

        unsigned_payment_txn = PaymentTxn(
            sender=participation_account.address,
            sp=self.client.suggested_params(),
            receiver=get_application_address(self.id),
            amt=54100 + 66900
        )
        signer = AccountTransactionSigner(participation_account.private_key)
        signed_payment_txn = TransactionWithSigner(
            unsigned_payment_txn,
            signer
        )

        path_to_abi_spec = protocol_filepath + "/assets/abi/voting-contract.json"
        
        atc.add_method_call(
            app_id=self.id,
            method=get_method_by_name(
                get_methods_list(path_to_abi_spec),
                "register_voter"
            ),
            sender=participation_account.address,
            sp=self.client.suggested_params(),
            signer=signer,
            method_args=[
                signed_payment_txn,
                decode_address(primary_account_address),
                self.main_app_id
            ],
            boxes=[(self.id,decode_address(primary_account_address))]
        )

        result = atc.execute(self.client,4)
        return result
    
    def vote(
        self,
        vote_verify_lsig_acct:LogicSigAccount,
        vrf_result:str,
        vrf_proof:str,
        request_round_seed:bytes,
        request_key_hash:bytes,
        previous_vote:bytes,
        primary_account_address:str,
        participation_account:Account,
        destination_app_id:int,
        destination_method:bytes,
        requester_address:str,
        vote_count:int,
        z_index:int,
    ):
        atc = AtomicTransactionComposer()

        sp = self.client.suggested_params()
        sp.flat_fee = True
        sp.fee = 0

        byte64_type = abi.ArrayStaticType(abi.ByteType(),64)
        byte80_type = abi.ArrayStaticType(abi.ByteType(),80)

        primary_account_pk = decode_address(requester_address)
        previous_vote_box = self.client.application_box_by_name(self.id,primary_account_pk)
        previous_vote_entry = local_history_entry.decode(previous_vote_box)
        previous_requester = previous_vote_entry[1][5]

        signer = vote_verify_lsig_acct

        key_hash = 

        vote_verify_box_array = [
            (
                self.id,
                previous_vote_entry[1][0] # previous_vote proposal
            ),
            (
                self.main_app_id,
                request_key_hash
            ),
            (
                self.main_app_id,
                key_hash
            )
        ]

        atc.add_method_call(
            app_id=self.main_app_id,
            method=get_method_by_name(
                get_methods_list(protocol_filepath + "/assets/abi/main-contract.json"),
                "claim_rewards_vote_verify"
            ),
            sender=vote_verify_lsig_acct.address(),
            sp=sp,
            signer=vote_verify_lsig_acct,
            method_args=[
                byte64_type.encode(vrf_result),
                byte80_type.encode(vrf_proof),
                request_round_seed,
                request_key_hash,
                previous_vote
            ],
            accounts=[
                participation_account.address,
                primary_account_address,
                self.address,
                previous_requester
            ],
            foreign_apps=[
                self.id
            ],
            boxes=vote_verify_box_array
        )

        sp = self.client.suggested_params()
        sp.flat_fee = True
        sp.fee = 2000

        atc.add_method_call(
            method=get_method_by_name(
                get_methods_list(protocol_filepath + "/assets/abi/voting-contract.json"),
                "vote"
            ),
            lease=lease,
            method_args=[
                byte64_type.encode(vrf_result),
                byte80_type.encode(vrf_proof),
                self.main_app_id,
                destination_app_id,
                destination_method,
                requester_address,
                primary_account_pk,
                response_type,
                response_body,
                vote_count,
                z_index,
                atc.txn_list[0]
            ],
            boxes=[
                vote_box_array,
                box_refs
            ],
            foreign_apps=[app_refs],
            accounts=[account_refs],
            foreign_assets=[asset_refs],
            app_id=self.id,
            sp=sp,
            sender=participation_account.address,
            signer=signer,            
        )

        result = atc.execute(self.client,4)
        return result

class MainContract():
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
            sp = self.client.suggested_params()
            sp.flat_fee = True
            sp.fee = 2000

            init_group = AtomicTransactionComposer()
            init_group.add_method_call(
                app_id=self.id,
                method=get_method_by_name(
                    get_methods_list(path_to_abi_spec),
                    "init"
                ),
                sender=user.address,
                sp=sp,
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
    
    def register_key(
        self,
        user: Account,
        participation_account_address: str
    ):
        atc = AtomicTransactionComposer()

        path_to_abi_spec = protocol_filepath + "/assets/abi/main-contract.json"
        
        atc.add_method_call(
            app_id=self.id,
            method=get_method_by_name(
                get_methods_list(path_to_abi_spec),
                "register_participation_account"
            ),
            sender=user.address,
            sp=self.client.suggested_params(),
            signer=AccountTransactionSigner(user.private_key),
            method_args=[
                decode_address(participation_account_address)
            ]
        )

        result = atc.execute(self.client,4)
        return result
    
    def deploy_voting_contract(
        self,
        user = None,
    ):
        if user == None:
            user = self.owner
        elif type(user) != Account:
            raise TypeError("Only Account type is allowed")
        
        atc = AtomicTransactionComposer()

        path_to_abi_spec = protocol_filepath + "/assets/abi/main-contract.json"

        sp = self.client.suggested_params()
        sp.flat_fee = True
        sp.fee = 3000
        
        atc.add_method_call(
            app_id=self.id,
            method=get_method_by_name(
                get_methods_list(path_to_abi_spec),
                "deploy_voting_contract"
            ),
            sender=user.address,
            sp=sp,
            signer=AccountTransactionSigner(user.private_key),
            method_args=[]
        )

        txn_result = atc.execute(self.client,4)
        vote_app_id = txn_result.abi_results[0].tx_info["inner-txns"][0]["application-index"]

        vote_contract = VoteContract(
            self.client,
            vote_app_id,
            self.id
        )

        return vote_contract
    
    def stake(
        self,
        user: Account,
        amount: int
    ):
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
                "stake"
            ),
            sender=user.address,
            sp=self.client.suggested_params(),
            signer=signer,
            method_args=[
                signed_transfer_txn
            ]
        )

        result = atc.execute(self.client,4)
        return result

class GoracleUser():
    def __init__(self):
        self.voter_account = generate_account()
        self.participation_account = generate_account()

def generate_account() -> Account:
    new_account = ga()
    return Account(private_key=new_account[0],address=new_account[1])

def fund_account(receiver_address:str,amount:int):
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

def opt_in_token(token_id:int,user:Account):
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

def opt_into_app(user:Account,app_id:int):
    suggested_params = ALGOD_CLIENT.suggested_params()

    unsigned_txn = ApplicationOptInTxn(
        sender=user.address,
        sp=suggested_params,
        index=app_id,
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

# mock voting and request processing
def prepare_voter(asset_id:int,owner:Account,main_app:MainContract,vote_app:VoteContract):
    goracle_user = GoracleUser()
    fund_account(goracle_user.voter_account.address, 1_500_000)
    opt_in_token(asset_id,goracle_user.voter_account)
    send_asa(owner,goracle_user.voter_account,asset_id,50_000_000_000)
    fund_account(goracle_user.participation_account.address, 1_500_000)
    fund_account(goracle_user.voter_account.address, 1_500_000)

    # opt primary account into main contract
    opt_into_app(goracle_user.voter_account,main_app.id)
    opt_into_app(goracle_user.participation_account,main_app.id)

    # register voter public key on the main app
    main_app.register_key(
        goracle_user.voter_account,
        goracle_user.participation_account.address
    )

    # register participation key on the vote app
    vote_app.register_voter(
        goracle_user.participation_account,
        goracle_user.voter_account.address
    )

    # voter stakes to be able to have votes
    main_app.stake(goracle_user.voter_account,500_000_000)
    main_app.deposit_algo(goracle_user.voter_account,100_000)
    main_app.deposit_token(goracle_user.voter_account,40_000_000_000)
    return goracle_user
