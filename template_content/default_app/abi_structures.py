from pyteal import *
from algosdk import abi as sdk_abi

# first is the abi type for use in writing the contract
# second is for use when encoding args for app calls to contracts
class BoxType(abi.NamedTuple):
    key: abi.Field[abi.DynamicBytes]
    app_id: abi.Field[abi.Uint64]

response_body_type = sdk_abi.TupleType([
    sdk_abi.ABIType.from_string("byte[32]"), # request_id
    sdk_abi.ABIType.from_string("address"), # requester_address
    sdk_abi.ABIType.from_string("byte[]"), # oracle return value
    sdk_abi.ABIType.from_string("byte[]"), # user data
    sdk_abi.ABIType.from_string("uint32"), # error code
    sdk_abi.ABIType.from_string("uint64") # source failure bitmap
])

response_body_bytes_type = sdk_abi.ArrayDynamicType(sdk_abi.ByteType())
