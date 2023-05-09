import sys
import yaml
from pyteal import *
from helpers.key_map import key_map

NUM_BYTES_LENGTH = Int(2)

global_keys = key_map["main_global"]
local_keys = key_map["main_local"]

def approval_program(
    CONTRACT_VERSION,
):
    CONTRACT_VERSION_BYTES = Bytes(CONTRACT_VERSION)
  
    handle_optin = Seq([
        Approve()
    ])

    handle_closeout = Err()

    handle_updateapp = Err()

    handle_deleteapp = Err()

    handle_creation = Seq([
        App.globalPut(global_keys["contract_version_key"], CONTRACT_VERSION_BYTES),
        Approve()
    ])
    request_selector = MethodSignature("request(byte[],byte[],uint64)void")
    subscribe_selector = MethodSignature("subscribe(byte[],byte[],byte[],uint64)void")

    selector = Txn.application_args[0]

    handle_noop = Cond(
        [
            selector == request_selector,
            Seq([
                Approve()
            ])
        ],
        [
            selector == subscribe_selector,
            Seq([
                Approve()
            ])
        ],
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
    params = yaml.safe_load(sys.argv[1])
    print(compileTeal(approval_program(**params), Mode.Application, version = 7))