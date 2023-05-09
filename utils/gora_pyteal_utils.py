# pylint: disable=W1514,W0401,C0114,C0116,C0115,C0103,W0105,W0614,C0301,R0913
import json
import sys
import os
from pyteal import *
from .abi_types import *
from .inline import InlineAssembly

ABI_PATH = "assets/abi"
if "GORACLE_ABI_PATH" in os.environ:
    ABI_PATH = os.environ["GORACLE_ABI_PATH"]

main_contract_abi = json.load(open(ABI_PATH + "/main-contract.json"))
voting_contract_abi = json.load(open(ABI_PATH + "/voting-contract.json"))
smart_assert_errors = json.load(open(ABI_PATH + "/../smart_assert_errors.json"))

def calc_box_cost(key_size_bytes:int,box_size_bytes:int):
    # (2500 per box) + (400 * (key size + box size))
    if key_size_bytes > 64:
        raise Exception("key size is over 64 bytes")
    cost = (
        Int(2500) + Int(400) * 
        (
            Int(key_size_bytes) +
            Int(box_size_bytes)
        )
    )
    return cost

def get_abi_method(method_name,contract:str):
    method_dict = {
        "main": main_contract_abi["methods"],
        "voting": voting_contract_abi["methods"]
    }
    method_list = method_dict[contract]
    for method in method_list:
        if method["name"] == method_name:
            return method
    return None

def get_method_signature(method_name, contract:str):
    method = get_abi_method(method_name,contract)
    if method is None:
        raise RuntimeError
    signature = method_name + "("
    num_args = len(method["args"])
    for index, arg in enumerate(method["args"]):
        signature += arg["type"] 
        if index < num_args - 1:
            signature += ","
        else:
            signature += f'){method["returns"]["type"]}'
            return signature

@ABIReturnSubroutine
def create_source_tuple(
    source_id: Expr, #Int
    source_arg_list: Expr, #Bytes
    max_age: Expr,
    *,
    output: SourceSpec
) -> Expr: #Int
    return Seq([
        (source_id_param := abi.Uint32()).set(source_id),
        (source_arg_list_param := abi.DynamicBytes()).set(source_arg_list),
        (max_age_param := abi.Uint64()).set(max_age),
        output.set(
            source_id_param,
            source_arg_list_param,
            max_age_param
        ),
    ])

"""
KEEP IN MIND THAT WHEN MAKING A REQUEST YOU WILL NEED TO INCLUDE 
THE BOX REFERENCE OF Concat(<REQUEST_SENDER_PK>, KEY)

SourceSpec: SourceSpec that is already encoded
aggregation: pyteal.Int
user_data: pyteal.Bytes
method_signature: pyteal.Bytes
app_id: pyteal.Int
goracle_main_app_id: pyteal.Int
request_types: pyteal.Int
key: pyteal.Bytes
"""
@Subroutine(TealType.none)
def make_request(
    source_specs: abi.DynamicArray[SourceSpec],
    aggregation: Expr, #Int
    user_data: Expr, #Bytes
    app_id: Expr, #Int
    method_signature: Expr, #Bytes
    goracle_main_app_id: Expr,  #Int
    request_type: Expr,
    key: Expr,
    app_refs: Expr, #static array of uint64
    asset_refs: Expr, #static array of uint64
    account_refs: Expr, #static array of byte[32]
    box_refs: Expr # dynamic array of  (byte[],uint64)
): # Int

    request_tuple = abi.make(RequestSpec)
    destination_tuple = abi.make(DestinationSpec)

    return Seq([
        (user_data_param := abi.DynamicBytes()).set(user_data),
        (agg_param := abi.Uint32()).set(aggregation),
        (app_id_param := abi.Uint64()).set(app_id),
        (request_type_param := abi.Uint64()).set(request_type),
        (method_sig_param := abi.DynamicBytes()).set(method_signature),
        (key_abi := abi.DynamicBytes()).set(key),

        request_tuple.set(
            source_specs,
            agg_param,
            user_data_param
        ),

        destination_tuple.set(
            app_id_param,
            method_sig_param
        ),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("request","main"),
            args=[
                request_tuple.encode(),
                destination_tuple.encode(),
                request_type_param.encode(),
                key_abi.encode(),
                app_refs,
                asset_refs,
                account_refs,
                box_refs
            ]
        ),
        InnerTxnBuilder.Submit(),
    ])

