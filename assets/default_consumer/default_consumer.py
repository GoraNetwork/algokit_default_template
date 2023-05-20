from typing import Final, Literal as L
import sys
sys.path.append('.')
import pyteal
import beaker
import yaml
import algosdk
from abi_structures import *
from key_map import key_map
from assets.helpers.key_map import key_map as protocol_key_map
from utils.gora_pyteal_utils import *
from utils.gora_pyteal_utils import opt_in as gora_opt_in
from utils.abi_types import *

KEYMAP = key_map['consumer']
GKEYMAP = KEYMAP['global']
LKEYMAP = KEYMAP['local']
BKEYMAP = KEYMAP['boxes']
MLKEYMAP = protocol_key_map['main_local']
VGKEYMAP = protocol_key_map['voting_global']
RSKEYMAP = protocol_key_map['request_status']

MAIN_APP_ID = Int(0)
MAIN_APP_ADDRESS = Bytes("")

app = beaker.Application("DefaultConsumerApp",build_options=beaker.BuildOptions(avm_version=8))

@app.opt_in
def opt_in():
    return Seq(
        Reject()
    )

@app.delete(bare=True)
def delete():
    return Seq(
        Reject()
    )

@app.external
def create_price_box(
    algo_xfer: abi.PaymentTransaction,
    box_name: abi.DynamicBytes
):
    return Seq(
        Assert(
            algo_xfer.get().sender() == Txn.sender(),
            algo_xfer.get().amount() == Int(2500) + (Int(400) * ((box_name.length()) + Int(abi.size_of(abi.Uint64)))),
            algo_xfer.get().receiver() == Global.current_application_address(),
            algo_xfer.get().type_enum() == TxnType.Payment,
            algo_xfer.get().close_remainder_to() == Global.zero_address(),
            algo_xfer.get().rekey_to() == Global.zero_address(),
            algo_xfer.get().lease() == Global.zero_address()
        ),
        Pop(App.box_create(box_name.get(),Int(abi.size_of(PriceBoxTuple))))
    )

def verify_app_call():
    # assert that this is coming from a voting contract
    current_request_info_bytes = App.globalGetEx(Global.caller_app_id(),VGKEYMAP["current_request_info"])
    voting_contract_creator = App.globalGetEx(Global.caller_app_id(),VGKEYMAP["creator"])
    vote_app_creator = AppParam.creator(Global.caller_app_id())

    return Seq(
        current_request_info_bytes,
        Assert(current_request_info_bytes.hasValue()),
        (current_request_info := abi.make(RequestInfo)).decode(current_request_info_bytes.value()),
        current_request_info.request_status.store_into(request_status := abi.make(abi.Uint8)),
        vote_app_creator,
        voting_contract_creator,
        Assert(
            # TODO: is request_status necessary? If so, we will need to reorder the innerTxn in voting contract
            # request_status.get() == RSKEYMAP["completed"],
            vote_app_creator.value() == MAIN_APP_ADDRESS,
            vote_app_creator.value() == voting_contract_creator.value(),
            Txn.application_id() == Global.current_application_id(),
        )
    )

@app.external
def write_to_price_box(
    response_type_bytes: abi.DynamicBytes,
    response_body_bytes: abi.DynamicBytes,
):
    return Seq(
        (response_body := abi.make(ResponseBody)).decode(response_body_bytes.get()),        
        response_body.oracle_return_value
        .store_into(oracle_return_value := abi.make(abi.DynamicArray[abi.Byte])),
        (user_vote := abi.make(UserVote)).decode(Substring(
                oracle_return_value._stored_value.load(),
                Int(2),
                Len(oracle_return_value._stored_value.load())
        )),
        user_vote.box_name.store_into(box_name := abi.make(abi.DynamicBytes)),
        user_vote.price_box.store_into(price_box := abi.make(PriceBoxTuple)),
        price_box.price.store_into(price := abi.make(abi.Uint64)),
        Assert(
            price.get() == Int(1)
        ),
        verify_app_call(),
        App.box_put(box_name.get(),price_box.encode())
    )

@app.external
def send_request(
    box_name: abi.DynamicBytes,
    key: abi.DynamicBytes,
    token_asset_id: abi.Uint64,
    source_arr: abi.DynamicArray[SourceSpec],
    agg_method: abi.Uint32,
    user_data: abi.DynamicBytes,
    main_app_reference: abi.Application
):
    
    return Seq(
        # TODO: modified gora_pyteal_utils make_request, didn't want to modify original since others were using it, but can do later or in this branch
        # request_args
        Assert(MAIN_APP_ID == Txn.applications[1]),
        (request_tuple := abi.make(RequestSpec)).set(
            source_arr,
            agg_method,
            user_data
        ),

        # destination
        (app_id_param := abi.Uint64()).set(Txn.applications[0]),
        (method_sig_param := abi.DynamicBytes()).set(Bytes(write_to_price_box.method_signature())),
        (destination_tuple := abi.make(DestinationSpec)).set(
            app_id_param,
            method_sig_param
        ),

        # type
        (request_type_param := abi.Uint64()).set(Int(1)),

        # key
        # simple enough that it's simply in the method args below

        # app_refs
        (current_app_id := abi.make(abi.Uint64)).set(Global.current_application_id()),
        (app_refs := abi.make(abi.StaticArray[abi.Uint64,L[1]])).set([current_app_id]),
        
        # asset_refs
        (asset_refs := abi.make(abi.StaticArray[abi.Uint64,L[1]])).set([token_asset_id]),
        
        # account_refs
        (current_app_addr := abi.make(abi.Address)).set(Global.current_application_address()),
        (accounts_refs:= abi.make(abi.StaticArray[abi.Address,L[1]])).set([current_app_addr]),
        
        # box_refs
        (price_box := abi.make(BoxType)).set(box_name,current_app_id),
        (box_refs := abi.make(abi.DynamicArray[BoxType])).set([price_box]),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.MethodCall(
            app_id= MAIN_APP_ID,
            method_signature=get_method_signature("request","main"),
            args=[
                request_tuple.encode(),
                destination_tuple.encode(),
                request_type_param.encode(),
                key.encode(),
                app_refs.encode(),
                asset_refs.encode(),
                accounts_refs.encode(),
                box_refs.encode()
            ]
        ),
        InnerTxnBuilder.Submit(),
    )

@app.external
def opt_in_gora(
    asset_reference: abi.Asset,
    main_app_reference: abi.Application,
):
    return Seq(
        Assert(Txn.sender() == Global.creator_address()),
        opt_in_asset(Txn.assets[0]),
        gora_opt_in(Txn.applications[1])
    )

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    MAIN_APP_ID = Int(params['MAIN_APP_ID'])
    MAIN_APP_ADDRESS = Bytes(algosdk.encoding.decode_address(algosdk.logic.get_application_address(params['MAIN_APP_ID'])))
    app.build(client=beaker.sandbox.get_algod_client()).export("./assets/default_consumer/artifacts")