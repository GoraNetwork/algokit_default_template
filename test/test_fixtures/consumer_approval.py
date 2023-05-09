import sys
import os
import pathlib
from pyteal import *
from typing import Literal as L
sys.path.append(os.path.join(pathlib.Path(__file__).parent.resolve(),"../.."))
from utils.abi_types import ResponseBody

#global keys
test_key = Bytes("tk")

RESPONSE_TYPE_TYPE = abi.Uint32
RESPONSE_BODY_TYPE = ResponseBody

def approval_program():
 
    handle_optin = Err()

    handle_closeout =Err()

    handle_updateapp = Err()

    handle_deleteapp = Err()

    handle_creation = Seq([
        Approve()
    ])
    
    test_selector = MethodSignature("test_endpoint(uint32,byte[])void")

    selector = Txn.application_args[0]
    
    response_type_arg = abi.make(RESPONSE_TYPE_TYPE)
    response_body_arg = abi.make(RESPONSE_BODY_TYPE)
    response_body_wrapper = abi.make(abi.DynamicBytes)
    response_value = abi.make(abi.DynamicArray[abi.Byte])
    handle_noop = Cond(
        [
            selector == test_selector,
            Seq([
                response_body_wrapper.decode(Txn.application_args[2]),
                response_body_arg.decode(response_body_wrapper.get()),
                response_body_arg.oracle_return_value.store_into(response_value),
                App.globalPut(test_key, response_value._stored_value.load()),
                Approve()
            ])
        ]
    )

    program = Cond(
        [Txn.application_id() == Int(0), handle_creation],
        [Txn.on_completion() == OnComplete.NoOp, handle_noop],
        [Txn.on_completion() == OnComplete.OptIn, handle_optin],
        [Txn.on_completion() == OnComplete.CloseOut, handle_closeout],
        [Txn.on_completion() == OnComplete.UpdateApplication, handle_updateapp],
        [Txn.on_completion() == OnComplete.DeleteApplication, handle_deleteapp]
    )
    return program

if __name__ == "__main__":
    print(compileTeal(approval_program(), Mode.Application, version = 7))