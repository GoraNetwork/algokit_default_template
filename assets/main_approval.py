import sys
import yaml
import os
import pathlib
from pyteal import *
from typing import Literal as L
from helpers.key_map import key_map
sys.path.append(os.path.join(pathlib.Path(__file__).parent.resolve(),".."))
from utils.gora_pyteal_utils import get_method_signature, SmartAssert, calc_box_cost
from utils.abi_types import RequestInfo, StakeHistoryTuple,LocalHistoryEntry,ProposalsEntry

hash_type = abi.StaticBytes[L[32]]
current_request_info = abi.make(RequestInfo)
request_abi = abi.make(abi.StaticBytes[L[32]])
key_hash = abi.make(hash_type)
is_history = abi.make(abi.Bool)
app_abi = abi.make(abi.Uint64)
round_abi = abi.make(abi.Uint64)
status_abi = abi.make(abi.Uint8)
total_stake_abi = abi.make(abi.Uint64)
stake_history_abi = abi.make(abi.StaticArray[StakeHistoryTuple,L[2]])
current_stake_abi = abi.make(StakeHistoryTuple)
historical_stake_abi = abi.make(StakeHistoryTuple)
stake_round_abi = abi.make(abi.Uint64)
new_stake_amount_abi = abi.make(abi.Uint64)
requester_algo_fee_abi = abi.make(abi.Uint64)
total_votes_abi = abi.make(abi.Uint64)
total_votes_refunded_abi = abi.make(abi.Uint64)

NUM_BYTES_LENGTH = Int(2)
BYTES_0_STRING = bytes("0"*32, "utf-8")

global_keys = key_map["main_global"]
local_keys = key_map["main_local"]
vote_global_keys = key_map["voting_global"]

request_status = key_map["request_status"]

def GetEnv(name):
    if name in os.environ and os.environ[name]:
        return os.environ[name]
    return False

# Check assert condition related to TIME_LOCK variable with the ability to
# ignore it if environment variable is set. Used in NR unit tests.
def CheckTimeLock(cond):
    if GetEnv("GORACLE_DEV_NO_TIME_LOCK"):
       return Int(1)
    return cond

is_creator = Seq([If(Txn.sender() == Global.creator_address()).Then(Approve()).Else(Reject())])
def CheckUpdateMode():
    if GetEnv("GORACLE_DEV_ALLOW_UPDATES"):
       return Approve()
    else:
        return is_creator

