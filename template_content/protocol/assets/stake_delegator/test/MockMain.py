# pylint: disable=E0611, E1121, E1101
from typing import Final
import json
import sys
import os
from typing import Literal as L

import yaml
sys.path.append('.')
from utils.abi_types import StakeHistoryTuple, StakeHistoryTupleAlgoSDK

from pyteal import *
from beaker import *
from beaker.lib.storage.mapping import Mapping
from abi_structures import LocalAggregationTracker, LocalAggregationTrackerAlgoSdk, RewardsTracker, RewardsTrackerAlgoSdk
import algosdk
from key_map import key_map

KEYMAP=key_map['mockMain']
GKEYMAP = KEYMAP['global']
LKEYMAP = KEYMAP['local']

stake_history_abi = abi.make(abi.StaticArray[StakeHistoryTuple,L[2]])
stake_history_abi_algosdk = algosdk.abi.ArrayStaticType(StakeHistoryTupleAlgoSDK, 2)
class MockMain(Application):

    def __init__(self, version: int = ...):
        super().__init__(version)

    account_algo: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.uint64,
        default=Int(0),
        descr="",
        key=LKEYMAP['account_algo'],
        static=False,
    )

    account_token_amount: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.uint64,
        default=Int(0),
        descr="",
        key=LKEYMAP['account_token_amount'],
        static=False,
    )

    local_stake_array: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.bytes,
        default=Bytes(stake_history_abi_algosdk.encode([StakeHistoryTupleAlgoSDK.encode([0, 0]) , StakeHistoryTupleAlgoSDK.encode([0, 0])])),
        descr="",
        key=LKEYMAP['local_stake_array'],
        static=False,
    )

    @create
    def create(
        self
    ):
        return Seq([
            self.initialize_application_state(),
        ])
        
    @opt_in
    def opt_in(
        self,
    ):
        return Seq([
            self.initialize_account_state(),
        ])

    @external(authorize=Authorize.only(Global.creator_address()))
    def init_app(
        self,
        asset : abi.Asset,
    ):
        return Seq([
            self.send_asset(asset.asset_id(), Global.current_application_address(), Int(0)),
        ])
    
    @internal(TealType.none)
    def send_asset(self, asset_id, receiver, amount):
        return Seq([
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.AssetTransfer,
                TxnField.xfer_asset: asset_id,
                TxnField.asset_receiver: receiver,
                TxnField.asset_amount: amount
            }),
            InnerTxnBuilder.Submit()
        ])
    
    @external()
    def mock_rewards(
        self,
        mock_algo : abi.Uint64,
        mock_gora : abi.Uint64,
        account: abi.Account
    ):  
        return Seq([
            App.localPut(account.address(),LKEYMAP['account_token_amount'], mock_gora.get()),
            App.localPut(account.address(),LKEYMAP['account_algo'], mock_algo.get()),
        ])
    
    @external()
    def mock_local_stake(
        self,
        amount_to_stake : abi.Uint64,
        account: abi.Account
    ): 
        return Seq([
            (zero := abi.Uint64()).set(0),
            (history := StakeHistoryTuple()).set(zero, zero),
            (globalround := abi.Uint64()).set(Global.round()),
            (current := StakeHistoryTuple()).set(globalround, amount_to_stake),
            stake_history_abi.set([history, current]),
            App.localPut(account.address(), LKEYMAP['local_stake_array'], stake_history_abi.encode()),
        ])
    
    @external()
    def withdraw_algo(
        self,
        amount_to_withdraw: abi.Uint64
    ):
        return Seq([
            App.localPut(Txn.sender(),LKEYMAP['account_algo'], Int(0)),
            Approve()
        ])
    
    @external()
    def withdraw_token(
        self,
        amount_to_withdraw: abi.Uint64,
        application_token: abi.Asset
    ):
        return Seq([
            App.localPut(Txn.sender(), LKEYMAP['account_token_amount'], Int(0)),
            Approve()
        ])
    
    @external()
    def register_participation_account(
        self,
        public_key: abi.Address,
    ):
        return Seq([
            Approve()
        ])
    
    @external()
    def stake(
        self,
        asset_transfer: abi.AssetTransferTransaction
    ):
        return Approve()
    
    @external()
    def unstake(
        self,
        amount: abi.Uint64,
        asset_reference: abi.Asset
    ):
        return Approve()

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    TEAL_VERSION = 8
    MockMain(version=TEAL_VERSION).dump("./assets/stake_delegator/artifacts/mock_main", client=sandbox.get_algod_client())