import sys
import os
import json
import pathlib
import yaml
import base64
from pyteal import *
from helpers.voting_base import *
from helpers.key_map import key_map
from typing import Literal as L

sys.path.append(os.path.join(pathlib.Path(__file__).parent.resolve(),".."))
from utils.gora_pyteal_utils import get_method_signature, SmartAssert, calc_box_cost
from utils.abi_types import RequestInfo, StakeHistoryTuple, LocalHistoryEntry, ProposalsEntry, ResponseBody

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

def CheckUpdateMode():
    is_creator = If(Txn.sender() == Global.creator_address()).Then(Approve()).Else(Reject())
    if GetEnv("GORACLE_DEV_ALLOW_UPDATES"):
       return Approve()
    else:
        return is_creator

def LogDev(data):
    if GetEnv("GORACLE_DEV_SC_LOG_LEVEL"):
        return Log(data)
    else:
        return Seq()

hash_type = abi.StaticBytes[L[32]]
vote_hash_abi = abi.make(hash_type)
request_type = abi.StaticBytes[L[32]]
request_abi = abi.make(request_type)
current_request_info = abi.make(RequestInfo)
request_key_hash = abi.make(hash_type)
app_abi = abi.make(abi.Uint64)
round_abi = abi.make(abi.Uint64)
status_abi = abi.make(abi.Uint8)
total_stake_abi = abi.make(abi.Uint64)
local_stake_abi = abi.make(abi.Uint64)
stake_history_abi = abi.make(abi.StaticArray[StakeHistoryTuple,L[2]])
current_stake_abi = abi.make(StakeHistoryTuple)
historical_stake_abi = abi.make(StakeHistoryTuple)
stake_round_abi = abi.make(abi.Uint64)
proposal_entry_abi = abi.make(ProposalsEntry)
vote_count_abi = abi.make(abi.Uint64)
stake_count_abi = abi.make(abi.Uint64)
requester_algo_fee_abi = abi.make(abi.Uint64)
total_votes_abi = abi.make(abi.Uint64)

global_keys = key_map["voting_global"]
main_local_keys = key_map["main_local"]
main_global_keys = key_map["main_global"]
request_status = key_map["request_status"]

"""
Constants
"""

MAX_PROPOSALS = Int(16)
BYTES_0_STRING = bytes("0"*32, "utf-8")
MAX_BOX_SIZE = 5120

"""
Routing
"""
vote_selector = MethodSignature(get_method_signature("vote","voting"))
register_voter_selector = MethodSignature(get_method_signature("register_voter","voting"))
deregister_voter_selector = MethodSignature(get_method_signature("deregister_voter","voting"))
delete_box_selector = MethodSignature(get_method_signature("delete_box","voting"))
reset_previous_vote_selector = MethodSignature(get_method_signature("reset_previous_vote","voting"))

