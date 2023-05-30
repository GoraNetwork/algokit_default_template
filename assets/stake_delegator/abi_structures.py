from pyteal import *
from algosdk import abi as algosdkAbi

class VestingTracker(abi.NamedTuple):
    vested_amount: abi.Field[abi.Uint64]
    vesting_app_id: abi.Field[abi.Uint64]

VestingTrackerAlgoSdk = algosdkAbi.TupleType([
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
    ])

class RewardsTracker(abi.NamedTuple):
    algo_rewards: abi.Field[abi.Uint64]
    gora_rewards: abi.Field[abi.Uint64]
    algo_non_stake: abi.Field[abi.Uint64]
    gora_non_stake: abi.Field[abi.Uint64]

RewardsTrackerAlgoSdk = algosdkAbi.TupleType([
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
    ])

class Aggregation(abi.NamedTuple):
    execution_time: abi.Field[abi.Uint64] # execution round number
    rewards_this_round: abi.Field[RewardsTracker]

AggregationAlgoSdk = algosdkAbi.TupleType([
        algosdkAbi.UintType(64),
        RewardsTrackerAlgoSdk,
    ])

class LocalAggregationTracker(abi.NamedTuple):
    most_recent_round: abi.Field[Aggregation] # Most recent aggregation round when this update happend
    amount: abi.Field[abi.Uint64] # amount the user has withdrawn/deposited
    is_stake: abi.Field[abi.Bool]

LocalAggregationTrackerAlgoSdk = algosdkAbi.TupleType([
        AggregationAlgoSdk,
        algosdkAbi.UintType(64),
        algosdkAbi.BoolType()
    ])

class TimeoutTracker(abi.NamedTuple):
    aggregation_round: abi.Field[abi.Uint64] # current_aggregation_round
    aggregation_round_start: abi.Field[abi.Uint64] # Algorand start round
    goracle_timeout: abi.Field[abi.Uint64] # the goracle timeout

TimeoutTrackerAlgoSdk = algosdkAbi.TupleType([
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64)
    ])