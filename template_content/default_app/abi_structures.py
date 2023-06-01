from pyteal import *
from algosdk import abi as sdk_abi

# first is the abi type for use in writing the contract
# second is for use when encoding args for app calls to contracts
class PriceBoxTuple(abi.NamedTuple):
    price: abi.Field[abi.Uint64]
    timestamp: abi.Field[abi.Uint64]

price_box_tuple = sdk_abi.TupleType([
    sdk_abi.UintType(64), # price
    sdk_abi.UintType(64) # timestamp
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

response_body_type = sdk_abi.TupleType([
    sdk_abi.ABIType.from_string("byte[32]"), # request_id
    sdk_abi.ABIType.from_string("address"), # requester_address
    sdk_abi.ABIType.from_string("byte[]"), # oracle return value
    sdk_abi.ABIType.from_string("byte[]"), # user data
    sdk_abi.ABIType.from_string("uint32"), # error code
    sdk_abi.ABIType.from_string("uint64") # source failure bitmap
])

response_body_bytes_type = sdk_abi.ArrayDynamicType(sdk_abi.ByteType())
