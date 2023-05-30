import {
  ABIBoolType,
  ABITupleType, 
  ABIUintType,
} from "algosdk";

export const VestingTracker = new ABITupleType([
  new ABIUintType(64), // vested amount
  new ABIUintType(64), // vesting app id
]);

export const RewardsTracker = new ABITupleType([
  new ABIUintType(64), // algo_rewards
  new ABIUintType(64), // gora_rewards
  new ABIUintType(64), // algo_nonstake
  new ABIUintType(64), // gora_nonstake
]);

export const Aggregation = new ABITupleType([
  new ABIUintType(64), // execution time
  RewardsTracker, // rewards_this_round
]);

export const LocalAggregationTracker = new ABITupleType([
  Aggregation, // aggregation round
  new ABIUintType(64), // amount the user has withdrawn/deposited
  new ABIBoolType(), // is_staking
]);

export const TimeoutTracker = new ABITupleType([
  new ABIUintType(64), // current aggregation round
  new ABIUintType(64), // algorand start round
  new ABIUintType(64), // goracle timeout
]);