def approval_program(CONTRACT_VERSION, VOTE_VERIFY_LSIG_ADDRESS, DEV_MODE=False):
    CONTRACT_VERSION_BYTES = Bytes(CONTRACT_VERSION)
    MAIN_APP = App.globalGet(global_keys["main_app"])
    VOTE_VERIFY_LSIG_ADDRESS = Addr(VOTE_VERIFY_LSIG_ADDRESS)
    vote_verify_txn = Gtxn[Txn.group_index()-Int(1)]
    @Subroutine(TealType.anytype)
    def get_primary_account(primary_account_arg_index:Expr):
        local_stake_account_pk = App.localGetEx(Txn.accounts[Btoi(Txn.application_args[primary_account_arg_index])], MAIN_APP, main_local_keys["local_public_key"])

        return Seq([
            local_stake_account_pk,
            SmartAssert(local_stake_account_pk.value() == Txn.sender()),
            Return(Txn.accounts[Btoi(Txn.application_args[primary_account_arg_index])])
        ])

    @Subroutine(TealType.none)
    def get_local_stake(request_round:abi.Uint64):
        local_stake_array = App.localGetEx(get_primary_account(Int(7)), MAIN_APP, main_local_keys["local_stake_array"])
        return Seq([
            local_stake_array,
            stake_history_abi.decode(local_stake_array.value()),
            stake_history_abi[1].store_into(current_stake_abi),
            current_stake_abi.round.store_into(stake_round_abi),
            If(stake_round_abi.get() < request_round.get())
            .Then(
                current_stake_abi.total_stake.store_into(local_stake_abi)
            ).ElseIf(stake_round_abi.get() == request_round.get())
            .Then(
                Seq([
                    stake_history_abi[0].store_into(historical_stake_abi),
                    historical_stake_abi.total_stake.store_into(local_stake_abi)
                ])
            ).Else(
                SmartAssert(Int(0) == Int(1))
            )
        ])

    @Subroutine(TealType.bytes)
    def update_request_status(
        new_status,
        key_hash,
        requester,
        proposal_bytes
    ):
        return Seq([
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.MethodCall(
                app_id=MAIN_APP,
                method_signature=get_method_signature("update_request_status","main"),
                args=[
                    App.id(),
                    key_hash,
                    Itob(new_status),
                    requester,
                    proposal_bytes
                ]
            ),
            InnerTxnBuilder.Submit(),
            If(new_status == request_status["processing"])
            .Then(
                Return(Extract(InnerTxn.last_log(), Int(4), Len(InnerTxn.last_log()) - Int(4)))
            )
            .Else(
                Return(Bytes(""))
            )
        ])

    @Subroutine(TealType.none)
    def validate_register_payment_txn():
        payment_txn = Gtxn[Txn.group_index() - Int(1)]
        return Seq([
            SmartAssert(payment_txn.sender()==Txn.sender()),
            SmartAssert(payment_txn.type_enum()==TxnType.Payment),
            SmartAssert(payment_txn.receiver()==Global.current_application_address()),
            SmartAssert(payment_txn.amount()==calc_box_cost(abi.size_of(hash_type), abi.size_of(ProposalsEntry)) + calc_box_cost(32, abi.size_of(LocalHistoryEntry))),
            SmartAssert(payment_txn.close_remainder_to()==Global.zero_address()),
            SmartAssert(payment_txn.rekey_to()==Global.zero_address()),
            SmartAssert(payment_txn.lease()==Global.zero_address())
        ])

    @Subroutine(TealType.none)
    def set_empty_local_history_entry(primary_account_index):
        return Seq([
            (zero := abi.Uint64()).set(0),
            (empty_bytes := abi.make(hash_type)).set(BYTES_0_STRING),
            (zero_address := abi.make(abi.Address)).set(Global.zero_address()),
            (false := abi.Bool()).set(False),
            (empty_proposal_entry := ProposalsEntry()).set(empty_bytes,zero,zero,zero,zero,zero_address,false),
            (empty_vote := LocalHistoryEntry()).set(empty_bytes,empty_proposal_entry),
            App.box_put(get_primary_account(primary_account_index), empty_vote.encode()),
        ])

    @Subroutine(TealType.none)
    def register_voter():
        return Seq([
            validate_register_payment_txn(),
            SmartAssert(App.box_create(get_primary_account(Int(1)),Int(abi.size_of(LocalHistoryEntry))) == Int(1)),
            set_empty_local_history_entry(Int(1)),
        ])

    @Subroutine(TealType.none)
    def deregister_voter():
        proposal_exists = ScratchVar(TealType.uint64)
        return Seq([
            SmartAssert(Txn.fee()==Global.min_txn_fee()*Int(2)),
            previous_vote_bytes := App.box_get(get_primary_account(Int(1))),
            SmartAssert(previous_vote_bytes.hasValue()),
            (previous_vote := abi.make(LocalHistoryEntry)).decode(previous_vote_bytes.value()),
            previous_vote.proposal_entry.store_into(proposal_entry := abi.make(ProposalsEntry)),
            proposal_entry.vote_round.store_into(vote_round := abi.make(abi.Uint64)),
            proposal_entry.vote_hash.store_into(vote_hash := abi.make(hash_type)),
            SmartAssert(vote_round.get() < App.globalGet(global_keys["round"]),"VOTE ROUND STILL ACTIVE"),
            SmartAssert(App.box_delete(get_primary_account(Int(1))) == Int(1)),
            proposal_exists.store(App.box_delete(vote_hash.get())),
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.Payment,
                TxnField.amount: (
                    calc_box_cost(
                        abi.size_of(hash_type),
                        abi.size_of(ProposalsEntry)
                    )*proposal_exists.load() + 
                    calc_box_cost(
                        32,
                        abi.size_of(LocalHistoryEntry)
                    )
                ),
                TxnField.fee: Int(0),
                TxnField.receiver: get_primary_account(Int(1))
            }),
            InnerTxnBuilder.Submit(),
            Approve()
        ])

    on_optin = Reject()

    @Subroutine(TealType.none)
    def validate_claim_rewards_txn(account):
        claim_rewards_txn = Gtxn[Txn.group_index()-Int(1)]

        return Seq([
            (previous_vote := App.box_get(account)),
            SmartAssert(claim_rewards_txn.type_enum() == TxnType.ApplicationCall),
            SmartAssert(claim_rewards_txn.on_completion() == OnComplete.NoOp),
            SmartAssert(claim_rewards_txn.application_id() == MAIN_APP),
            SmartAssert(claim_rewards_txn.application_args[0] == MethodSignature(get_method_signature("claim_rewards","main"))),
            SmartAssert(claim_rewards_txn.application_args[2] == previous_vote.value()),
        ])

    @Subroutine(TealType.none)
    def process_history_bytes(account):
        return Seq([
            validate_claim_rewards_txn(account),
            (local_history_bytes := App.box_get(account)),
            (box_length := BoxLen(account)),
            SmartAssert(local_history_bytes.hasValue()),
            SmartAssert(box_length.value() == Int(abi.size_of(LocalHistoryEntry))),
            (local_history := LocalHistoryEntry()).decode(local_history_bytes.value()),
            (previous_vote := ProposalsEntry()).set(local_history.proposal_entry),
            (previous_vote_round := abi.Uint64()).set(previous_vote.vote_round),
            (vote_round := abi.Uint64()).set(App.globalGet(global_keys["round"])),
            SmartAssert(previous_vote_round.get() < vote_round.get())
        ])

    @Subroutine(TealType.none)
    def reset_previous_vote(rewards_address):
        return Seq([
            process_history_bytes(rewards_address),
            If(App.optedIn(rewards_address,MAIN_APP))
            .Then(
                Seq([
                    (zero := abi.Uint64()).set(0),
                    (empty_bytes := abi.make(hash_type)).set(BYTES_0_STRING),
                    (zero_address := abi.make(abi.Address)).set(Global.zero_address()),
                    (false := abi.Bool()).set(False),
                    (empty_proposal_entry := ProposalsEntry()).set(empty_bytes,zero,zero,zero,zero,zero_address,false),
                    (empty_vote := LocalHistoryEntry()).set(empty_bytes,empty_proposal_entry),
                    App.box_put(rewards_address, empty_vote.encode()),
                ])
            ).Else(
                Seq([
                    SmartAssert(App.box_delete(rewards_address)),
                    If(calc_box_cost(32,abi.size_of(LocalHistoryEntry)) >= Global.min_txn_fee()) # TODO: probably want to be at least equal to, to allow deleting boxes no matter what.
                    .Then(
                        InnerTxnBuilder.Begin(),
                        InnerTxnBuilder.SetFields({
                            TxnField.type_enum: TxnType.Payment,
                            TxnField.amount: (
                                calc_box_cost(
                                    32,
                                    abi.size_of(LocalHistoryEntry)
                                ) -
                                Global.min_txn_fee()
                            ),
                            TxnField.fee: Global.min_txn_fee(), # TODO: I think this one is fine since we don't want to punish people for resetting vote boxes to clean up
                            TxnField.receiver: rewards_address
                        }),
                        InnerTxnBuilder.Submit(),
                    )
                ])
            )
        ])

    on_creation = Seq([
        App.globalPut(global_keys["main_app"], Btoi(Txn.application_args[0])),
        App.globalPut(global_keys["creator"], Txn.sender()),
        App.globalPut(global_keys["round"], Int(0)),
        App.globalPut(global_keys["contract_version"], CONTRACT_VERSION_BYTES),
        (zero_64 := abi.Uint64()).set(0),
        (zero_8 := abi.Uint8()).set(0),
        (empty_bytes := abi.make(hash_type)).set(BYTES_0_STRING),
        (false := abi.Bool()).set(False),
        (empty_request_info_abi := abi.make(RequestInfo))
        .set(empty_bytes,zero_64,zero_64,zero_8,zero_64,empty_bytes,false,zero_64,zero_64,zero_64),
        # initialize an empty request
        App.globalPut(global_keys["current_request_info"], empty_request_info_abi.encode()),
        Approve()
    ])

    on_closeout = on_clear_logic()

    @Subroutine(TealType.uint64)
    def validate_vote_verify_txn(vrf_result, vrf_proof, vote_round):
        vote_verify_txn = Gtxn[Txn.group_index()-Int(1)]

        return Seq([
            (sender_previous_vote := App.box_get(get_primary_account(Int(7)))),
            And(
                sender_previous_vote.value() == vote_verify_txn.application_args[9],
                vote_verify_txn.type_enum()==TxnType.ApplicationCall,
                vote_verify_txn.on_completion() == OnComplete.NoOp,
                vote_verify_txn.sender() == VOTE_VERIFY_LSIG_ADDRESS,
                vote_verify_txn.application_id() == MAIN_APP,
                vote_verify_txn.fee() == Int(0),
                vote_verify_txn.application_args[0] == MethodSignature(get_method_signature("claim_rewards_vote_verify","main")),
                vote_verify_txn.application_args[1] == vrf_result,
                vote_verify_txn.application_args[2] == vrf_proof,
                vote_verify_txn.application_args[3] == Block.seed(vote_round),
                vote_verify_txn.accounts[Btoi(vote_verify_txn.application_args[4])] == Txn.sender()
            )
        ])

    @Subroutine(TealType.uint64)
    def validate_vote_verify_txn_dev_mode(vrf_result, vrf_proof):
        vote_verify_txn = Gtxn[Txn.group_index()-Int(1)]

        return Seq([
            (sender_previous_vote := App.box_get(get_primary_account(Int(7)))),
            And(
                sender_previous_vote.value() == vote_verify_txn.application_args[9],
                vote_verify_txn.type_enum()==TxnType.ApplicationCall,
                vote_verify_txn.on_completion() == OnComplete.NoOp,
                vote_verify_txn.sender() == VOTE_VERIFY_LSIG_ADDRESS,
                vote_verify_txn.application_id() == MAIN_APP,
                vote_verify_txn.application_args[0] == MethodSignature(get_method_signature("claim_rewards_vote_verify","main")),
                vote_verify_txn.application_args[1] == vrf_result,
                vote_verify_txn.application_args[2] == vrf_proof,
                vote_verify_txn.application_args[3] == Txn.note(),
                vote_verify_txn.accounts[Btoi(vote_verify_txn.application_args[4])] == Txn.sender()
            )
        ])
    
    # load and concat table for vote count approximation
    table = []
    with open(os.path.dirname(os.path.abspath(__file__)) + "/helpers/z_table.json", "r") as f:
        table = json.load(f)
    table_size = len(table)
    table_bytes = b""
    for entry in table:
        table_bytes += base64.b64decode(entry)
    max_z = 7
    z_table_bytes = Bytes(table_bytes)
    uint64_half = Int(round((2 ** 64 - 1) / 2))

    @Subroutine(TealType.none)
    def verify_vote_count(vote_count_arg, vrf_result, z_index):
        # p = 0.001
        p = Int(1)
        # mean = n * p
        mean = (local_stake_abi.get() * p / Int(1000))
        # std = sqrt(mean * 1-p)
        std = Sqrt(mean * Int(999) / Int(1000))
        # verify z index matches vrf result
        # verify mean + z * std >= vote count
        z_table_entry = Extract(z_table_bytes, z_index * Int(8), Int(8))
        q = Btoi(Extract(vrf_result, Int(0), Int(8)))
        z = z_index * Int(100) / Int(table_size) * Int(max_z)
        adjusted_q = uint64_half + (uint64_half - q)
        # check entry is greater than or equal to hash ratio
        return Seq([
            If(q < uint64_half)
            # if q <0.5, z entry must be gte
            .Then(Seq([
                SmartAssert(adjusted_q >= Btoi(z_table_entry)),
                SmartAssert(vote_count_arg == mean - (z * std / Int(100)))
            ]))
            # if q >0.5, z entry must be lte
            .Else(Seq([
                SmartAssert(q <= Btoi(z_table_entry)),
                SmartAssert(vote_count_arg == mean + (z * std / Int(100)))
            ]))
        ])

    @Subroutine(TealType.none)
    def vote(
        vrf_result: Expr,
        vrf_proof: Expr,
        destination_app_id: Expr,
        destination_method_arg: Expr,
        requester_account: Expr,
        response_type_arg: Expr,
        response_body_arg: Expr,
        vote_count_arg: Expr,
        z_index: Expr,
        request_key_hash_arg: Expr
    ):
        passed_in_request_info = abi.make(RequestInfo)
        passed_in_ID = abi.make(request_type)
        current_request_info = abi.make(RequestInfo)
        response_body = abi.make(ResponseBody)
        response_body_wrapper = abi.make(abi.DynamicBytes)
        previous_vote_hash = abi.make(hash_type)

        previous_vote_info = Seq([
            (previous_vote := App.box_get(get_primary_account(Int(7)))),
            (previous_vote_info_local := LocalHistoryEntry()).decode(previous_vote.value()),
            (previous_vote_info_local.proposal_entry).store_into(previous_proposal_entry := ProposalsEntry()),
            previous_proposal_entry.vote_round.store_into((previous_vote_round := abi.Uint64())),
            previous_proposal_entry.vote_hash.store_into(previous_vote_hash),
            
            #this assert assures that the previous_vote passed to main contract is valid.
            SmartAssert(previous_vote.value() == vote_verify_txn.application_args[9],"PROVIDED PREVIOUS VOTE DOES NOT MATCH"),
        ])

        start_new_round = Seq([
            (zero := abi.Uint64()).set(0),
            (empty_bytes := abi.make(hash_type)).set(BYTES_0_STRING),
            (zero_address := abi.make(abi.Address)).set(Global.zero_address()),
            (false := abi.Bool()).set(False),
            (empty_proposal_entry := ProposalsEntry()).set(empty_bytes,zero,zero,zero,zero,zero_address,false),
            passed_in_request_info.decode(update_request_status(request_status["processing"], request_key_hash_arg, requester_account,empty_proposal_entry.encode())),
            App.globalPut(global_keys["round"], App.globalGet(global_keys["round"]) + Int(1)),
            App.globalPut(global_keys["current_request_info"], passed_in_request_info.encode()),
            passed_in_request_info.request_id.store_into(request_abi),
            passed_in_request_info.request_round.store_into(round_abi),
            passed_in_request_info.request_status.store_into(status_abi),
            passed_in_request_info.voting_contract.store_into(app_abi),
            passed_in_request_info.total_stake.store_into(total_stake_abi),
            passed_in_request_info.key_hash.store_into(request_key_hash),
            passed_in_request_info.requester_algo_fee.store_into(requester_algo_fee_abi),
            passed_in_request_info.total_votes.store_into(total_votes_abi)
        ])

        time_lock = App.globalGetEx(MAIN_APP, main_global_keys['time_lock'])
        get_time_lock = Seq([
            time_lock,
            time_lock.value()
        ])

        populate_request_info = Seq([
            current_request_info.decode(App.globalGet(global_keys["current_request_info"])),
            current_request_info.request_id.store_into(request_abi),
            response_body_wrapper.decode(response_body_arg),
            response_body.decode(response_body_wrapper.get()),
            # New request
            If(request_abi.get() == Bytes(BYTES_0_STRING))
            .Then(Seq([
                start_new_round
            ]))
            # Existing request
            .Else(Seq([
                current_request_info.request_round.store_into(round_abi),
                current_request_info.total_stake.store_into(total_stake_abi),
                response_body.request_id.store_into(passed_in_ID),
                
                #This happens in the case that the current request is expired and the user is trying to start a new round with a different request
                If(request_abi.get() != passed_in_ID.get())
                .Then(
                    Seq([
                        #Assert that the current request has expired because the voter is trying to propose a new request
                        SmartAssert(
                            CheckTimeLock(Global.round() >= round_abi.get() + get_time_lock),
                            "OTHER_REQUEST_IN_PROGRESS"
                        ),
                       start_new_round
                    ])
                )
                .Else(
                    #Since we have already retrieved the other fields, retrieve remaining fields
                    Seq([
                        current_request_info.request_status.store_into(status_abi),
                        current_request_info.voting_contract.store_into(app_abi),
                        current_request_info.key_hash.store_into(request_key_hash),
                        current_request_info.requester_algo_fee.store_into(requester_algo_fee_abi),
                        current_request_info.total_votes.store_into(total_votes_abi)
                    ])
                ),
            ])),
        ])

        validate_lease = Seq([
            SmartAssert(round_abi.get() < Txn.first_valid(),"INVALID FIRST ROUND"),
            SmartAssert(CheckTimeLock(round_abi.get() + get_time_lock == Txn.last_valid()),"INVALID LAST ROUND"),
            SmartAssert(Txn.lease() == request_abi.get(), "INCORRECT LEASE")
        ])

        is_valid_participant = Seq([
            # make sure voter is valid participant
            (stored_timestamp := App.localGetEx(get_primary_account(Int(7)), MAIN_APP,  main_local_keys["local_public_key_timestamp"])),
            SmartAssert(local_stake_abi.get() > Int(0), "VOTER_ZERO_STAKE"),
            SmartAssert(
                CheckTimeLock(
                    Global.round() >= Add(stored_timestamp.value(), get_time_lock)
                )
            )
        ])

        destination_sig = Extract(destination_method_arg,Int(2),Int(4))
        # concat block to be vote(data), destination appid, destination method, requester
        hash = Sha512_256(Concat(response_body_arg, Itob(destination_app_id), destination_sig, requester_account))

        process_incoming_vote_and_update_values = Seq([
            (incoming_block_hash := abi.make(hash_type)).set(hash),
            (vote_round := abi.Uint64()).set(App.globalGet(global_keys["round"])),
            SmartAssert(previous_vote_round.get() < vote_round.get()),
            Pop(App.box_delete(previous_vote_hash.get())),
            (vote_count_abi).set(vote_count_arg),
            (zero := abi.Uint64()).set(0),
            (requester_address := abi.make(abi.Address)).set(requester_account),
            (is_history := abi.Bool()).set(True),
            (previous_proposal_entry).set(
                incoming_block_hash,
                vote_count_abi,
                local_stake_abi,
                vote_round,
                zero,
                requester_address,
                is_history #its technically not history at this point, but this field doesn't get used until this gets used in the main contract
            ),
            (previous_vote_info_local).set(
                request_key_hash,
                previous_proposal_entry
            ),
            App.box_put(
                get_primary_account(Int(7)),
                previous_vote_info_local.encode()
            ),
            (zero := abi.Uint64()).set(0),
            # new proposal, create a new box and populate with incoming proposal
            If(App.box_create(incoming_block_hash.get(), Int(abi.size_of(ProposalsEntry))))
            .Then(
                Seq([
                    (requester_address := abi.make(abi.Address)).set(requester_account),
                    (is_history := abi.Bool()).set(True),
                    proposal_entry_abi.set(
                        incoming_block_hash,
                        vote_count_abi,
                        local_stake_abi,
                        vote_round,
                        zero,
                        requester_address,
                        is_history #its technically not history at this point, but this field doesn't get used until this gets used in the main contract.
                    ),
                    App.box_put(incoming_block_hash.get(),proposal_entry_abi.encode())
                ])
            )
            # existing proposal, retrieve and update values with incoming proposal values
            .Else(
                Seq([
                    (proposal_bytes := App.box_get(incoming_block_hash.get())),
                    SmartAssert(proposal_bytes.hasValue()),
                    proposal_entry_abi.decode(proposal_bytes.value()),
                    proposal_entry_abi.vote_hash.store_into(vote_hash_abi),
                    proposal_entry_abi.vote_count.store_into((current_vote_count := abi.Uint64())),
                    proposal_entry_abi.stake_count.store_into(stake_count_abi),
                    vote_count_abi.set(current_vote_count.get() + vote_count_abi.get()),
                    stake_count_abi.set(stake_count_abi.get() + local_stake_abi.get()),
                    (requester_address := abi.make(abi.Address)).set(requester_account),
                    (is_history := abi.Bool()).set(True),
                    proposal_entry_abi.set(
                        vote_hash_abi,
                        vote_count_abi,
                        stake_count_abi,
                        vote_round,
                        zero,
                        requester_address,
                        is_history #its technically not history at this point, but this field doesn't get used until this gets used in the main contract.
                    ),
                    App.box_put(incoming_block_hash.get(),proposal_entry_abi.encode())
                ])
            )
        ])

        process_request = Seq([
            #execute request
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.ApplicationCall,
                TxnField.on_completion: OnComplete.NoOp,
                TxnField.application_args: [
                    destination_sig, # method selector
                    response_type_arg,
                    response_body_arg,
                ],
                TxnField.applications: [Global.current_application_id()],
                TxnField.accounts: [requester_account], # requester address 
                TxnField.application_id: destination_app_id,
                TxnField.fee: Global.min_txn_fee()
            }),
            InnerTxnBuilder.Submit(),
            Pop(update_request_status(request_status["completed"], request_key_hash.get(), requester_account, proposal_entry_abi.encode())),
            (empty_bytes := abi.make(hash_type)).set(BYTES_0_STRING),
            (zero_64 := abi.Uint64()).set(0),
            (zero_8 := abi.Uint8()).set(0),
            (false := abi.Bool()).set(False),
            (empty_request_info_abi := abi.make(RequestInfo))
            .set(empty_bytes,zero_64,zero_64,zero_8,zero_64,empty_bytes,false,zero_64,zero_64,zero_64),
            App.globalPut(global_keys["current_request_info"], empty_request_info_abi.encode()) # complete round
        ])

        voting_threshold = App.globalGetEx(MAIN_APP, main_global_keys['voting_threshold'])
        get_voting_threshold = Seq([
            voting_threshold,
            voting_threshold.value()
        ])

        # parse destination
        # parse payload by getting first 2 bytes for length, then iterate through each payload and send as appArg

        validate_vote_verify = SmartAssert(validate_vote_verify_txn(vrf_result, vrf_proof, round_abi.get()))
        if DEV_MODE:
            validate_vote_verify = SmartAssert(validate_vote_verify_txn_dev_mode(vrf_result, vrf_proof))

        return Seq([
            previous_vote_info,
            populate_request_info,
            validate_lease,
            get_local_stake(round_abi),
            # check if passed vote count matches approximation
            verify_vote_count(vote_count_arg, vrf_result, z_index),
            is_valid_participant,
            # check that vrf result and proof matches result and proof passed into lsig
            # if network is >100,000, use dev mode validation which takes block seed from note field
            validate_vote_verify,
            process_incoming_vote_and_update_values,
            # Log tally and threshold.
            LogDev(Itob(vote_count_abi.get() * Int(100))),
            LogDev(Itob(get_voting_threshold * total_stake_abi.get() / Int(1000))),
            SmartAssert(total_stake_abi.get()),

            # check if vote tally is above threshold
            # since p = 0.001, divide total_stake by 1000 to get committee size
            If(vote_count_abi.get() * Int(100) >= (get_voting_threshold * total_stake_abi.get() / Int(1000)))
            .Then(
                process_request
            )
        ])

    @Subroutine(TealType.none)
    def delete_box(old_vote_hash:Expr):
        return Seq([
            (vote_round := abi.Uint64()).set(App.globalGet(global_keys["round"])),
            (vote_hash := abi.make(hash_type)).decode(old_vote_hash),
            (proposal_bytes := App.box_get(vote_hash.get())),
            SmartAssert(proposal_bytes.hasValue()),
            (box_length := BoxLen(vote_hash.get())),
            SmartAssert(box_length.value() == Int(abi.size_of(ProposalsEntry))),
            proposal_entry_abi.decode(proposal_bytes.value()),
            (previous_vote_round := abi.Uint64()).set(proposal_entry_abi.vote_round),
            SmartAssert(previous_vote_round.get() < vote_round.get()),
            Pop(App.box_delete(vote_hash.get())),
        ])

    selector = Txn.application_args[0]
    on_noop = Cond(
        [
            selector == vote_selector,
            Seq([
                
                vote(
                    Txn.application_args[1], # vrf_result_arg
                    Txn.application_args[2], # vrf_proof_arg
                    Txn.applications[Btoi(Txn.application_args[4])], # destination_app_arg
                    Txn.application_args[5], # destination_method_arg
                    Txn.accounts[Btoi(Txn.application_args[6])], # requester_account_arg
                    Txn.application_args[8], # response_type_arg
                    Txn.application_args[9], # response_body_arg
                    Btoi(Txn.application_args[10]), # vote count
                    Btoi(Txn.application_args[11]), # z index
                    vote_verify_txn.application_args[8] # request_key_hash
                ),
                Approve()
            ])
        ],
        [
            selector == delete_box_selector,
            Seq([
                delete_box(
                    Txn.application_args[1]
                ),
                Approve()
            ])
        ],
        [
            selector == reset_previous_vote_selector,
            Seq([
                reset_previous_vote(
                    Txn.accounts[Btoi(Txn.application_args[2])]
                ),
                Approve()
            ])
        ],
        [
            selector == register_voter_selector,
            Seq([
                register_voter(),
                Approve()
            ])
        ],
        [
            selector == deregister_voter_selector,
            Seq([
                deregister_voter(),
                Approve()
            ])
        ]
    )

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, CheckUpdateMode()],
        [Txn.on_completion() == OnComplete.UpdateApplication, CheckUpdateMode()],
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, on_optin],
        [Txn.on_completion() == OnComplete.NoOp, on_noop],
    )

    return program

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    optimize_options = OptimizeOptions(scratch_slots=True)
    print(compileTeal(approval_program(
        **params,
    ), Mode.Application, version = 8, optimize=optimize_options))