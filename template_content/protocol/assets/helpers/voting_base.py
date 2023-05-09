from pyteal import *
from .key_map import key_map
import sys
import pathlib
import os
from voting_approval import hash_type
sys.path.append(os.path.join(pathlib.Path(__file__).parent.resolve(),'../..'))
from utils.abi_types import LocalHistoryEntry,ProposalsEntry
from utils.gora_pyteal_utils import calc_box_cost,SmartAssert
global_keys = key_map["voting_global"]
main_local_keys = key_map["main_local"]

def on_clear_logic():
    MAIN_APP = App.globalGet(global_keys["main_app"])
    current_round = App.globalGet(global_keys["round"])
    local_stake_account_pk = App.localGetEx(Txn.accounts[1], MAIN_APP, main_local_keys["local_public_key"])

    return Seq([
        local_stake_account_pk,
        SmartAssert(local_stake_account_pk.value() == Txn.sender()),
        (previous_vote_bytes := App.box_get(Txn.accounts[1])),
        previous_vote_bytes,
        (previous_vote := LocalHistoryEntry()).decode(previous_vote_bytes.value()),
        (previous_proposal_entry := ProposalsEntry()).set(previous_vote.proposal_entry),
        (sender_vote_round := abi.Uint64()).set(previous_proposal_entry.vote_round),
        (sender_vote_hash := abi.make(hash_type)).set(previous_proposal_entry.vote_hash),
        If(sender_vote_round.get() == current_round)
        .Then(
            Approve()
        )
        .ElseIf(
            sender_vote_round.get() < current_round
        )
        .Then(
            Seq([
                InnerTxnBuilder.Begin(),
                InnerTxnBuilder.SetFields({
                    TxnField.type_enum: TxnType.Payment,
                    TxnField.receiver: Txn.sender(),
                    TxnField.amount: calc_box_cost(abi.size_of(hash_type),abi.size_of(ProposalsEntry))
                }),
                InnerTxnBuilder.Submit(),
                App.box_delete(sender_vote_hash.get())
                # TODO: do we want to delete their previous vote box here too?
            ])
        ),
        Approve()
    ])