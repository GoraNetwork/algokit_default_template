from pyteal import *

class PriceBoxTuple(abi.NamedTuple):
    price: abi.Field[abi.Uint64]
    timestamp: abi.Field[abi.Uint64]

class BoxType(abi.NamedTuple):
    key: abi.Field[abi.DynamicBytes]
    app_id: abi.Field[abi.Uint64]

class UserVote(abi.NamedTuple):
    price_box: abi.Field[PriceBoxTuple]
    box_name: abi.Field[abi.DynamicBytes]