"""
KEEP IN MIND THAT WHEN MAKING A REQUEST YOU WILL NEED TO INCLUDE 
THE BOX REFERENCE OF Concat(<REQUEST_SENDER_PK>, KEY)

SourceSpec: SourceSpec that is already encoded
aggregation: pyteal.Int
user_data: pyteal.Bytes
method_signature: pyteal.Bytes
app_id: pyteal.Int
goracle_main_app_id: pyteal.Int
request_types: pyteal.Int
key: pyteal.Bytes
"""
@Subroutine(TealType.none)
def make_request_constructed(
    request_args_encoded: Expr,
    destination_encoded: Expr,
    request_type_encoded: Expr,
    goracle_main_app_id: Expr,
    key: Expr,
    app_refs: Expr,
    asset_refs: Expr,
    account_refs: Expr,
    box_refs: Expr
):
    return Seq([
        (key_abi := abi.DynamicBytes()).set(key),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("request","main"),
            args=[
                request_args_encoded,
                destination_encoded,
                request_type_encoded,
                key_abi.encode(),
                app_refs,
                asset_refs,
                account_refs,
                box_refs
            ]
        ),
        InnerTxnBuilder.Submit(),
    ])

@Subroutine(TealType.none)
def opt_in(goracle_main_app_id):
    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.ApplicationCall,
            TxnField.application_id: goracle_main_app_id,
            TxnField.on_completion: OnComplete.OptIn,
        }),
        InnerTxnBuilder.Submit(),
    ])

@Subroutine(TealType.none)
def opt_in_asset(asset_id):
    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.AssetTransfer,
            TxnField.xfer_asset: asset_id,
            TxnField.asset_receiver: Global.current_application_address(),
            TxnField.asset_amount: Int(0)
        }),
        InnerTxnBuilder.Submit()
    ])

