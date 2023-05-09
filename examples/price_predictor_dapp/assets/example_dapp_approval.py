import sys
import os
import pathlib
sys.path.append(os.path.join(pathlib.Path(__file__).parent.resolve(), '../../..') )
from utils.gora_pyteal_utils import opt_in, make_request, opt_in_asset, create_source_tuple
from utils.abi_types import *
import yaml
from pyteal import *
import algosdk
from helpers.key_map import key_map

global_keys = key_map["example_global"]
local_keys = key_map["example_local"]

RESPONSE_TYPE_TYPE = abi.Uint32
RESPONSE_BODY_TYPE = ResponseBody()

def validate_submit_txn():
    send_algo_txn = Gtxn[Txn.group_index()-Int(1)]
    amount = App.globalGet(global_keys["submission_amount"])
    # to ensure that the amount has been set to something other than 0
    round_status = App.globalGet(global_keys["round_status"])
    return Assert(
        And(
            round_status == Bytes("open"),
            Global.latest_timestamp() < App.globalGet(global_keys["end_submission_round_time"]),
            send_algo_txn.type_enum()==TxnType.Payment,
            send_algo_txn.sender()==Txn.sender(),
            send_algo_txn.receiver()==Global.current_application_address(),
            send_algo_txn.amount()==amount,
            send_algo_txn.close_remainder_to()==Global.zero_address(),
            send_algo_txn.rekey_to()==Global.zero_address(),
            send_algo_txn.lease()==Global.zero_address()
        )
    )

def calculate_winnings( # calculates how much each winner gets
    win_outcome_tally_key,
    lose_outcome_1_tally_key,
    lose_outcome_2_tally_key
):
    total = App.globalGet(lose_outcome_1_tally_key)+App.globalGet(lose_outcome_2_tally_key)

    return Seq([
        If(App.globalGet(win_outcome_tally_key) == Int(0)).
        Then(App.globalPut(
            global_keys["winnings"],
            Int(0)
        )).
        Else(App.globalPut(
            global_keys["winnings"],
            Mul(Div(total,App.globalGet(win_outcome_tally_key)),App.globalGet(global_keys["submission_amount"]))
        )),
    ])

