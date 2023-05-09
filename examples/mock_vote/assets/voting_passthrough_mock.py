import os
import pathlib
import sys
import yaml
from pyteal import *
from typing import Literal as L
from helpers.key_map import key_map
sys.path.append(os.path.join(pathlib.Path(__file__).parent.resolve(),"../../.."))
from utils.abi_types import ResponseBody

global_keys = key_map["voting_global"]
local_keys = key_map["voting_local"]

"""
Constants
"""
RESPONSE_TYPE_TYPE = abi.Uint32
RESPONSE_BODY_TYPE = ResponseBody

MAX_PROPOSALS = Int(16)
MAX_HISTORY = Int(10)
empty_proposal = Bytes("")

"""
Routing
"""
vote_selector = MethodSignature("vote(application,byte[],account,uint32,byte[])void")

def approval_program(CONTRACT_VERSION):
    CONTRACT_VERSION_Bytes = Bytes(CONTRACT_VERSION)

    proposal_i = ScratchVar(TealType.uint64)
    history_i = ScratchVar(TealType.uint64)
    init_history = Seq([
        For(history_i.store(Int(0)), history_i.load() < MAX_HISTORY, history_i.store(history_i.load() + Int(1)))
        .Do(
            App.globalPut(
                Concat(global_keys["history_key_prefix"], Itob(history_i.load())),
                #<uint: tally> <uint: round number> <bytes: proposal>
                Concat(Itob(Int(0)), Itob(Int(0)), empty_proposal)
            )
        )
    ])

    """
    check if votes on proposal meet threshold for committing and proceeding to next round
    """
    request_address = abi.Address()
    respose_type_out = RESPONSE_TYPE_TYPE()
    @Subroutine(TealType.none)
    def after_vote( requester_account, 
                    destination_sig, 
                    response_type: Expr, 
                    response_body: RESPONSE_BODY_TYPE):

        return Seq([
                    response_body.requester_address.store_into(request_address),
                    respose_type_out.set(response_type),
                    #execute request
                    InnerTxnBuilder.Begin(),
                    InnerTxnBuilder.SetFields({
                        TxnField.type_enum: TxnType.ApplicationCall,
                        TxnField.on_completion: OnComplete.NoOp,
                        TxnField.application_args: [
                            destination_sig, # method selector
                            respose_type_out.encode(),
                            Txn.application_args[5],
                        ], 
                        TxnField.accounts: [requester_account], # requester address 
                        TxnField.application_id: Txn.applications[1],
                    }),
                    InnerTxnBuilder.Submit(),
                ])

    empty_vote = Concat(Itob(Int(0)), Itob(Int(0)), Itob(Int(0)), Bytes("a"))
    
    on_optin = Seq([
        #previous weight consists of <int: previous_vote_weight>, <int: history pointer> <int: previous_vote_round>, <byte[32]: previous_vote_hash>
        App.localPut(Txn.sender(), local_keys["previous_vote_key"], empty_vote),
        App.localPut(Txn.sender(), local_keys["reward_points_key"], Int(0)),
        Approve()
    ])

    init_votes = Seq([
        For(proposal_i.store(Int(0)), proposal_i.load() < MAX_PROPOSALS, proposal_i.store(proposal_i.load() + Int(1)))
        .Do(
            App.globalPut(
                Concat(global_keys["proposal_key_prefix"], Itob(proposal_i.load())),
                empty_proposal
            )
        )
    ])
    
    on_creation = Seq([
        # App.globalPut(global_keys["main_app_key"], Btoi(Txn.application_args[0])),
        App.globalPut(global_keys["creator_key"], Txn.sender()),
        # App.globalPut(global_keys["round_key"], Int(0)),
        # App.globalPut(global_keys["history_buffer_pointer_key"], Int(0)),
        # App.globalPut(global_keys["contract_address_key"], Global.current_application_address()),
        # App.globalPut(global_keys["contract_version_key"], CONTRACT_VERSION_Bytes),
        # init_history,
        # init_votes,
        Approve()
    ])

    is_creator = Txn.sender() == App.globalGet(global_keys["creator_key"])

    on_closeout = Approve()

    @Subroutine(TealType.none)
    def vote(
            destination_sig: Expr,
            requester_account: Expr,
            response_type: Expr,
            response_body: RESPONSE_BODY_TYPE,
        ):
        # parse destination
        # parse payload by getting first 2 bytes for length, then iterate through each payload and send as appArg
        return Seq([
            after_vote(requester_account, destination_sig, response_type, response_body),
        ])

    selector = Txn.application_args[0]
    """
    Vote Args
    """
    destination_app_arg = Txn.application_args[1]
    destination_method_arg = Txn.application_args[2]
    requester_account_arg = Txn.application_args[3]

    response_type_arg = abi.make(RESPONSE_TYPE_TYPE)
    response_body_arg = abi.make(RESPONSE_BODY_TYPE)
    response_body_wrapper = abi.make(abi.DynamicBytes)
    
    on_noop = Cond(
        [
            selector == vote_selector,
            Seq([
                Assert(is_creator),
                #TODO: decide exactly what to concat into block hash
                #concat block to be vote(data), request_round, destination appid, destination method, requester
                response_type_arg.decode(Txn.application_args[4]),
                response_body_wrapper.decode(Txn.application_args[5]),
                response_body_arg.decode(response_body_wrapper.get()),
                vote(
                    Substring(destination_method_arg,
                        Int(2),
                        Len(destination_method_arg)
                    ),
                    Txn.accounts[Btoi(requester_account_arg)],
                    response_type_arg.get(),
                    response_body_arg
                ), #substrings used to get rid of ABI encoding
                Approve()
            ])
        ],
    )

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(is_creator)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(is_creator)],
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
    ), Mode.Application, version = 7, optimize=optimize_options))