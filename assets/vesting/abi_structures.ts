import {
  ABIAddressType,
  ABIArrayStaticType,
  ABIBoolType,
  ABIByteType,
  ABITupleType, 
  ABIUintType,
} from "algosdk";

export const VestingKey = new ABITupleType([
  new ABIAddressType, // user address
  new ABIArrayStaticType(new ABIByteType(), 32), // hash of Concat(asset_id, vester_address, vester_key)
]);

export const VestingEntry = new ABITupleType([
  new ABIUintType(64), // start time
  new ABIUintType(64), // unlock time
  new ABIUintType(64), // token id
  new ABIUintType(64), // amount
  new ABIUintType(64), // amount claimed
  new ABIAddressType(), // vester
  new ABIBoolType(), // staked flag
]);