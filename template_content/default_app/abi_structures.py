from pyteal import *
from algosdk import abi as sdk_abi

# first is the abi type for use in writing the contract
# second is for use when encoding args for app calls to contracts
class PriceBoxTuple(abi.NamedTuple):
    price: abi.Field[abi.Uint64]
    timestamp: abi.Field[abi.Uint64]

price_box_tuple = sdk_abi.TupleType([
    sdk_abi.UintType(64), # price
    sdk_abi.UintType(64)    #timestamp
])

class BoxType(abi.NamedTuple):
    key: abi.Field[abi.DynamicBytes]
    app_id: abi.Field[abi.Uint64]

class UserVote(abi.NamedTuple):
    price_box: abi.Field[PriceBoxTuple]
    box_name: abi.Field[abi.DynamicBytes]

user_vote_type = sdk_abi.TupleType([
    price_box_tuple,
    sdk_abi.ArrayDynamicType(sdk_abi.ByteType())
])

# TODO: add these to our main REPO
proposals_entry_type = sdk_abi.TupleType([
    sdk_abi.ArrayStaticType(sdk_abi.ByteType(),32), # vote_hash
    sdk_abi.UintType(64), # vote_count
    sdk_abi.UintType(64), # stake_count
    sdk_abi.UintType(64), # vote_round
    sdk_abi.UintType(64), # rewards_payed_out
    sdk_abi.AddressType(), # requester
    sdk_abi.BoolType(), # is_history
])

local_history_entry = sdk_abi.TupleType([
    sdk_abi.ArrayStaticType(sdk_abi.ByteType(),32), # key_hash
    proposals_entry_type
])

response_body_type = sdk_abi.TupleType([
    sdk_abi.ABIType.from_string("byte[32]"), # request_id
    sdk_abi.ABIType.from_string("address"), # requester_address
    sdk_abi.ABIType.from_string("byte[]"), # oracle return value
    sdk_abi.ABIType.from_string("byte[]"), #  user data
    sdk_abi.ABIType.from_string("uint32"), #  error code
    sdk_abi.ABIType.from_string("uint64") #  source failure bitmap
])

response_body_bytes_type = sdk_abi.ArrayDynamicType(sdk_abi.ByteType())
