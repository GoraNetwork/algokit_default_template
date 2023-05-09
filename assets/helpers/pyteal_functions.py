from pyteal import *
from pyteal.ast.abi.type import BaseType
from typing import Literal as L
from typing import TypeVar

T = TypeVar("T", bound=BaseType)

def initialize_abi_static_array(array_entry_abi_type:Array[T] ,length: int,stake_keys: list[str],global_keys:dict):
    """
    You must know ahead how many pieces to split array to fit (128 minus bytes for key) per state entry.
    Recommended amount would be 120 bytes or less.
    """
    array_entry = array_entry_abi_type()
    array = abi.make(abi.StaticArray[array_entry_abi_type,L[length]])
    zero_int = abi.Uint64()
    values = [array_entry for _ in range(length)]
    array_entry_length = array_entry_abi_type.length
    bytes_array_chunk = length*array_entry_length /stake_keys.__len__
    bytes_array_end = length*array_entry_length
    i = ScratchVar(TealType.uint64)
    
    return Seq([
        Assert(bytes_array_chunk < Int(120)), # check to make sure if timelock increases that we come back and add more state.
        zero_int.set(Int(0)),
        array_entry.set(zero_int),
        array.set(values),
        i.store(Int(0)),
        For(i.load(),i.load().value < stake_keys.__len_,i.store(i.load() + Int(1))).Do(
            App.globalPut(
                global_keys[stake_keys[i.load().value]],
                Substring(
                    array.encode(),
                    i.load()*bytes_array_chunk,
                    i.load()*bytes_array_chunk+bytes_array_chunk
                )
            )
        ),
        
    ])