def approval_program(
    TOKEN_ASSET_ID, 
    MINIMUM_STAKE,
    CONTRACT_VERSION,
    VOTE_APPROVAL_PROGRAM,
    VOTE_CLEAR_PROGRAM
):
    TOKEN_ASSET_ID_INT = Int(TOKEN_ASSET_ID)
    CONTRACT_VERSION_BYTES = Bytes(CONTRACT_VERSION)
    MINIMUM_STAKE_INT = Int(MINIMUM_STAKE)

    @Subroutine(TealType.none)
    def populate_request_info_tmps(request_key_hash):
        return Seq([
            request_box := App.box_get(request_key_hash),
            SmartAssert(request_box.hasValue(),"BOX DOES NOT EXIST"),
            request_len := BoxLen(request_key_hash),
            is_history.set(False),
            If(request_len.value()).Then(is_history.decode(App.box_extract(request_key_hash, Int(abi.size_of(ProposalsEntry)) - Int(abi.size_of(abi.Bool)), Int(abi.size_of(abi.Bool))))),
            SmartAssert(Not(is_history.get()), "REQUEST_ALREADY_COMPLETED"),
            current_request_info.decode(request_box.value()),
            current_request_info.request_status.store_into(status_abi),
            current_request_info.request_id.store_into(request_abi),
            current_request_info.voting_contract.store_into(app_abi),
            current_request_info.request_round.store_into(round_abi),
            current_request_info.total_stake.store_into(total_stake_abi),
            current_request_info.key_hash.store_into(key_hash),
            current_request_info.requester_algo_fee.store_into(requester_algo_fee_abi),
            current_request_info.total_votes.store_into(total_votes_abi),
            current_request_info.total_votes_refunded.store_into(total_votes_refunded_abi)
        ])

    @Subroutine(TealType.none)
    def init_total_stake_array(total_stake):
        zero_int = abi.Uint64()
        
        return Seq([
            round_abi.set(Global.round()),
            zero_int.set(Int(0)),
            total_stake_abi.set(total_stake),
            historical_stake_abi.set(zero_int,zero_int),
            current_stake_abi.set(round_abi,total_stake_abi),
            stake_history_abi.decode(Concat(
                historical_stake_abi.encode(),
                current_stake_abi.encode()
            ))
        ])

    handle_optin = Seq([
        (request_abi := abi.make(abi.StaticBytes[L[32]])).set(BYTES_0_STRING),
        (empty_bytes := abi.make(hash_type)).set(BYTES_0_STRING),
        round_abi.set(Global.round()),
        (zero_64 := abi.Uint64()).set(0),
        (zero_8 := abi.Uint8()).set(0),
        (false := abi.Bool()).set(False),
        (empty_request_info_abi := abi.make(RequestInfo))
        .set(empty_bytes,zero_64,round_abi,zero_8,zero_64,empty_bytes,false,zero_64,zero_64,zero_64),
        App.localPut(Txn.sender(), local_keys["account_token_amount"], Int(0)),
        App.localPut(Txn.sender(), local_keys["account_algo"], Int(0)),
        App.localPut(Txn.sender(), local_keys["locked_tokens"], Int(0)),
        App.localPut(Txn.sender(), local_keys["local_public_key"], Global.zero_address()),
        App.localPut(Txn.sender(), local_keys["local_public_key_timestamp"], Int(0)),
        App.localPut(Txn.sender(), local_keys["request_info"], empty_request_info_abi.encode()),
        init_total_stake_array(App.globalGet(local_keys["local_stake_array"])),
        App.localPut(Txn.sender(), local_keys["local_stake_array"],stake_history_abi.encode()),
        App.localPut(Txn.sender(),local_keys["update_stake_timeout"],Global.round()),
        Approve()
    ])

    handle_closeout = Err()

    handle_creation = Seq([
        App.globalPut(global_keys["algo_fee_sink"], Int(0)),
        App.globalPut(global_keys["token_fee_sink"], Int(0)),
        App.globalPut(global_keys["contract_version"], CONTRACT_VERSION_BYTES),
        init_total_stake_array(App.globalGet(global_keys["total_stake_array"])),
        App.globalPut(global_keys["total_stake_array"],stake_history_abi.encode()),
        App.globalPut(global_keys["refund_request_made_percentage"], Int(100)),
        App.globalPut(global_keys["refund_processing_percentage"], Int(10)),
        App.globalPut(global_keys["algo_request_fee"], Int(int(10_000))),
        App.globalPut(global_keys["gora_request_fee"], Int(int(1_000_000))),
        App.globalPut(global_keys["voting_threshold"], Int(66)),
        App.globalPut(global_keys["time_lock"], Int(10)),
        App.globalPut(global_keys["vote_refill_threshold"], Int(10)),
        App.globalPut(global_keys["vote_refill_amount"], Int(10000)),
        App.globalPut(global_keys["subscription_token_lock"], Int(10)),
        Approve()
    ])

    @Subroutine(TealType.none)
    def init(manager):
        contract_gora_balance = AssetHolding.balance(Global.current_application_address(),TOKEN_ASSET_ID_INT)

        return Seq([
            contract_gora_balance,
            If(contract_gora_balance.hasValue() == Int(1))
            .Then(Reject())
            .Else(
                Seq([
                    send_asset(TOKEN_ASSET_ID_INT, Global.current_application_address(), Int(0)),
                    App.globalPut(global_keys["manager_address"], manager),
                    Approve()
                ])
            )
        ])

    @Subroutine(TealType.none)
    def send_asset(asset_id,receiver,amount):
        return Seq([
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.AssetTransfer,
                TxnField.xfer_asset: asset_id,
                TxnField.asset_receiver: receiver,
                TxnField.asset_amount: amount
            }),
            InnerTxnBuilder.Submit()
        ])

    @Subroutine(TealType.none)
    def send_algo(receiver,amount):
        return Seq([
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.Payment,
                TxnField.receiver: receiver,
                TxnField.amount: amount
            }),
            InnerTxnBuilder.Submit()
        ])
    
    # fee_pool - cost_of_request * number_of_requests_until_threshold > threshold
    # where:
    # fee_pool = vote_refill_amount * min_txn_fee
    # cost_of_request = num_of_txns_for_request * min_txn_fee
    # threshold = vote_refill_threshold * min_txn_fee
    # => number_of_requests_until_threshold = (vote_refill_amount - vote_refill_threshold)
    # => x = 10,000 - 10 = 9990

    number_of_requests_until_threshold = App.globalGet(global_keys["vote_refill_amount"]) - App.globalGet(global_keys["vote_refill_threshold"])
    vote_refill_fund_fee = Seq(
        If(App.globalGet(global_keys["vote_refill_amount"]) < App.globalGet(global_keys["vote_refill_threshold"])).
        Then(
            Int(0) # TODO: not sure how we want to handle this.
        ).
        Else(
            App.globalGet(global_keys["vote_refill_amount"])*Global.min_txn_fee() / number_of_requests_until_threshold
        )
    )

    @Subroutine(TealType.none)
    def request(request, destination, type, key, app_refs, asset_refs, account_refs, box_refs):
        account_algo = App.localGet(Txn.sender(), local_keys["account_algo"])
        account_token_amount = App.localGet(Txn.sender(), local_keys["account_token_amount"])
        algo_fee_sink_balance = App.globalGet(global_keys["algo_fee_sink"])
        token_fee_sink_balance = App.globalGet(global_keys["token_fee_sink"])
        app_refs_length = Len(app_refs) / Int(8)
        asset_refs_length = Len(asset_refs) / Int(8)
        account_refs_length = Len(account_refs) / Int(32)
        box_refs_length = If(Len(box_refs) > Int(0)).Then(Btoi(Extract(box_refs, Int(0), Int(2)))).Else(Int(0))
        total_refs_length = (app_refs_length + asset_refs_length + account_refs_length + box_refs_length)
        total_cost_of_request = App.globalGet(global_keys["algo_request_fee"]) + calc_box_cost(abi.size_of(hash_type),abi.size_of(RequestInfo))

        return Seq([
            # check length of refs
            Assert(total_refs_length <= Int(4)),
            request_abi.set(Txn.tx_id()),
            app_abi.set(0),
            round_abi.set(Global.round()),
            requester_algo_fee_abi.set(App.globalGet(global_keys["algo_request_fee"])),
            total_votes_abi.set(0),
            total_votes_refunded_abi.set(0),
            status_abi.set(request_status["request_made"]),
            stake_history_abi.decode(App.globalGet(global_keys["total_stake_array"])),
            stake_history_abi[1].store_into(current_stake_abi),
            current_stake_abi.round.store_into(stake_round_abi),
            If(stake_round_abi.get() < Global.round())
            .Then(
                current_stake_abi.total_stake.store_into(total_stake_abi)
            ).ElseIf(stake_round_abi.get() == Global.round())
            .Then(
                Seq([
                    stake_history_abi[0].store_into(historical_stake_abi),
                    historical_stake_abi.total_stake.store_into(total_stake_abi)
                ])
            ).Else(
                Err()
            ),

            (new_key_hash := abi.make(hash_type)).set(Sha512_256(Concat(Txn.sender(), key))),
            is_history.set(False),
            current_request_info.set(
                request_abi,
                app_abi,
                round_abi,
                status_abi,
                total_stake_abi,
                new_key_hash,
                is_history,
                requester_algo_fee_abi,
                total_votes_abi,
                total_votes_refunded_abi
            ),
            SmartAssert(account_algo >= total_cost_of_request, "NOT ENOUGH ALGO"), # TODO: do we even need to assert this since the amount would result in negative if not enough or maybe its for the nr?
            SmartAssert(account_token_amount >= App.globalGet(global_keys["gora_request_fee"])),
            App.localPut(Txn.sender(), local_keys["account_algo"], account_algo - total_cost_of_request),
            App.localPut(Txn.sender(), local_keys["account_token_amount"], account_token_amount - App.globalGet(global_keys["gora_request_fee"])),
            App.globalPut(global_keys["algo_fee_sink"], algo_fee_sink_balance + (App.globalGet(global_keys["algo_request_fee"]) - vote_refill_fund_fee)),
            App.globalPut(global_keys["token_fee_sink"], token_fee_sink_balance + App.globalGet(global_keys["gora_request_fee"])),
            Assert(App.box_create(new_key_hash.get(), Int(abi.size_of(RequestInfo)))),
            App.box_put(new_key_hash.get(), current_request_info.encode()),
        ])

    @Subroutine(TealType.none)
    def refund_request_box(requester):
        return Seq([
            App.localPut(
                requester,
                local_keys["account_algo"],
                App.localGet(requester, local_keys["account_algo"]) + calc_box_cost(abi.size_of(hash_type),abi.size_of(RequestInfo))
            ),
            Pop(App.box_delete(key_hash.get()))
        ])

    @Subroutine(TealType.none)
    def refund_request(requester, request_key_hash):
        account_algo = App.localGet(Txn.sender(), local_keys["account_algo"])
        account_token = App.localGet(Txn.sender(), local_keys["account_token_amount"])
        algo_fee_sink_balance = App.globalGet(global_keys["algo_fee_sink"])
        token_fee_sink_balance = App.globalGet(global_keys["token_fee_sink"])

        def refund(currency_key):
            return ((App.globalGet(global_keys["refund_request_made_percentage"]) * App.globalGet(currency_key)) / Int(100))

        return Seq([
            populate_request_info_tmps(request_key_hash),
            Assert(Or(status_abi.get() == request_status["request_made"], status_abi.get() == request_status["processing"])),
            Assert(
                And(
                    Txn.type_enum()==TxnType.ApplicationCall,
                    Txn.application_id()==App.id(),
                    Txn.sender() == requester,
                    Txn.rekey_to()==Global.zero_address(),
                    Txn.lease()==Global.zero_address(),
                    Add(round_abi.get(), App.globalGet(global_keys["time_lock"])) < Global.round(), # request timeout
                )
            ),
            If(status_abi.get() == request_status["request_made"])
            .Then(Seq([
                App.localPut(Txn.sender(), local_keys["account_algo"], account_algo + refund(global_keys["algo_request_fee"])),
                App.localPut(Txn.sender(), local_keys["account_token_amount"], account_token + refund(global_keys["gora_request_fee"])),
                App.globalPut(global_keys["algo_fee_sink"], algo_fee_sink_balance - (refund(global_keys["algo_request_fee"]) - vote_refill_fund_fee)),
                App.globalPut(global_keys["token_fee_sink"], token_fee_sink_balance - refund(global_keys["gora_request_fee"])),
                refund_request_box(requester)
            ]))
            .ElseIf(status_abi.get() == request_status["processing"])
            .Then(Seq([
                App.localPut(
                    Txn.sender(),
                    local_keys["account_token_amount"],
                    account_token + refund(global_keys["gora_request_fee"])
                ),
                App.globalPut(global_keys["token_fee_sink"], token_fee_sink_balance - refund(global_keys["gora_request_fee"])),
                status_abi.set(request_status["refunded"]),
                App.box_replace(key_hash.get(),Int(48),status_abi.encode())
            ]))
        ])

    @Subroutine(TealType.none)
    def update_request_status(voting_app, request_key_hash, status, requester, proposal_bytes):
        sender_creator = AppParam.creator(voting_app)
        sender_address = AppParam.address(voting_app)
        request_info_app = AppParam.address(app_abi.get())
        
        update_request_box = Seq([
            Assert(App.box_create(key_hash.get(),Int(abi.size_of(ProposalsEntry)))),
            App.box_put(key_hash.get(), proposal_bytes)
        ])

        return Seq([
            populate_request_info_tmps(request_key_hash),
            SmartAssert(key_hash.get() == request_key_hash, "UNEXPECTED_VALUE"),
            sender_address,
            sender_creator,
            SmartAssert(status_abi.get() != request_status["completed"], "REQUEST_ALREADY_COMPLETED"),
            SmartAssert(status_abi.get() != request_status["refund_available"], "REQUEST_ALREADY_COMPLETED"),
            SmartAssert(Txn.type_enum()==TxnType.ApplicationCall),
            SmartAssert(Txn.application_id()==App.id()),
            SmartAssert(Txn.rekey_to()==Global.zero_address()),
            SmartAssert(Txn.lease()==Global.zero_address()),
            SmartAssert(sender_creator.hasValue()),
            SmartAssert(sender_address.hasValue()),
            SmartAssert(sender_address.value() == Global.caller_app_address()),
            SmartAssert(sender_creator.value() == Global.current_application_address()),

            #next code block assures that the request hasn't already been picked up
            (status_passed_in := abi.Uint8()).set(status),
            If(status_passed_in.get() == request_status["processing"]).
                Then(
                    #we just try to make a reference to the app that the request is currently being voted on, this gives the NR an error message to point them to the right app.
                    request_info_app,
                ),
            
            app_abi.set(voting_app),
            status_abi.set(status),
            
            If(
                status_abi.get() == request_status["completed"],
            )
            .Then(Seq([
                    refund_request_box(requester),
                    update_request_box
                ])
            ).ElseIf(status_abi.get() == request_status["refund_available"])
            .Then(
                Seq([
                    Pop(Int(1)) # TODO process refund automatically, this might be too difficult to do V1
                ])
            ).Else(
                Seq([
                    is_history.set(False),
                    current_request_info.set(
                        request_abi,
                        app_abi,
                        round_abi,
                        status_abi,
                        total_stake_abi,
                        key_hash,
                        is_history,
                        requester_algo_fee_abi,
                        total_votes_abi,
                        total_votes_refunded_abi
                    ),
                    App.box_put(key_hash.get(), current_request_info.encode()),
                    Log(Concat(Bytes("base16", "0x151f7c75"), current_request_info.encode()))
                ])
            ),
        ])

    @Subroutine(TealType.none)
    def subscribe(request,destination,subscription, type):
        locked_token = App.localGet(Txn.sender(), local_keys["locked_tokens"])
        account_token_amount = App.localGet(Txn.sender(), local_keys["account_token_amount"])

        return Seq([
            Assert(account_token_amount - App.globalGet(global_keys["subscription_token_lock"])),
            App.localPut(Txn.sender(), local_keys["account_token_amount"], account_token_amount - App.globalGet(global_keys["subscription_token_lock"])),
            App.localPut(Txn.sender(), local_keys["locked_tokens"], locked_token + App.globalGet(global_keys["subscription_token_lock"]))
        ])
    
    @Subroutine(TealType.bytes)
    def update_stake(total_stake_array,stake):
        return Seq([
            (start_index:= abi.Uint64()).set(Int(0)),
            stake_history_abi.decode(total_stake_array),
            stake_history_abi[Int(1)].store_into(current_stake_abi),
            current_stake_abi.round.store_into(stake_round_abi),
            If(stake_round_abi.get() < Global.round())
            .Then(
                Seq([
                    start_index.set(Int(16))
                ])
            ).ElseIf(stake_round_abi.get() > Global.round())
            .Then(
                Err()
            ),
            current_stake_abi.total_stake.store_into(total_stake_abi),
            stake_round_abi.set(Global.round()),
            # State=1 means stake, 0 means unstake
            If(stake == Int(1))
                .Then(
                    # add the new stake amount to the total stake
                    total_stake_abi.set(total_stake_abi.get() + new_stake_amount_abi.get())
                )
                .ElseIf(stake == Int(0)) # aka unstake
                .Then(
                    # subtract the new stake amount from the total stake
                    total_stake_abi.set(total_stake_abi.get() - new_stake_amount_abi.get())
                ),
            current_stake_abi.set(
                stake_round_abi,
                total_stake_abi
            ),
            
            Return(Concat(
                Extract(total_stake_array,start_index.get(),Int(16)),
                current_stake_abi.encode()
            ))
        ])

    @Subroutine(TealType.none)
    def stake():
        xfer_txn = Gtxn[Txn.group_index() - Int(1)]
        current_stake = Btoi(Extract(App.localGet(Txn.sender(),local_keys["local_stake_array"]), Int(24), Int(8)))

        return Seq([
            Assert(
                And(
                    CheckTimeLock(App.localGet(Txn.sender(),local_keys["update_stake_timeout"]) < Global.round()),
                    xfer_txn.type_enum()==TxnType.AssetTransfer,
                    xfer_txn.asset_receiver()==Global.current_application_address(),
                    xfer_txn.xfer_asset()==TOKEN_ASSET_ID_INT,
                    xfer_txn.asset_amount()>Int(0),
                    xfer_txn.asset_amount() + current_stake >= MINIMUM_STAKE_INT,
                    xfer_txn.asset_sender()==Global.zero_address(),
                    xfer_txn.close_remainder_to()==Global.zero_address(),
                    xfer_txn.rekey_to()==Global.zero_address(),
                    xfer_txn.lease()==Global.zero_address(),
                    xfer_txn.asset_close_to()==Global.zero_address()
                )
            ),
            new_stake_amount_abi.set(xfer_txn.asset_amount()),
            App.localPut(
                Txn.sender(),
                local_keys["local_stake_array"],
                update_stake(
                    App.localGet(Txn.sender(),local_keys["local_stake_array"]),
                    Int(1)
                )
            ),
            App.localPut(Txn.sender(),local_keys["update_stake_timeout"], Global.round() + App.globalGet(global_keys["time_lock"])),
            App.globalPut(
                global_keys["total_stake_array"],
                update_stake(
                    App.globalGet(global_keys["total_stake_array"]),
                    Int(1)
                )
            )
        ])

    @Subroutine(TealType.none)
    def unstake(unstake_amount):
        current_stake = Btoi(Extract(App.localGet(Txn.sender(),local_keys["local_stake_array"]), Int(24), Int(8)))
        return Seq([
            Assert(
                Or(
                    current_stake - unstake_amount >= MINIMUM_STAKE_INT,
                    current_stake - unstake_amount == Int(0)
                )
            ),
            Assert(CheckTimeLock(App.localGet(Txn.sender(),local_keys["update_stake_timeout"]) < Global.round())),
            new_stake_amount_abi.set(unstake_amount),
            App.localPut(
                Txn.sender(),
                local_keys["local_stake_array"],
                update_stake(
                    App.localGet(Txn.sender(),local_keys["local_stake_array"]),
                    Int(0)
                )
            ),
            App.localPut(Txn.sender(),local_keys["update_stake_timeout"],Global.round() + App.globalGet(global_keys["time_lock"])),
            App.globalPut(
                global_keys["total_stake_array"],
                update_stake(
                    App.globalGet(global_keys["total_stake_array"]),
                    Int(0)
                )
            ),
            send_asset(TOKEN_ASSET_ID_INT, Txn.sender(), unstake_amount)
        ])

    @Subroutine(TealType.none)
    def deposit():
        deposit_txn = Gtxn[Txn.group_index() - Int(1)]

        #asset
        deposit_account_asset = Txn.accounts[Btoi(Txn.application_args[2])]
        asset_deposited = Gtxn[Txn.group_index() - Int(1)].asset_amount()
        current_account_asset = App.localGet(deposit_account_asset, local_keys["account_token_amount"])
        new_local_asset_amount = current_account_asset + asset_deposited

        #algo
        deposit_account_algo = Txn.accounts[Btoi(Txn.application_args[1])]
        algo_deposited = Gtxn[Txn.group_index() - Int(1)].amount()
        current_account_algo = App.localGet(deposit_account_algo, local_keys["account_algo"])
        new_account_algo = current_account_algo + algo_deposited

        return Seq([
            If(Txn.assets.length() > Int(0)).Then(Seq([
                Assert(
                    And(
                        deposit_txn.type_enum()==TxnType.AssetTransfer,
                        deposit_txn.asset_receiver()==Global.current_application_address(),
                        deposit_txn.xfer_asset()==TOKEN_ASSET_ID_INT,
                        deposit_txn.asset_amount()>Int(0),
                        deposit_txn.asset_sender()==Global.zero_address(),
                        deposit_txn.close_remainder_to()==Global.zero_address(),
                        deposit_txn.rekey_to()==Global.zero_address(),
                        deposit_txn.lease()==Global.zero_address(),
                        deposit_txn.asset_close_to()==Global.zero_address()
                    )
                ),
                App.localPut(
                    deposit_account_asset,
                    local_keys["account_token_amount"],
                    new_local_asset_amount
                )
            ])).Else(Seq([
                Assert(
                    And(
                        deposit_txn.type_enum()==TxnType.Payment,
                        deposit_txn.receiver()==Global.current_application_address(),
                        deposit_txn.amount()>Int(0),
                        deposit_txn.close_remainder_to()==Global.zero_address(),
                        deposit_txn.rekey_to()==Global.zero_address(),
                        deposit_txn.lease()==Global.zero_address()
                    )
                ),
                App.localPut(
                    deposit_account_algo,
                    local_keys["account_algo"],
                    new_account_algo
                )
            ]))
        ])

    @Subroutine(TealType.none)
    def register_key(new_public_key):
        stored_timestamp = App.localGet(
            Txn.sender(),
            local_keys["local_public_key_timestamp"]
        )
        store_public_key = App.localPut(
            Txn.sender(),
            local_keys["local_public_key"],
            new_public_key
        )
        store_new_timestamp = App.localPut(
            Txn.sender(),
            local_keys["local_public_key_timestamp"],
            Global.round()
        )

        return If(
            Or(
                Global.round() >= Add(stored_timestamp, App.globalGet(global_keys["time_lock"])),
                stored_timestamp == Int(0)
            )
        ).Then(
            Seq([
                store_public_key,
                store_new_timestamp
            ])
        ).Else(
            Reject()
        )

    @Subroutine(TealType.none)
    def withdraw(withdraw_amount):
        #asset
        current_account_asset = App.localGet(Txn.sender(), local_keys["account_token_amount"])
        new_local_asset_amount = current_account_asset - withdraw_amount

        #algo
        current_account_algo = App.localGet(Txn.sender(), local_keys["account_algo"])
        new_account_algo = current_account_algo - withdraw_amount

        return Seq([
            # Assertion below is used in NR unit test named "Blockchain apps".
            # If line nubmer changes, the test must be adjusted.
            SmartAssert(withdraw_amount > Int(0), "INVALID_AMOUNT"),

            If(Txn.assets.length() > Int(0)).Then(Seq([
                App.localPut(
                    Txn.sender(),
                    local_keys["account_token_amount"],
                    new_local_asset_amount
                ),
                send_asset(TOKEN_ASSET_ID_INT, Txn.sender(), withdraw_amount)
            ])).Else(Seq([
                App.localPut(
                    Txn.sender(),
                    local_keys["account_algo"],
                    new_account_algo
                ),
                send_algo(Txn.sender(), withdraw_amount)
            ])),
        ])

    vote_approval_program = Bytes("base64",VOTE_APPROVAL_PROGRAM) # Python conversion from base64 to Byte[] then to Bytes()
    vote_clear_program = Bytes("base64",VOTE_CLEAR_PROGRAM)

    @Subroutine(TealType.none)
    def update_rewards(rewards_account:Expr,previous_vote_bytes:Expr,previous_vote_requester:Expr):
        completed_request_hash = abi.make(hash_type)
        previous_vote_info_local_hash = abi.make(hash_type)
        completed_request_stake_count = abi.make(abi.Uint64)
        pending_rewards_points = ScratchVar(TealType.uint64)
        algo_rewards_to_pay = ScratchVar(TealType.uint64)
        token_rewards_to_pay = ScratchVar(TealType.uint64)
        completed_request_rewards_payed = abi.make(abi.Uint64)
        completed_request_vote_count = abi.make(abi.Uint64)
        completed_request_vote_round = abi.make(abi.Uint64)
        completed_request_requester = abi.make(abi.Address)
        previous_is_history = abi.make(abi.Bool)

        validate_previous_vote = Seq([
            (previous_vote_info_local := LocalHistoryEntry()).decode(previous_vote_bytes),
            previous_vote_info_local.key_hash.store_into(key_hash),
            (previous_proposal_entry := ProposalsEntry()).set(previous_vote_info_local.proposal_entry),
            previous_proposal_entry.vote_hash.store_into(previous_vote_info_local_hash),
            previous_proposal_entry.stake_count.store_into((history_local_stake := abi.Uint64())),
            previous_proposal_entry.is_history.store_into(previous_is_history),
            previous_proposal_entry.vote_count.store_into(vote_count := abi.Uint64()),
            (completed_request_len := BoxLen(key_hash.get())),
            
            previous_is_history.set(False),
            If(completed_request_len.value()).Then(previous_is_history.decode(App.box_extract(key_hash.get(), Int(abi.size_of(ProposalsEntry)) - Int(abi.size_of(abi.Bool)), Int(abi.size_of(abi.Bool))))),
            If(previous_is_history.get())
            .Then(Seq([
                (get_completed_request_info := App.box_get(key_hash.get())),
                (completed_request_info := ProposalsEntry()).decode(get_completed_request_info.value()),
                completed_request_info.vote_hash.store_into(completed_request_hash),
                completed_request_info.vote_count.store_into(completed_request_vote_count),
                completed_request_info.stake_count.store_into(completed_request_stake_count),
                completed_request_info.rewards_payed_out.store_into(completed_request_rewards_payed),
                completed_request_info.vote_round.store_into(completed_request_vote_round),
                completed_request_info.requester.store_into(completed_request_requester),
                (is_previous_history := abi.Bool()).set(completed_request_info.is_history),

                (empty_bytes := abi.make(hash_type)).set(BYTES_0_STRING),
                If(
                    And(
                        completed_request_hash.get() == previous_vote_info_local_hash.get(),
                        completed_request_hash.get() != empty_bytes.get()
                    )
                )
                .Then(
                    pending_rewards_points.store((vote_count.get() * Int(100)) / completed_request_vote_count.get()),
                    completed_request_rewards_payed.set(completed_request_rewards_payed.get() + history_local_stake.get()),
                    If(completed_request_rewards_payed.get() == completed_request_stake_count.get()).
                        Then(
                            Seq([
                                Pop(App.box_delete(key_hash.get())),
                                App.localPut(completed_request_requester.get(), local_keys["account_algo"], App.localGet(completed_request_requester.get(), local_keys["account_algo"]) + calc_box_cost(abi.size_of(hash_type),abi.size_of(RequestInfo)))
                            ])
                        ).
                    Else(Seq([
                        completed_request_info.set(completed_request_hash, completed_request_vote_count, completed_request_stake_count, completed_request_vote_round, completed_request_rewards_payed, completed_request_requester, is_previous_history),
                        App.box_put(key_hash.get(), completed_request_info.encode())
                    ])),
                ).Else(
                    pending_rewards_points.store(Int(0))
                )
            ])).Else(
                pending_rewards_points.store(Int(0))
            ),
            If(And(
                completed_request_len.value(),
                previous_is_history.get() == Int(0)
            ))
            .Then(
                populate_request_info_tmps(key_hash.get()),
                If(And(
                    Add(round_abi.get(), App.globalGet(global_keys["time_lock"])) < Global.round(), # request timeout
                    Or(
                        status_abi.get() == request_status["refunded"],
                        status_abi.get() == request_status["processing"]
                    ),
                    Or(
                        total_votes_refunded_abi.get() <= total_votes_abi.get(),
                        requester_algo_fee_abi.get() >= Int(0)
                    )
                ))
                .Then(
                    previous_proposal_entry.vote_count.store_into(vote_count := abi.make(abi.Uint64)),
                    If(requester_algo_fee_abi.get() >= Int(2)*Global.min_txn_fee())
                    .Then(
                        App.localPut(
                            rewards_account, local_keys["account_algo"], 
                            App.localGet(rewards_account, local_keys["account_algo"]) 
                            + Int(2)*Global.min_txn_fee()
                        ),
                        requester_algo_fee_abi.set(requester_algo_fee_abi.get()-Int(2)*Global.min_txn_fee()),
                    ).Else(
                        App.localPut(
                            rewards_account, local_keys["account_algo"], 
                            App.localGet(rewards_account, local_keys["account_algo"]) 
                            + requester_algo_fee_abi.get()
                        ),
                        requester_algo_fee_abi.set(0)
                    ),
                    total_votes_refunded_abi.set(total_votes_refunded_abi.get() + vote_count.get()),
                    App.box_replace(
                        key_hash.get(),
                        Int(abi.size_of(RequestInfo) - 3 * abi.size_of(abi.Uint64)),
                        Concat(
                            requester_algo_fee_abi.encode(),
                            total_votes_abi.encode(),
                            total_votes_refunded_abi.encode()
                        )
                    ),
                    If(And(
                        status_abi.get() == request_status["refunded"],
                        Or(
                            total_votes_refunded_abi.get() >= total_votes_abi.get(),
                            requester_algo_fee_abi.get() == Int(0)
                        )
                    ))
                    .Then(
                        previous_proposal_entry.requester.store_into(requester := abi.make(abi.Address)),
                        Assert(requester.get() == previous_vote_requester),
                        refund_request_box(previous_vote_requester),
                        App.localPut(
                            previous_vote_requester,
                            local_keys["account_algo"],
                            App.localGet(previous_vote_requester, local_keys["account_algo"]) + requester_algo_fee_abi.get()
                        )
                    )
                )
            )
        ])

        return Seq([
            validate_previous_vote,
            #credit token rewards
            token_rewards_to_pay.store(pending_rewards_points.load() * (App.globalGet(global_keys["gora_request_fee"]) / Int(100))),
            App.localPut(
                rewards_account, local_keys["account_token_amount"], 
                App.localGet(rewards_account, local_keys["account_token_amount"]) 
                + token_rewards_to_pay.load()
            ),
            #credit algo rewards
            algo_rewards_to_pay.store(pending_rewards_points.load() * (App.globalGet(global_keys["algo_request_fee"]) / Int(100))),
            App.localPut(
                rewards_account, local_keys["account_algo"], 
                App.localGet(rewards_account, local_keys["account_algo"]) 
                + algo_rewards_to_pay.load()
            )
        ])

    @Subroutine(TealType.none)
    def update_request_vote_tally():
        vote_txn = Gtxn[Txn.group_index()+Int(1)]
        vote_count = Btoi(vote_txn.application_args[13])
        request_key_hash = Txn.application_args[8]

        return Seq([
            populate_request_info_tmps(request_key_hash),
            total_votes_abi.set(total_votes_abi.get() + vote_count),
            current_request_info.set(
                request_abi,
                app_abi,
                round_abi,
                status_abi,
                total_stake_abi,
                key_hash,
                is_history,
                requester_algo_fee_abi,
                total_votes_abi,
                total_votes_refunded_abi
            ),
            App.box_put(request_key_hash,current_request_info.encode())
        ])

    @Subroutine(TealType.none)
    def claim_rewards_from_vote():
        vote_txn = Gtxn[Txn.group_index()+Int(1)]
        account = vote_txn.accounts[Btoi(vote_txn.application_args[10])]
        
        contract_address = AppParam.address(vote_txn.application_id())
        contract_creator = AppParam.creator(vote_txn.application_id())
        contract_balance = Seq([
            Balance(contract_address.value()) - MinBalance(contract_address.value())
        ])

        get_remaining_executions = contract_balance / (App.globalGet(global_keys["vote_refill_threshold"]) * Global.min_txn_fee())

        return Seq([
            contract_creator,
            contract_address,
            Assert(contract_address.value() == Txn.accounts[Btoi(Txn.application_args[6])]),
            Assert(contract_creator.value() == Global.current_application_address()),
            update_rewards(account,Txn.application_args[9],Txn.accounts[Btoi(Txn.application_args[10])]),
            If(get_remaining_executions == Int(0))
                .Then(send_algo(contract_address.value(), (Global.min_txn_fee() * App.globalGet(global_keys["vote_refill_amount"]) - Global.min_txn_fee()))), # -1 because this inner txn cost a txn fee
            update_request_vote_tally()
        ])
        
    @Subroutine(TealType.none)
    def validate_reset_previous_vote_txn():
        claim_rewards_txn = Gtxn[Txn.group_index()+Int(1)]
        contract_creator = AppParam.creator(claim_rewards_txn.application_id())

        return Seq([
            contract_creator,
            Assert(And(
                contract_creator.value() == Global.current_application_address(),
                claim_rewards_txn.type_enum()==TxnType.ApplicationCall,
                claim_rewards_txn.on_completion() == OnComplete.NoOp,
                claim_rewards_txn.application_args[0] == MethodSignature(get_method_signature("reset_previous_vote","voting")),
            ))
        ])

    @Subroutine(TealType.none)
    def claim_rewards(
        rewards_address,
        previous_vote,
        previous_vote_requester
    ):
        return Seq([
            validate_reset_previous_vote_txn(),
            If(App.optedIn(rewards_address,Global.current_application_id()))
            .Then(
                update_rewards(
                    rewards_address,
                    previous_vote,
                    previous_vote_requester
                )
            ).Else(
                update_rewards(
                    Txn.sender(),
                    previous_vote,
                    previous_vote_requester
                )
            ),
            
        ])

    @Subroutine(TealType.none)
    def deploy_voting_contract():
        deployed_contract_id = ScratchVar(TealType.uint64)
        deployed_contract_address = AppParam.address(deployed_contract_id.load())
        return Seq([
            Assert(Txn.sender()==App.globalGet(global_keys["manager_address"])),
            Assert(Txn.fee()==Global.min_txn_fee()*Int(3)),
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.ApplicationCall,
                TxnField.on_completion: OnComplete.NoOp,
                TxnField.approval_program: vote_approval_program,
                TxnField.clear_state_program: vote_clear_program,
                TxnField.application_args:[Itob(Global.current_application_id())],
                TxnField.global_num_byte_slices: Int(34),
                TxnField.global_num_uints: Int(30),
                # TODO: update vote contract to not allow opt in  / don't deploy it with local state spaces.
                TxnField.local_num_byte_slices: Int(2),
                TxnField.local_num_uints: Int(3),
                TxnField.extra_program_pages: Int(1)
            }),
            InnerTxnBuilder.Submit(),
            deployed_contract_id.store(InnerTxn.created_application_id()),
            Log(Itob(InnerTxn.created_application_id())),
            Log(Itob(deployed_contract_id.load())),
            deployed_contract_address,
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.Payment,
                TxnField.amount: MinBalance(deployed_contract_address.value()) + App.globalGet(global_keys["vote_refill_amount"]) * Global.min_txn_fee(),
                TxnField.fee: Int(0),
                TxnField.receiver: deployed_contract_address.value()
            }),
            InnerTxnBuilder.Submit(),
            Approve()
        ])
    
    @Subroutine(TealType.none)
    def update_protocol_settings(
        manager,
        refund_request_made_percentage,
        refund_processing_percentage,
        algo_request_fee,
        gora_request_fee,
        voting_threshold,
        time_lock,
        vote_refill_threshold,
        vote_refill_amount,
        subscription_token_lock
    ):
        return Seq([
            Assert(Txn.sender() == App.globalGet(global_keys["manager_address"])),
            App.globalPut(global_keys["manager_address"], manager),
            App.globalPut(global_keys["refund_request_made_percentage"], refund_request_made_percentage),
            App.globalPut(global_keys["refund_processing_percentage"], refund_processing_percentage),
            App.globalPut(global_keys["algo_request_fee"], algo_request_fee),
            App.globalPut(global_keys["gora_request_fee"], gora_request_fee),
            App.globalPut(global_keys["voting_threshold"], voting_threshold),
            App.globalPut(global_keys["time_lock"], time_lock),
            App.globalPut(global_keys["vote_refill_threshold"], vote_refill_threshold),
            App.globalPut(global_keys["vote_refill_amount"], vote_refill_amount),
            App.globalPut(global_keys["subscription_token_lock"], subscription_token_lock),
        ])

    init_selector = MethodSignature(get_method_signature("init","main"))
    update_protocol_settings_selector = MethodSignature(get_method_signature("update_protocol_settings","main"))
    register_key_selector = MethodSignature("register_participation_account(address)void")
    unregister_key_selector = MethodSignature("unregister_participation_account()void")
    request_selector = MethodSignature(get_method_signature("request","main"))
    subscribe_selector = MethodSignature("subscribe(byte[],byte[],byte[],uint64)void")

    stake_selector = MethodSignature("stake(axfer)void")
    unstake_selector = MethodSignature("unstake(uint64,asset)void")

    deposit_token_selector = MethodSignature("deposit_token(axfer,asset,account)void")
    deposit_algo_selector = MethodSignature("deposit_algo(pay,account)void")
    withdraw_token_selector = MethodSignature("withdraw_token(uint64,asset)void")
    withdraw_algo_selector = MethodSignature("withdraw_algo(uint64)void")

    claim_rewards_selector = MethodSignature(get_method_signature("claim_rewards","main"))
    claim_rewards_from_vote_selector = MethodSignature(get_method_signature("claim_rewards_vote_verify","main"))

    heartbeat_selector = MethodSignature("heartbeat(byte[4],uint16,uint32)void")

    deploy_voting_contract_selector = MethodSignature("deploy_voting_contract()void")

    refund_request_selector = MethodSignature(get_method_signature("refund_request","main"))
    update_request_status_selector = MethodSignature(get_method_signature("update_request_status","main"))

    selector = Txn.application_args[0]
    handle_noop = Cond(
        [
            selector == init_selector,
            Seq([
                init(Txn.application_args[2]),
                Approve()
            ])
        ],
        [
            selector == update_protocol_settings_selector,
            Seq([
                update_protocol_settings(
                    Txn.application_args[1],
                    Btoi(Txn.application_args[2]),
                    Btoi(Txn.application_args[3]),
                    Btoi(Txn.application_args[4]),
                    Btoi(Txn.application_args[5]),
                    Btoi(Txn.application_args[6]),
                    Btoi(Txn.application_args[7]),
                    Btoi(Txn.application_args[8]),
                    Btoi(Txn.application_args[9]),
                    Btoi(Txn.application_args[10]),
                ),
                Approve()
            ])
        ],
        [
            selector == request_selector,
            Seq([
                request(
                  Txn.application_args[1],
                  Txn.application_args[2],
                  Txn.application_args[3],
                  Extract(Txn.application_args[4], Int(2), Len(Txn.application_args[4]) - Int(2)),
                  Txn.application_args[5],
                  Txn.application_args[6],
                  Txn.application_args[7],
                  Txn.application_args[8],
                ),
                Approve()
            ])
        ],
        [
            selector == subscribe_selector,
            Seq([
                subscribe(
                  Txn.application_args[1],
                  Txn.application_args[2],
                  Txn.application_args[3],
                  Txn.application_args[4]
                ),
                Approve()
            ])
        ],
        [
            selector == register_key_selector,
            Seq([
                register_key(
                    Txn.application_args[1] #public key
                ),
                Approve()
            ]),
        ],
        [
            selector == unregister_key_selector,
            Seq([
                App.localPut(
                    Txn.sender(),
                    local_keys["local_public_key"],
                    Global.zero_address()
                ),
                App.localPut(
                    Txn.sender(),
                    local_keys["local_public_key_timestamp"],
                    Global.round()
                ),
                Approve()
            ]),
        ],
        [
            selector == stake_selector,
            Seq([
                stake(),
                Approve()
            ])
        ],
        [
            selector == unstake_selector,
            Seq([
                unstake(Btoi(Txn.application_args[1])),
                Approve()
            ])
        ],
        [
            Or(
                selector == deposit_token_selector,
                selector == deposit_algo_selector
            ),
            Seq([
                deposit(),
                Approve()
            ])
        ],
        [
            Or(
                selector == withdraw_token_selector,
                selector == withdraw_algo_selector
            ),
            Seq([
                withdraw(Btoi(Txn.application_args[1])),
                Approve()
            ])
        ],
        [
            selector == claim_rewards_selector,
            Seq([
                claim_rewards(
                    Txn.accounts[Btoi(Txn.application_args[1])], # rewards_address
                    Txn.application_args[2], # previous_vote
                    Txn.accounts[Btoi(Txn.application_args[3])] # previous_vote_requester
                ),
                Approve()
            ])
        ],
        [
            selector == heartbeat_selector,
            Seq([
                Approve()
            ])
        ],
        [
            selector == deploy_voting_contract_selector,
            Seq([
                deploy_voting_contract(),
                Approve()
            ])
        ],
        [
            selector == refund_request_selector,
            Seq([
                refund_request(
                    Txn.accounts[Btoi(Txn.application_args[1])], # requester
                    Txn.application_args[2]
                ),
                Approve()
            ])
        ],
        [
            selector == update_request_status_selector,
            Seq([
                update_request_status(
                    Txn.applications[Btoi(Txn.application_args[1])], # voting_app_address
                    Txn.application_args[2], # request_key_hash for box reference
                    Btoi(Txn.application_args[3]), # status
                    Txn.accounts[1],
                    Txn.application_args[5]
                ),
                Approve()
            ])
        ],
        [
            selector == claim_rewards_from_vote_selector,
            Seq([
                claim_rewards_from_vote(),
                Approve()
            ])
        ]
    )

    program = Cond(
        [Txn.application_id() == Int(0), handle_creation],
        [Txn.on_completion() == OnComplete.NoOp, handle_noop],
        [Txn.on_completion() == OnComplete.OptIn, handle_optin],
        [Txn.on_completion() == OnComplete.CloseOut, handle_closeout],
        [Txn.on_completion() == OnComplete.UpdateApplication, CheckUpdateMode()],
        [Txn.on_completion() == OnComplete.DeleteApplication, CheckUpdateMode()]
    )
    return program

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    print(compileTeal(approval_program(**params), Mode.Application, version = 8))
