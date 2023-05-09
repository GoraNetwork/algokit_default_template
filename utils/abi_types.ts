import {
  ABIAddressType,
  ABIArrayDynamicType,
  ABIArrayStaticType,
  ABIBoolType,
  ABIByteType,
  ABITupleType,
  ABIType,
  ABIUintType
} from "algosdk";

export const RequestInfoType = new ABITupleType([
  new ABIArrayStaticType(new ABIByteType, 32), // request_id
  new ABIUintType(64), // voting_contract
  new ABIUintType(64), // request_round
  new ABIUintType(8), // request_status
  new ABIUintType(64), // total_stake
  new ABIArrayStaticType(new ABIByteType, 32), // sha512_256(Concat(<Request Sender>, <Key>))
  new ABIBoolType(), //is_history
  new ABIUintType(64), // requester_algo_fee
  new ABIUintType(64), // total_votes
  new ABIUintType(64), // total_votes_refunded

]);

export const ProposalsEntryType = new ABITupleType([
  new ABIArrayStaticType(new ABIByteType, 32),  // vote_hash
  new ABIUintType(64), // vote_count
  new ABIUintType(64), // stake_count
  new ABIUintType(64), // vote_round
  new ABIUintType(64), // rewards_payed_out
  new ABIAddressType(), // requester
  new ABIBoolType(), //is_history
]);

export const LocalHistoryType = new ABITupleType([
  new ABIArrayStaticType(new ABIByteType, 32),  // key_hash
  ProposalsEntryType // proposal_entry
]);

export const StakeTupleType = new ABITupleType([
  new ABIUintType(64), // round
  new ABIUintType(64) // total_stake
]);

export const BoxReference = new ABITupleType([
  new ABIArrayDynamicType(new ABIByteType), // name
  new ABIUintType(64) //app_id
]);

export const BoxReferenceList = new ABIArrayDynamicType(BoxReference);

export const StakeArrayType = new ABIArrayStaticType(StakeTupleType,2);

export const ResponseBodyType = new ABITupleType([
  ABIType.from("byte[32]"), //request_id
  ABIType.from("address"), //requester_address
  ABIType.from("byte[]"), // oracle return value
  ABIType.from("byte[]"), // user data
  ABIType.from("uint32"), // error code
  ABIType.from("uint64") // source failure bitmap
]);

export const ResponseBodyBytesType = new ABIArrayDynamicType(new ABIByteType);

export const SourceSpecType = new ABITupleType([
  new ABIUintType(32), //source_id #TODO we still need to decide the mapping of these
  new ABIArrayDynamicType(new ABIArrayDynamicType(new ABIByteType())), // source args...this is usually the JSON path
  new ABIUintType(64) //max age of the data in seconds 
]);

export const RequestArgsType = new ABITupleType([
  new ABIArrayDynamicType(SourceSpecType),
  new ABIUintType(32), 
  new ABIArrayDynamicType(new ABIByteType)
]);

export const DestinationType = new ABITupleType([
  new ABIUintType(64),  //app id of the destination 
  new ABIArrayDynamicType(new ABIByteType()) //method signature of the method in the destination app
]); 

export const SubscriptionType = new ABITupleType([
  new ABIUintType(16),
  new ABIUintType(16)
]);

export function create_source_arr(sourceID: number, source_args: Uint8Array[], maxAgeSeconds: number)
{
  return [sourceID, source_args, maxAgeSeconds];
}

export function create_source_spec(sourceID: number, source_args: Uint8Array[], maxAgeSeconds: number)
{
  return SourceSpecType.encode([sourceID, source_args, maxAgeSeconds]);
}

export function create_request_args(sourceSpecArray: [][], aggregationType: number, userData: Uint8Array)
{
  return RequestArgsType.encode([sourceSpecArray, aggregationType, userData ]);
}

export function create_destination_arg(destinationAppID: number, destinationMethodSignature: Uint8Array)
{
  return DestinationType.encode([destinationAppID, destinationMethodSignature]);
}