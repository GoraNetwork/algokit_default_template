# pylint: disable=E0611, E1121, E1101
from typing import Final
import json
import sys
import os

sys.path.append('.')
from pyteal import *
from beaker import *
from beaker.lib.storage.mapping import Mapping
import algosdk
from typing import Literal as L
from assets.helpers.key_map import key_map
from assets.vesting.abi_structures import VestingEntry, VestingKey

class Vesting(Application):
    vesting_box = Mapping(VestingKey, VestingEntry)
    whitelisted_delegation_apps = Mapping(abi.Uint64, abi.StaticBytes[L[0]])

    def __init__(self, version: int = ...):
        super().__init__(version)

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
    
    @internal(TealType.none)
    def send_algo(self, receiver, amount):
        return Seq([
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.Payment,
                TxnField.receiver: receiver,
                TxnField.amount: amount,
            }),
            InnerTxnBuilder.Submit()
        ])

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
            Reject()
        ])
    
    @delete
    def delete(
        self
    ):
        return Seq([
            Reject()
        ])
    
    @external()
    def optin_asset(
        self,
        algo_xfer: abi.PaymentTransaction,
        asset_id: abi.Asset
    ):
        return Seq([
            Assert(algo_xfer.get().amount() == Int(200_000)),
            (asset_id_int := abi.Uint64()).set(asset_id.asset_id()),
            (receiver := abi.Address()).set(Global.current_application_address()),
            self.send_asset(asset_id_int.get(), receiver.get(), Int(0))
        ])

    @external()
    def vest_tokens(
        self,
        algo_xfer: abi.PaymentTransaction,
        token_xfer: abi.AssetTransferTransaction,
        vest_to : abi.Address,
        vesting_key: abi.DynamicBytes,
        time_to_vest: abi.Uint64,
    ):
        return Seq([
            (algo_xfer_amount := abi.Uint64()).set(algo_xfer.get().amount()),
            Assert(algo_xfer_amount.get() == Int(4200) + (Int(400) * (Int(abi.size_of(VestingKey)) + Int(abi.size_of(VestingEntry))) )), # 4200 + (400 * (73 + 64)) = 59,000
            (token_xfer_asset := abi.Uint64()).set(token_xfer.get().xfer_asset()),
            (vest_amount := abi.Uint64()).set(token_xfer.get().asset_amount()),
            (start_time := abi.Uint64()).set(Global.latest_timestamp()),
            (amount_claimed := abi.Uint64()).set(Int(0)),         

            time_to_vest.set(time_to_vest.get() + Global.latest_timestamp()),
            (key_hash := abi.StaticBytes(abi.StaticBytesTypeSpec(32))).set(Sha512_256(Concat(Itob(token_xfer_asset.get()), Txn.sender(), vesting_key.get()))),
            (key := VestingKey()).set(vest_to, key_hash),
            (vester := abi.Address()).set(Txn.sender()),
            (staked := abi.Bool()).set(False),
            (entry := VestingEntry()).set(start_time, time_to_vest, token_xfer_asset, vest_amount, amount_claimed, vester, staked),
            self.vesting_box[key].set(entry)
        ])
    
    @external()
    def claim_vesting(
        self,
        vestee: abi.Address,
        key_hash: abi.StaticBytes[L[32]],
        asset_ref: abi.Asset,
        receiver_ref: abi.Account,
    ):
        return Seq([
            (box_key := VestingKey()).set(vestee, key_hash),

            (entry := VestingEntry()).decode(self.vesting_box[box_key].get()),

            (entry_start_time := abi.Uint64()).set(entry.start_time.use(lambda value: value.get())),
            (entry_unlock_time := abi.Uint64()).set(entry.unlock_time.use(lambda value: value.get())),
            (entry_amount_claimed := abi.Uint64()).set(entry.amount_claimed.use(lambda value: value.get())),

            (entry_asset := abi.Uint64()).set(entry.token_id),
            (entry_amount := abi.Uint64()).set(entry.amount),
            (entry_vester := abi.Address()).set(entry.vester),
            (amount_claimable := abi.Uint64()).set(Int(0)),

            # Either able to claim the full amount, or the amount that is claimable
            If(entry_unlock_time.get() > Global.latest_timestamp()).Then(
                    (total_time_span := abi.Uint64()).set(entry_unlock_time.get() - entry_start_time.get()),
                    (time_elapsed := abi.Uint64()).set(Global.latest_timestamp() - entry_start_time.get()),
                    amount_claimable.set(
                        # Higher precision by multiplying first, then dividing
                        # dy = (amount * time elapsed) / dx
                        # subtract the amount already claimed
                        ((entry_amount.get() * time_elapsed.get()) / total_time_span.get()) - entry_amount_claimed.get()
                    ),
            ).Else(
                    amount_claimable.set(entry_amount.get() - entry_amount_claimed.get()),
            ),

            self.send_asset(entry_asset.get(), vestee.get(), amount_claimable.get()),

            # Update the amount claimed or delete the entry
            If(entry_amount_claimed.get() + amount_claimable.get() == entry_amount.get()).Then(
                Pop(self.vesting_box[box_key].delete()),
                #refund the vestor for the box.
                self.send_algo(entry_vester.get(), (Int(4200) + (Int(400) * (Int(abi.size_of(VestingKey)) + Int(abi.size_of(VestingEntry))))) - Int(1000) )
            ).Else(
                entry_amount_claimed.set(entry_amount_claimed.get() + amount_claimable.get()),
                (entry_staked := abi.Bool()).set(entry.staked.use(lambda value: value.get())),
                # Create a new VestingEntry() with the updated amount_claimed
                (entry := VestingEntry()).set(entry_start_time, entry_unlock_time, entry_asset, entry_amount, entry_amount_claimed, entry_vester, entry_staked),
                self.vesting_box[box_key].set(entry),
            ),
        ])
    
    @external()
    def stake_to_delegator(
        self,
        delegator: abi.Application,
        key_hash: abi.StaticBytes[L[32]], #the vesting hash
        main_app_ref: abi.Application,
        asset_reference: abi.Asset,
        manager_reference: abi.Account,
    ):
        delegator_addr = AppParam.address(delegator.application_id())

        return Seq([
            delegator_addr,
            (whitelist_key := abi.Uint64()).set(delegator.application_id()),
            Assert(self.whitelisted_delegation_apps[whitelist_key].exists()),

            (sender := abi.Address()).set(Txn.sender()),
            (box_key := VestingKey()).set(sender, key_hash),
            (entry := VestingEntry()).decode(self.vesting_box[box_key].get()),
            (entry_asset := abi.Uint64()).set(entry.token_id),
            (entry_amount := abi.Uint64()).set(entry.amount),
            (entry_unlock_time := abi.Uint64()).set(entry.unlock_time),
            (entry_vester := abi.Address()).set(entry.vester),
            (entry_staked := abi.Bool()).set(entry.staked),
            (start_time := abi.Uint64()).set(Global.latest_timestamp()),
            (amount_claimed := abi.Uint64()).set(Int(0)),         

            Assert(entry_staked.get() == Int(0)),
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.MethodCall(
                app_id=delegator.application_id(),
                method_signature="stake(axfer,account,application,asset,account)void",
                args=[
                    {
                        TxnField.type_enum: TxnType.AssetTransfer,
                        TxnField.asset_amount: entry_amount.get(),
                        TxnField.xfer_asset: entry_asset.get(),
                        TxnField.asset_receiver: delegator_addr.value()
                    },
                    Txn.sender(),
                    main_app_ref,
                    asset_reference,
                    manager_reference
                ],
            ),
            InnerTxnBuilder.Submit(),

            entry_staked.set(True),
            (entry := VestingEntry()).set(start_time, entry_unlock_time, entry_asset, entry_amount, amount_claimed, entry_vester, entry_staked),
            self.vesting_box[box_key].set(entry)
        ])
    
    @external()
    def withdraw_from_delegator(
        self,
        delegator: abi.Application,
        key_hash: abi.StaticBytes[L[32]], #the vesting hash
        main_app_ref: abi.Application,
        asset_reference: abi.Asset,
        manager_reference: abi.Account,
    ):
        delegator_addr = AppParam.address(delegator.application_id())

        return Seq([
            delegator_addr,

            (sender := abi.Address()).set(Txn.sender()),
            (box_key := VestingKey()).set(sender, key_hash),
            (entry := VestingEntry()).decode(self.vesting_box[box_key].get()),
            (entry_asset := abi.Uint64()).set(entry.token_id),
            (entry_amount := abi.Uint64()).set(entry.amount),
            (entry_unlock_time := abi.Uint64()).set(entry.unlock_time),
            (entry_vester := abi.Address()).set(entry.vester),
            (entry_staked := abi.Bool()).set(entry.staked),
            (entry_amount_claimed := abi.Uint64()).set(entry.amount_claimed),
            (entry_start_time := abi.Uint64()).set(entry.start_time),

            Assert(entry_staked.get() == Int(1)),
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.MethodCall(
                app_id=delegator.application_id(),
                method_signature="withdraw_non_stake(account,asset,application,account)void",
                args=[
                    Txn.sender(),
                    asset_reference,
                    main_app_ref,
                    manager_reference
                ],
            ),
            InnerTxnBuilder.Submit(),

            entry_staked.set(False),
            (entry := VestingEntry()).set(entry_start_time, entry_unlock_time, entry_asset, entry_amount, entry_amount_claimed, entry_vester, entry_staked),
            self.vesting_box[box_key].set(entry)
        ])

    @external(authorize=Authorize.only(Global.creator_address()))
    def add_whitelisted_app(
        self,
        algo_xfer: abi.PaymentTransaction,
        app_id: abi.Application,
    ):
        return Seq([
            Assert(algo_xfer.get().amount() == Int(4200) + (Int(400) * (Int(abi.size_of(abi.Uint64))))),
            Assert(algo_xfer.get().receiver() == Global.current_application_address()),
            (app_id_abi := abi.Uint64()).set(app_id.application_id()),
            self.whitelisted_delegation_apps[app_id_abi].set(Bytes("")),
        ])