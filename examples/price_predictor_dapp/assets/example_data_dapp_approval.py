import sys
import yaml
from pyteal import *
from helpers.key_map import key_map

global_keys = key_map["example_global"]
local_keys = key_map["example_local"]

def approval_program(
    MAIN_APP,
    APP_CURRENCY_ID,
    APP_CURRENCY_SYMBOL,
    APP_CURRENCY_NAME
):
    MAIN_APP = Int(MAIN_APP)

    @Subroutine(TealType.none)
    def input_data(
        currency_id,
        currency_symbol,
        currency_name,
        current_price,
        market_cap,
        high_24h,
        low_24h,
        price_change_24h,
        last_updated
    ):
        currency_id_arg = abi.make(abi.String)
        currency_symbol_arg = abi.make(abi.String)
        currency_name_arg = abi.make(abi.String)
        current_price_arg = abi.make(abi.Uint64)
        market_cap_arg = abi.make(abi.Uint64)
        high_24h_arg = abi.make(abi.Uint64)
        low_24h_arg = abi.make(abi.Uint64)
        price_change_24h_arg = abi.make(abi.Uint64)
        last_updated_arg = abi.make(abi.String)

        staker_state = App.localGetEx(Txn.sender(), MAIN_APP, key_map["main_local"]["local_stake"])
        return Seq([
            currency_id_arg.decode(currency_id),
            currency_symbol_arg.decode(currency_symbol),
            currency_name_arg.decode(currency_name),
            current_price_arg.decode(current_price),
            market_cap_arg.decode(market_cap),
            high_24h_arg.decode(high_24h),
            low_24h_arg.decode(low_24h),
            price_change_24h_arg.decode(price_change_24h),
            last_updated_arg.decode(last_updated),
            staker_state,
            If(staker_state.value() > Int(0) ).Then(
                Seq([
                    Log(Txn.application_args[1]),
                    Assert(
                        And(
                            App.globalGet(global_keys["currency_id"]) == currency_id_arg.get(),
                            App.globalGet(global_keys["currency_symbol"]) == currency_symbol_arg.get(),
                            App.globalGet(global_keys["currency_name"]) == currency_name_arg.get()
                        )
                    ),
                    App.globalPut(global_keys["current_price"],current_price_arg.get()),
                    App.globalPut(global_keys["market_cap"],market_cap_arg.get()),
                    App.globalPut(global_keys["high_24h"],high_24h_arg.get()),
                    App.globalPut(global_keys["low_24h"],low_24h_arg.get()),
                    App.globalPut(global_keys["price_change_24h"],price_change_24h_arg.get()),
                    App.globalPut(global_keys["last_updated"],last_updated_arg.get()),
                    Approve()
                ])
            )
        ])

    on_creation = Seq([
        App.globalPut(global_keys["creator"], Txn.sender()),
        App.globalPut(global_keys["currency_id"], Bytes(APP_CURRENCY_ID)),
        App.globalPut(global_keys["currency_symbol"], Bytes(APP_CURRENCY_SYMBOL)),
        App.globalPut(global_keys["currency_name"], Bytes(APP_CURRENCY_NAME)),
        Approve(),
    ])

    is_creator = Txn.sender() == App.globalGet(global_keys["creator"])

    on_closeout = Reject()

    input_data_selector = MethodSignature("input_data(string,string,string,uint64,uint64,uint64,uint64,ufixed64x2,string,application)void")

    selector = Txn.application_args[0]


    on_noop = Cond([
        selector == input_data_selector,
        Seq([
            input_data(
                Txn.application_args[1],
                Txn.application_args[2],
                Txn.application_args[3],
                Txn.application_args[4],
                Txn.application_args[5],
                Txn.application_args[6],
                Txn.application_args[7],
                Txn.application_args[8],
                Txn.application_args[9]
            ),
            Approve()
        ])
    ])

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(is_creator)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(is_creator)],
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, Reject()],
        [Txn.on_completion() == OnComplete.NoOp, on_noop],
    )

    return program

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    print(compileTeal(approval_program(
        **params,
    ), Mode.Application, version = 7))