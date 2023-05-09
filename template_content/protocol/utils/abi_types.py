from pyteal import *
from algosdk import abi as algosdkAbi
from typing import Literal as L

class StakeHistoryTuple(abi.NamedTuple):
    round: abi.Field[abi.Uint64]
    total_stake: abi.Field[abi.Uint64]

StakeHistoryTupleAlgoSDK = algosdkAbi.TupleType([
        algosdkAbi.UintType(64), # round
        algosdkAbi.UintType(64), # total_stake
    ])

class BoxRef(abi.NamedTuple):
    name: abi.Field[abi.DynamicBytes]
    app_id: abi.Field[abi.Uint64]

class ResponseBody(abi.NamedTuple):
    request_id: abi.Field[abi.StaticBytes[L[32]]]
    requester_address: abi.Field[abi.Address]
    oracle_return_value: abi.Field[abi.DynamicArray[abi.Byte]]
    user_data: abi.Field[abi.DynamicArray[abi.Byte]]
    error_code: abi.Field[abi.Uint32]
    source_failures: abi.Field[abi.Uint64]

class RequestInfo(abi.NamedTuple):
    request_id: abi.Field[abi.StaticBytes[L[32]]]
    voting_contract: abi.Field[abi.Uint64]
    request_round: abi.Field[abi.Uint64]
    request_status: abi.Field[abi.Uint8]
    total_stake: abi.Field[abi.Uint64]
    key_hash: abi.Field[abi.StaticBytes[L[32]]] # sha512_256(Concat(<Request Sender>, <Key>))
    # is_history must be the same index as in ProposalsEntry
    is_history: abi.Field[abi.Bool] 
    requester_algo_fee: abi.Field[abi.Uint64]
    total_votes: abi.Field[abi.Uint64]
    total_votes_refunded: abi.Field[abi.Uint64]

class ProposalsEntry(abi.NamedTuple):
    vote_hash: abi.Field[abi.StaticBytes[L[32]]]
    vote_count: abi.Field[abi.Uint64]
    stake_count: abi.Field[abi.Uint64]
    vote_round: abi.Field[abi.Uint64]
    rewards_payed_out: abi.Field[abi.Uint64]
    requester: abi.Field[abi.Address]
    # is_history must be the same index as in RequestInfo
    is_history: abi.Field[abi.Bool]

class LocalHistoryEntry(abi.NamedTuple):
    key_hash: abi.Field[abi.StaticBytes[L[32]]] # sha512_256(Concat(<Request Sender>, <Key>))
    proposal_entry: abi.Field[ProposalsEntry]

class SourceSpec(abi.NamedTuple):
    source_id: abi.Field[abi.Uint32]
    source_arg_list: abi.Field[abi.DynamicBytes]
    max_age: abi.Field[abi.Uint64]

class RequestSpec(abi.NamedTuple):
    source_specs: abi.Field[abi.DynamicArray[SourceSpec]]
    aggregation: abi.Field[abi.Uint32]
    user_data: abi.Field[abi.DynamicBytes]

class DestinationSpec(abi.NamedTuple):
    destination_id: abi.Field[abi.Uint64]
    destination_method: abi.Field[abi.DynamicBytes]