"""
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
gora_token_id: pyteal.Int
amount_to_deposit: pyteal.Int
account_to_deposit_to: pyteal.Bytes
"""
@Subroutine(TealType.none)
def deposit_token(goracle_main_app_address, goracle_main_app_id, gora_token_id, amount_to_deposit, account_to_deposit_to):
    asset_transfer = \
    {
        TxnField.type_enum: TxnType.AssetTransfer,
        TxnField.asset_amount: amount_to_deposit,
        TxnField.xfer_asset: gora_token_id,
        TxnField.asset_receiver: goracle_main_app_address
    }

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("deposit_token","main"),
            args=[
                asset_transfer,
                gora_token_id,
                account_to_deposit_to
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

"""
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
amount_to_deposit: pyteal.Int
account_to_deposit_to: pyteal.Bytes
"""
@Subroutine(TealType.none)
def deposit_algo(goracle_main_app_address, goracle_main_app_id, amount_to_deposit, account_to_deposit_to):
    algo_transfer = \
    {
        TxnField.type_enum: TxnType.Payment,
        TxnField.amount: amount_to_deposit,
        TxnField.receiver: goracle_main_app_address
    }

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("deposit_algo","main"),
            args=[
                algo_transfer,
                account_to_deposit_to
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

"""
goracle_main_app_address: pyteal.Bytes
new_key: pyteal.Bytes
"""
@Subroutine(TealType.none)
def register_key(goracle_main_app_id, new_key):

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("register_participation_account","main"),
            args=[
                new_key,
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

"""
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
gora_token_id: pyteal.Int
amount_to_deposit: pyteal.Int
account_to_deposit_to: pyteal.Bytes
"""
@Subroutine(TealType.none)
def withdraw_token(goracle_main_app_id, gora_token_id, amount_to_withdraw):
    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("withdraw_token","main"),
            args=[
                amount_to_withdraw,
                gora_token_id,
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

"""
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
amount_to_deposit: pyteal.Int
account_to_deposit_to: pyteal.Bytes
"""
@Subroutine(TealType.none)
def withdraw_algo(goracle_main_app_id, amount_to_withdraw):

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("withdraw_algo","main"),
            args=[
                amount_to_withdraw
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

'''
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
gora_token_id: pyteal.Int
amount_to_stake: pyteal.Int
'''
@Subroutine(TealType.none)
def stake_token(goracle_main_app_address, goracle_main_app_id, gora_token_id, amount_to_stake):
    asset_transfer = \
    {
        TxnField.type_enum: TxnType.AssetTransfer,
        TxnField.asset_amount: amount_to_stake,
        TxnField.xfer_asset: gora_token_id,
        TxnField.asset_receiver: goracle_main_app_address
    }

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature('stake', 'main'),
            args=[
                asset_transfer,
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

'''
goracle_main_app_id: pyteal.Int
gora_token_id: pyteal.Int
amount_to_stake: pyteal.Int
'''
@Subroutine(TealType.none)
def unstake_token(goracle_main_app_id, gora_token_id, amount_to_unstake):

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature('unstake', 'main'),
            args=[
                amount_to_unstake,
                gora_token_id
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])


"""
goracle_main_app_address: pyteal.Bytes
new_key: pyteal.Bytes
"""
@Subroutine(TealType.none)
def register_key(goracle_main_app_id, new_key):

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("register_participation_account","main"),
            args=[
                new_key,
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

"""
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
gora_token_id: pyteal.Int
amount_to_deposit: pyteal.Int
account_to_deposit_to: pyteal.Bytes
"""
@Subroutine(TealType.none)
def withdraw_token(goracle_main_app_id, gora_token_id, amount_to_withdraw):
    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("withdraw_token","main"),
            args=[
                amount_to_withdraw,
                gora_token_id,
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

"""
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
amount_to_deposit: pyteal.Int
account_to_deposit_to: pyteal.Bytes
"""
@Subroutine(TealType.none)
def withdraw_algo(goracle_main_app_id, amount_to_withdraw):

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature("withdraw_algo","main"),
            args=[
                amount_to_withdraw
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

'''
goracle_main_app_address: pyteal.Bytes
goracle_main_app_id: pyteal.Int
gora_token_id: pyteal.Int
amount_to_stake: pyteal.Int
'''
@Subroutine(TealType.none)
def stake_token(goracle_main_app_address, goracle_main_app_id, gora_token_id, amount_to_stake):
    asset_transfer = \
    {
        TxnField.type_enum: TxnType.AssetTransfer,
        TxnField.asset_amount: amount_to_stake,
        TxnField.xfer_asset: gora_token_id,
        TxnField.asset_receiver: goracle_main_app_address
    }

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature('stake', 'main'),
            args=[
                asset_transfer,
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])

'''
goracle_main_app_id: pyteal.Int
gora_token_id: pyteal.Int
amount_to_stake: pyteal.Int
'''
@Subroutine(TealType.none)
def unstake_token(goracle_main_app_id, gora_token_id, amount_to_unstake):

    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id=goracle_main_app_id,
            method_signature=get_method_signature('unstake', 'main'),
            args=[
                amount_to_unstake,
                gora_token_id
            ],
        ),
        InnerTxnBuilder.Submit(),
    ])
"""
Assert with a number to indentify it in API error message. The message will be:
"shr arg too big, (%d)" where in "%d" 6 lowest decinals are the line number and
any above that are the error code. Error types are defined "error_codes.json"
"""
def SmartAssert(cond, err_type = 0):
    if type(err_type) == str:
        err_type = smart_assert_errors.index(err_type) # map mnemonic to code
    err_line = sys._getframe().f_back.f_lineno # calling line number
    return If(Not(cond)).Then(
        InlineAssembly("int 0\nint {}\nshr\n".format(err_type * 1000000 + err_line))
    )