from typing import Literal as L
import beaker
import os
import sys
import yaml
import algosdk
from dotenv import load_dotenv
load_dotenv()

path = os.getcwd()
parent = os.path.dirname(path)
sys.path.append(parent)
default_app_path = path + "/default_app"
protocol_filepath = path + "/protocol"
sys.path.append(".")

from abi_structures import *
from protocol.assets.helpers.key_map import key_map as protocol_key_map
from protocol.utils.gora_pyteal_utils import opt_in as gora_opt_in,get_method_signature,opt_in_asset
from protocol.utils.abi_types import *

MLKEYMAP = protocol_key_map['main_local']
VGKEYMAP = protocol_key_map['voting_global']
RSKEYMAP = protocol_key_map['request_status']

MAIN_APP_ID = Int(0)
MAIN_APP_ADDRESS = Bytes("")
DEMO_MODE = False

class MyState:
    box_name = beaker.GlobalStateValue(TealType.bytes)

app = beaker.Application("DefaultApp",state=MyState(),build_options=beaker.BuildOptions(avm_version=8))

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

def verify_app_call():
    # assert that this is coming from a voting contract
    voting_contract_creator = App.globalGetEx(Global.caller_app_id(),VGKEYMAP["creator"])
    vote_app_creator = AppParam.creator(Global.caller_app_id())

    return Seq(
        vote_app_creator,
        voting_contract_creator,
        Assert(
            vote_app_creator.value() == MAIN_APP_ADDRESS,
            vote_app_creator.value() == voting_contract_creator.value(),
            Txn.application_id() == Global.current_application_id(),
        )
    )

@app.external
def write_to_data_box(
    response_type_bytes: abi.DynamicBytes,
    response_body_bytes: abi.DynamicBytes,
):
    verify = verify_app_call()
    if DEMO_MODE:
        verify = Assert(Int(1) == Int(1))

    return Seq(
        (response_body := abi.make(ResponseBody)).decode(response_body_bytes.get()),        
        response_body.oracle_return_value
        .store_into(oracle_return_value := abi.make(abi.DynamicArray[abi.Byte])),
        Pop(App.box_delete(app.state.box_name.get())),
        # the plus 2 is to account for the length indicator for dynamic abi arrays
        Pop(App.box_create(app.state.box_name.get(),oracle_return_value.length()+Int(2))),
        verify,
        App.box_put(app.state.box_name.get(),oracle_return_value.encode())
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
        app.state.box_name.set(box_name.get()),
        # request_args
        Assert(MAIN_APP_ID == Txn.applications[1]),
        (request_tuple := abi.make(RequestSpec)).set(
            source_arr,
            agg_method,
            user_data
        ),

        # destination
        (app_id_param := abi.Uint64()).set(Txn.applications[0]),
        (method_sig_param := abi.DynamicBytes()).set(Bytes(write_to_data_box.method_signature())),
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
        (data_box := abi.make(BoxType)).set(box_name,current_app_id),
        (box_refs := abi.make(abi.DynamicArray[BoxType])).set([data_box]),
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
    MAIN_APP_ID = Int(params["MAIN_APP_ID"])
    MAIN_APP_ADDRESS = Bytes(algosdk.encoding.decode_address(algosdk.logic.get_application_address(params['MAIN_APP_ID'])))
    DEMO_MODE = params["DEMO_MODE"]
    app_spec = app.build(beaker.localnet.get_algod_client()).export(default_app_path + "/artifacts/")
