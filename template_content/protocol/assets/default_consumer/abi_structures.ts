import { ABIArrayDynamicType, ABIByteType, ABITupleType, ABIUintType } from "algosdk";

export const PriceBoxTuple = new ABITupleType([
  new ABIUintType(64), // price
  new ABIUintType(64) // timestamp
]);

export const BoxType = new ABITupleType([
  new ABIArrayDynamicType(new ABIByteType), // key
  new ABIUintType(64) // app_id
]);

export const userVoteType = new ABITupleType([
  PriceBoxTuple, // price_box
  new ABIArrayDynamicType(new ABIByteType), // box_name
]);