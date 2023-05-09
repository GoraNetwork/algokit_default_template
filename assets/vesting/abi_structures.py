from pyteal import *
from algosdk import abi as algosdkAbi
from typing import Literal as L

# 64 bytes total
class VestingKey(abi.NamedTuple):
    userAddr: abi.Field[abi.Address]
    key_hash: abi.Field[abi.StaticBytes[L[32]]] #hash of Concat(asset_id, vester_address, vesting_key)

VestingKeyAlgoSdk = algosdkAbi.TupleType([
        algosdkAbi.AddressType,
        algosdkAbi.ArrayStaticType(algosdkAbi.ByteType(), 32),
    ])

# 5 * 8 + 32 + 1 = 73 bytes total
class VestingEntry(abi.NamedTuple):
    start_time: abi.Field[abi.Uint64]
    unlock_time: abi.Field[abi.Uint64]
    token_id: abi.Field[abi.Uint64]
    amount: abi.Field[abi.Uint64] 
    amount_claimed: abi.Field[abi.Uint64]
    vester: abi.Field[abi.Address]
    staked: abi.Field[abi.Bool]

VestingEntryAlgoSdk = algosdkAbi.TupleType([
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
        algosdkAbi.UintType(64),
        algosdkAbi.AddressType(),
        algosdkAbi.BoolType()
    ])