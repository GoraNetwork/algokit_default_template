import sys
import os
import yaml
import pathlib
sys.path.append(os.path.join(pathlib.Path(__file__).parent.resolve(), '../..') )
from utils.gora_pyteal_utils import opt_in, opt_in_asset, make_request_constructed
from pyteal import *

#global keys
test_key = Bytes("tk")

def approval_program(MAIN_APP):
    MAIN_APP_INT = Int(MAIN_APP)
    handle_optin = Err()

    handle_closeout =Err()

    handle_updateapp = Err()

    handle_deleteapp = Err()

    handle_creation = Seq([
        Approve()
    ])

    opt_into_gora_selector = MethodSignature("opt_in_gora(asset,application)void")
    make_inner_request_selector = MethodSignature("make_inner_request(uint64,byte[],byte[],uint64,application,application,application,application,application,application,application)void")
    set_child_selector = MethodSignature("set_child(uint64)void")

    selector = Txn.application_args[0]

    @Subroutine(TealType.none)
    def set_child():
        return Seq([
            App.globalPut(Bytes("child"), Btoi(Txn.application_args[1]))
        ])

    @Subroutine(TealType.none)
    def make_request_inner():
        i = ScratchVar(TealType.uint64)
        child_exists = App.globalGetEx(Global.current_application_id(), Bytes("child"))
        return Seq([
            child_exists,
            If(child_exists.hasValue())
                .Then(
                    If(Btoi(Txn.application_args[1]) > Int(0)).Then(
                        # If(Btoi(Txn.application_args[1]) == Int(1)).Then(Seq([
                        #     Log(Itob(Txn.applications[Txn.app])),
                        #     Approve()
                        # ])),
                    InnerTxnBuilder.Begin(),
                    InnerTxnBuilder.SetFields({
                        TxnField.type_enum: TxnType.ApplicationCall,
                        TxnField.application_id: App.globalGet(Bytes("child")),
                        TxnField.application_args: [
                            Txn.application_args[0],
                            Itob(Btoi(Txn.application_args[1]) - Int(1)),
                            Txn.application_args[2],
                            Txn.application_args[3],
                            Txn.application_args[4],
                        ],
                    }),
                    For(i.store(Int(0)), i.load() <= Txn.applications.length(), i.store(i.load() + Int(1))).Do(
                        If(Txn.applications[i.load()] == App.globalGet(Bytes("child"))).
                            Then(Pop(Int(1))).
                        Else(
                            InnerTxnBuilder.SetField(TxnField.applications, [Txn.applications[i.load()]])
                        )
                    ),
                    InnerTxnBuilder.Submit()
                    ).Else(
                        make_request_constructed(
                            Txn.application_args[2],
                            Txn.application_args[3],
                            Txn.application_args[4],
                            MAIN_APP_INT, #goracle main app id
                            Bytes("my_key"),
                            BytesZero(Int(0)),
                            BytesZero(Int(0)),
                            BytesZero(Int(0)),
                            BytesZero(Int(0))
                        ),
                    )
                ).
                Else(
                    make_request_constructed(
                        Txn.application_args[2],
                        Txn.application_args[3],
                        Txn.application_args[4],
                        MAIN_APP_INT, #goracle main app id
                        Bytes("my_key"),
                        BytesZero(Int(0)),
                        BytesZero(Int(0)),
                        BytesZero(Int(0)),
                        BytesZero(Int(0))
                    ),
                ),
        ])

    handle_noop = Cond(
        [
            selector == opt_into_gora_selector,
            Seq([
                opt_in_asset(Txn.assets[0]), # opt into gora asset
                opt_in(Txn.applications[1]), # opt into gora main application
                Approve()
            ])
        ],
        [
            selector == make_inner_request_selector,
            Seq([
                make_request_inner(),
                Approve()
            ])
        ],
        [
            selector == set_child_selector,
            Seq([
                set_child(),
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