#The GORACLE_MAIN_ADDR is the creator of the voting contracts on the goracle network
#this is used to validate that the Address that is sending update request is valid, 
#by checking the creator of the APP ID (translated to address) that is sending the transaction
def approval_program(GORACLE_MAIN_ADDR, SUBMISSION_TIME, WAIT_TIME):
    GORACLE_MAIN_ADDR = Bytes(algosdk.account.encoding.decode_address(GORACLE_MAIN_ADDR))
    is_creator = Txn.sender() == App.globalGet(global_keys["creator"])
    
    sender_contract_address = AppParam.address(Txn.applications[1])
    sender_creator = AppParam.creator(Txn.applications[1])

    @Subroutine(TealType.none)
    def reset_app():
        return Seq([
            App.globalPut(global_keys["end_round_time"],Int(0)),
            App.globalPut(global_keys["end_submission_round_time"],Int(0)),
            App.globalPut(global_keys["end_round_time"],Int(0)),
            App.globalPut(global_keys["lock_in_price"],Int(0)),
            App.globalPut(global_keys["round_status"], Bytes("closed")),
            App.globalPut(global_keys["up_tally"],Int(0)),
            App.globalPut(global_keys["down_tally"],Int(0)),
            App.globalPut(global_keys["same_tally"],Int(0))
        ])

    @Subroutine(TealType.none)
    def start_round(current_currency_price):
        return Seq([
            #24 hours in seconds. Once round has started, it will end in 24 hours from initialization
            App.globalPut(global_keys["start_round_time"], Global.latest_timestamp()),
            App.globalPut(global_keys["end_submission_round_time"],Global.latest_timestamp()+Int(SUBMISSION_TIME)), # allow 1 day for submissions
            App.globalPut(global_keys["end_round_time"],Global.latest_timestamp()+Int(WAIT_TIME)), #wait 3 days after submissions
            App.globalPut(global_keys["lock_in_price"], current_currency_price),
            App.globalPut(global_keys["round_status"],Bytes("open")),
            App.globalPut(global_keys["outcome"],Bytes("unknown")),
            App.globalPut(global_keys["winnings"],Int(0)),
            App.globalPut(global_keys["up_tally"],Int(0)),
            App.globalPut(global_keys["down_tally"],Int(0)),
            App.globalPut(global_keys["same_tally"],Int(0))
        ])

    @Subroutine(TealType.none)
    def finalize_outcome(current_price) -> Expr: #this ends the round after the waiting period, users can now see if they won
        return Seq([
            If(current_price > App.globalGet(global_keys["lock_in_price"])).Then(
                Seq([
                    App.globalPut(global_keys["outcome"],Bytes("up")),
                    calculate_winnings(global_keys["up_tally"],global_keys["down_tally"],global_keys["same_tally"])
                ])
            ).ElseIf(current_price < App.globalGet(global_keys["lock_in_price"])).Then(
                Seq([
                    App.globalPut(global_keys["outcome"],Bytes("down")),
                    calculate_winnings(global_keys["down_tally"],global_keys["up_tally"],global_keys["same_tally"])
                ])
            ).ElseIf(current_price == App.globalGet(global_keys["lock_in_price"])).Then(
                Seq([
                    App.globalPut(global_keys["outcome"],Bytes("same")),
                    calculate_winnings(global_keys["same_tally"],global_keys["up_tally"],global_keys["down_tally"])
                ])
            ),

            # Reset everything now that calculations have been done
            reset_app(),
        ])

    @Subroutine(TealType.none)
    def grade_submission() -> Expr: # check to see if you win
        winnings = App.globalGet(global_keys["winnings"]) + App.globalGet(global_keys["submission_amount"])
        user = Txn.sender()

        return Seq([
            Assert(
                And(
                    Global.latest_timestamp() >= (App.globalGet(global_keys["end_round_time"])), #has to be at the end of a round.
                    App.localGet(user, local_keys["outcome_choice_time"]) >= App.globalGet(global_keys["start_round_time"]), #have to have a vote after the round has started
                    App.localGet(user,local_keys["outcome_choice"])==App.globalGet(global_keys["outcome"]) # you have to have a winning vote
                )
            ),
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.Payment,
                TxnField.receiver: user,
                TxnField.amount: winnings
            }),
            InnerTxnBuilder.Submit()
        ])
    
    @Subroutine(TealType.none)
    def submit_choice( #make your bet
        outcome_choice: Expr
    ) -> Expr:

        outcome_choice_arg = abi.make(abi.String)

        return Seq([
            outcome_choice_arg.decode(outcome_choice),
            App.localPut(Txn.sender(),local_keys["outcome_choice"], outcome_choice),
            App.localPut(Txn.sender(), local_keys["outcome_choice_time"], Global.latest_timestamp()),
            validate_submit_txn(),
            If(outcome_choice_arg.get() == Bytes("up")).Then(
                App.globalPut(global_keys["up_tally"],App.globalGet(global_keys["up_tally"])+Int(1))
            ).ElseIf(outcome_choice_arg.get() == Bytes("down")).Then(
                App.globalPut(global_keys["down_tally"],App.globalGet(global_keys["down_tally"])+Int(1))
            ).ElseIf(outcome_choice_arg.get() == Bytes("same")).Then(
                App.globalPut(global_keys["same_tally"],App.globalGet(global_keys["same_tally"])+Int(1))
            ).Else(Reject())
        ])
        
    on_creation = Seq([
        App.globalPut(global_keys["creator"], Txn.sender()),
        Approve(),
    ])

    on_closeout = Reject()

    on_opt_in = Seq([
        App.localPut(Txn.sender(),local_keys["outcome_choice"],Bytes("")),
        Approve()
    ])

    start_round_selector = MethodSignature("start_round(uint64,application)void")
    goracle_start_round_selector = MethodSignature("goracle_start_round(uint32,byte[])void")

    end_round_selector = MethodSignature("end_round(application)void")
    goracle_end_round_selector = MethodSignature("goracle_end_round(uint32,byte[])void")

    grade_submission_selector = MethodSignature("grade_submission()void")
    submit_choice_selector = MethodSignature("submit_choice(pay,string)void")
    opt_into_gora_selector = MethodSignature("opt_in_gora(asset,application)void")

    selector = Txn.application_args[0]

    response_body_arg = abi.make(ResponseBody)
    response_body_wrapper = abi.make(abi.DynamicBytes)
    new_price = RESPONSE_BODY_TYPE.oracle_return_value.produced_type_spec().new_instance()

    amount_arg = abi.make(abi.Uint64)
    
    source_arr = abi.make(abi.DynamicArray[SourceSpec])

    is_goracle = Seq([
        sender_contract_address,
        sender_creator,
        Assert(sender_contract_address.hasValue()),
        Assert(sender_creator.hasValue()),
        Assert(Txn.sender() == sender_contract_address.value()),
        Assert(sender_creator.value() == GORACLE_MAIN_ADDR),
    ])

    source_tuple = abi.make(SourceSpec)
    @Subroutine(TealType.none)
    def request_btc_price(method_sig, key):
        empty_static_arr = Bytes("")
        empty_dynamic_arr = abi.make(abi.DynamicArray[abi.Uint64])
        return Seq([
            create_source_tuple(Int(0), #source ID
                                Bytes("0"), #source Args
                                Int(3000)).\
                                    store_into(source_tuple), 
                
            #make_request expects a dynamic array of source_tuples (so that the user may request data from multiple sources)
            #in this example we are only using a single source, but note you can input an array of multiple soruces here.
            source_arr.set([source_tuple]),
            empty_dynamic_arr.set([]),
            make_request(
                source_arr,
                Int(5), # aggregation method
                Bytes("This_is_user_data"), #user data
                Txn.applications[0], #this application id
                method_sig, #the method signature for goracle network to call
                Txn.applications[1], #goracle main app id
                Int(0),
                key,
                empty_static_arr,
                empty_static_arr,
                empty_static_arr,
                empty_dynamic_arr.encode()
            ),
        ])

    on_noop = Cond(
        [
            selector == start_round_selector,
            Seq([
                #Going to assume that the creator intends to kick off a round, this will submit a request to the goracle network for a price update
                Assert(And(is_creator, App.globalGet(global_keys["end_round_time"]) == Int(0))),
                amount_arg.decode(Txn.application_args[1]),
                App.globalPut(global_keys["submission_amount"], amount_arg.get()),
                request_btc_price(goracle_start_round_selector, Bytes("start")),
                Approve()
            ])
        ],
        [
            selector == goracle_start_round_selector,
            Seq([
                is_goracle,
                Assert(App.globalGet(global_keys["end_round_time"]) == Int(0)),
                response_body_wrapper.decode(Txn.application_args[2]),
                response_body_arg.decode(response_body_wrapper.get()),
                response_body_arg.oracle_return_value.store_into(new_price),
                #Goracle network calling this method selector means we can now start the round with the most up to date price that the network has supplied
                start_round(
                    Btoi(Substring(new_price._stored_value.load(), Int(2), Len(new_price._stored_value.load())))
                ),
                Approve()
            ])
        ],
        [
            selector == opt_into_gora_selector,
            Seq([
                Assert(is_creator),
                opt_in_asset(Txn.assets[0]), # opt into gora asset
                opt_in(Txn.applications[1]), # opt into gora main application
                Approve()
            ])
        ],
        [
            selector == end_round_selector,
            Seq([
                Assert(
                    And(
                        App.globalGet(global_keys["end_round_time"]) != Int(0),
                        App.globalGet(global_keys["round_status"]) == Bytes("open"),
                        #TODO: make this window of time work with dev mode
                        # Global.latest_timestamp() > App.globalGet(global_keys["end_round_time"]),
                        # Global.latest_timestamp() < (App.globalGet(global_keys["end_round_time"])+Int(7200))
                    )
                ),
                request_btc_price(goracle_end_round_selector, Bytes("end")),
                Approve()
            ])
        ],
        [
            selector == goracle_end_round_selector,
            Seq([
                is_goracle,
                response_body_wrapper.decode(Txn.application_args[2]),
                response_body_arg.decode(response_body_wrapper.get()),
                response_body_arg.oracle_return_value.store_into(new_price),
                finalize_outcome(
                    Btoi(Substring(new_price._stored_value.load(), Int(2), Len(new_price._stored_value.load())))
                ),
                Approve()
            ])
        ],
        [
            selector == grade_submission_selector,
            Seq([
                grade_submission(),
                Approve()
            ])
        ],
        [
            selector == submit_choice_selector,
            Seq([
                submit_choice(
                    Txn.application_args[1]
                ),
                Approve()
            ])
        ]
    )

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(is_creator)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(is_creator)],
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, on_opt_in],
        [Txn.on_completion() == OnComplete.NoOp, on_noop],
    )

    return program

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    print(compileTeal(approval_program(
        **params,
    ), Mode.Application, version = 7))