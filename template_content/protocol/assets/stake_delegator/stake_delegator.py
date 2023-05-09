# pylint: disable=E0611, E1121, E1101
from typing import Final
import json
import sys
import os
import base64
import yaml
sys.path.append('.')
from pyteal import *
from beaker import *
from beaker.lib.storage.mapping import Mapping
from abi_structures import Aggregation, AggregationAlgoSdk, LocalAggregationTracker, LocalAggregationTrackerAlgoSdk, RewardsTracker, RewardsTrackerAlgoSdk, TimeoutTracker, TimeoutTrackerAlgoSdk, VestingTracker, VestingTrackerAlgoSdk
import algosdk
from key_map import key_map
from assets.helpers.key_map import key_map as protocol_key_map
from utils.gora_pyteal_utils import opt_in as optIntoMain, stake_token, unstake_token, withdraw_algo, withdraw_token, register_key

opup = OpUp(OpUpMode.OnCall)
KEYMAP=key_map['stakeDelegator']
GKEYMAP = KEYMAP['global']
LKEYMAP = KEYMAP['local']
BKEYMAP = KEYMAP['boxes']
MLKEYMAP = protocol_key_map['main_local']

#These are placeholders, tests are expected to override the approval program with proper IDs
GORA_TOKEN_ID = Int(0)
MAIN_APP_ID = Int(0)
MAIN_APP_ADDRESS = Bytes("")
op_up_ensure_budget = Int(550)
class StakeDelegator(Application):
    def __init__(self, version: int, ):
        super().__init__(version)

#ScratchState------------------------------------------------------------------------
    userAddr = ScratchVar(TealType.bytes)

#GlobalState------------------------------------------------------------------------
    manager: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.bytes,
        default=Global.creator_address(),
        descr="Address that is able to modify manager settings and register participation keys",
        key=GKEYMAP['manager'],
        static=False,
    )
    manager_algo_share: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.uint64,
        default=Int(0),
        descr="The share of algo rewards allocated for the manager of the delegation contract",
        key=GKEYMAP['manager_algo_share'],
        static=False,
    )
    manager_gora_share: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.uint64,
        default=Int(0),
        descr="The share of gora rewards allocated for the manager of the delegation contract",
        key=GKEYMAP['manager_gora_share'],
        static=False,
    )
    global_aggregation_round: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.bytes,
        default=Bytes(TimeoutTrackerAlgoSdk.encode([1, 0, 10])),
        descr="Keeps track of current aggregation round, aggregation round start (algorand round), goracle timeout",
        key=GKEYMAP['aggregation_round'],
        static=False,
    )
    global_most_recent_aggregation: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.bytes,
        default=Bytes(AggregationAlgoSdk.encode([1, RewardsTrackerAlgoSdk.encode([0, 0]), False])),
        descr="keeps info about the most recently completed aggregation",
        key=GKEYMAP['global_most_recent_aggregation'],
        static=False,
    )
    global_stake_time: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.bytes,
        default=Itob(Int(0)),
        descr="Total staketime across all addresses",
        key=GKEYMAP['stake_time'],
        static=False,
    )
    global_stake: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.bytes,
        default=Bytes("base16", "0x00"),
        descr="Total stake across all addresses",
        key=GKEYMAP['stake'],
        static=False,
    )
    global_last_update: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.uint64,
        default=Int(0),
        descr="last aggregation round update",
        key=GKEYMAP['last_update_time'],
        static=False,
    )
    pending_deposits: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.bytes,
        default=Bytes("base16", "0x00"),
        descr="Total staketime across all addresses",
        key=GKEYMAP['pending_deposits'],
        static=False,
    )
    pending_withdrawals: Final[ApplicationStateValue] = ApplicationStateValue(
        stack_type=TealType.bytes,
        default=Bytes("base16", "0x00"),
        descr="Total staketime across all addresses",
        key=GKEYMAP['pending_withdrawals'],
        static=False,
    )
#LocalState------------------------------------------------------------------------
    last_update_time: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.uint64,
        default=Int(0),
        descr="last update time",
        key=LKEYMAP['last_update_time'],
        static=False,
    )
    local_stake: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.bytes,
        default=Bytes("base16", "0x0000"),
        descr="Total stake of address",
        key=LKEYMAP['stake'],
        static=False,
    )
    local_non_stake: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.bytes,
        default=Bytes(RewardsTrackerAlgoSdk.encode([0, 0])),
        descr="Total token in account that is not staked, due to it being a result of a withdrawal aggregation or rewards",
        key=LKEYMAP['local_non_stake'],
        static=False,
    )
    aggregation_tracker: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.bytes,
        default= Bytes(LocalAggregationTrackerAlgoSdk.encode([[0, [0, 0]] , 0, False])),
        descr="information to assist with tracking users contribution since aggregations can be delayed",
        key=LKEYMAP['local_aggregation_tracker'],
        static=False,
    )
    vesting_tracker: Final[AccountStateValue] = AccountStateValue(
        stack_type=TealType.bytes,
        default= Bytes(VestingTrackerAlgoSdk.encode([0, 0])),
        descr="if account is vesting, vesting information is stored here",
        key=LKEYMAP['vesting_tracker'],
        static=False,
    )

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
    def send_algo(self, receiver,amount):
        return Seq([
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.SetFields({
                TxnField.type_enum: TxnType.Payment,
                TxnField.receiver: receiver,
                TxnField.amount: amount
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
    
    @external(authorize=Authorize.only(Global.creator_address()))
    def init_app(
        self,
        asset : abi.Asset,
        timelock: abi.Uint64,
        main_app_id: abi.Application,
        manager_address: abi.Address,
        manager_algo_share: abi.Uint64,
        manager_gora_share: abi.Uint64
    ):
        return Seq([
            self.send_asset(asset.asset_id(), Global.current_application_address(), Int(0)),
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (abi_aggregation_round := abi.Uint64()).set(round_info.aggregation_round),
            (aggregation_round_start := abi.Uint64()).set(Global.round()),
            (goracle_timeout := abi.Uint64()).set(timelock.get()),
            round_info.set(abi_aggregation_round, aggregation_round_start, goracle_timeout),
            self.global_aggregation_round.set(round_info.encode()),
            optIntoMain(main_app_id.application_id()),
            self.manager.set(manager_address.get()),
            self.manager_algo_share.set(manager_algo_share.get()),
            self.manager_gora_share.set(manager_gora_share.get())
        ])

    @opt_in
    def opt_in(
        self,
    ):
        return Seq([
            self.initialize_account_state(),
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (current_round := abi.Uint64()).set(round_info.aggregation_round),
            self.last_update_time[self.userAddr.load()].set(current_round.get()),
        ])
    
    @delete
    def delete(
        self
    ):
        return Seq([
            Reject()
        ])
    
    #this function addresses any pending amounts from the users last stake/unstake action and applies to their stake
    @internal(TealType.uint64)
    def handle_pending(
        self,
    ):
        aggregation_round= abi.make(Aggregation)
        aggregation_round_rewards = abi.make(RewardsTracker)
        adjustment = ScratchVar(TealType.uint64)
        return Seq([
            (aggregation_tracker := LocalAggregationTracker()).decode(self.aggregation_tracker[self.userAddr.load()].get()),
            (amount := abi.Uint64()).set(aggregation_tracker.amount),
            (is_stake := abi.Bool()).set(aggregation_tracker.is_stake),

            #get the previous round you participated in
            aggregation_round.set(aggregation_tracker.most_recent_round),
            aggregation_round_rewards.set(aggregation_round.rewards_this_round),
            (aggregation_round_round := abi.Uint64()).set(aggregation_round.execution_time),

            adjustment.store(Int(0)),
            If(aggregation_round_round.get() != Int(0)).
                Then(Seq([
                    (local_non_stake := RewardsTracker()).decode(self.local_non_stake[self.userAddr.load()].get()),
                    (algo_non_stake := abi.Uint64()).set(local_non_stake.algo_rewards),
                    (gora_non_stake := abi.Uint64()).set(local_non_stake.gora_rewards),

                    If(is_stake.get()).Then(Seq([
                        (updated_stake := abi.Uint64()).set(gora_non_stake.get() - amount.get()),

                        self.local_stake[self.userAddr.load()].set(BytesAdd(self.local_stake[self.userAddr.load()].get(), Itob(amount.get()))),
                        adjustment.store(amount.get()),
                    ])).
                    Else(Seq([ #if pending was withdraw
                        (updated_stake := abi.Uint64()).set(gora_non_stake.get() + amount.get()),

                        self.local_stake[self.userAddr.load()].set(BytesMinus(self.local_stake[self.userAddr.load()].get(), Itob(amount.get()))),
                    ])),
                    local_non_stake.set(algo_non_stake, updated_stake),
                    self.local_non_stake[self.userAddr.load()].set(local_non_stake.encode()),
                    self.update_local_aggreagtion_tracker(Int(0), Int(0)),
            ])),
            Return(adjustment.load())
        ])


    #The idea for resetting_global_stake time is that this is called whenever you have already calculated your rewards over a certain
    #time period, since you have accounted for your rewards up to that point, we might as well reset the stake time to help keep math
    #cleaner and a little bit safer, whenever you change anyones local stake time, you have to also account for it in the global stake time
    @internal(TealType.none)
    def reset_global_stake_time(
        self,
        stake_time
    ):
        return Seq([
            self.global_stake_time.set( BytesMinus(self.global_stake_time.get(), stake_time) ),
        ])


    @internal(TealType.none)
    def update_stake_time(
        self,
    ):
        time_since_last_update = ScratchVar(TealType.uint64)
        return Seq([
            #get your share of the rewards since last you time you have calculated rewards
            (possible_account_rewards := RewardsTracker()).decode(self.calculate_rewards()),
            (share_algo := abi.Uint64()).set(possible_account_rewards.algo_rewards),
            (share_gora := abi.Uint64()).set(possible_account_rewards.gora_rewards),

            #get non stake that is currently in your account
            (old_non_stake := RewardsTracker()).decode(self.local_non_stake[self.userAddr.load()].get()),
            (old_non_stake_algo := abi.Uint64()).set(old_non_stake.algo_rewards),
            (old_non_stake_gora := abi.Uint64()).set(old_non_stake.gora_rewards),
            
            #new rewards would be old + new
            (new_share_algo := abi.Uint64()).set(old_non_stake_algo.get() + share_algo.get()),
            (new_share_gora := abi.Uint64()).set(old_non_stake_gora.get() + share_gora.get()),
            (total_account_rewards := RewardsTracker()).set(new_share_algo, new_share_gora),

            self.local_non_stake[self.userAddr.load()].set(total_account_rewards.encode()),
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (current_round := abi.Uint64()).set(round_info.aggregation_round),

            time_since_last_update.store(current_round.get() - self.last_update_time[self.userAddr.load()].get() ),
            self.last_update_time[self.userAddr.load()].set(current_round.get()),
        ])
    
    @internal(TealType.none)
    def assertActionTiming(
        self
    ):
        previous_aggregation = abi.make(Aggregation)
        return Seq([
            #need to assure that the user isn't making more than 1 action per aggregation round
            (old_aggregation_tracker := LocalAggregationTracker()).decode(self.aggregation_tracker[self.userAddr.load()].get()),
            previous_aggregation.set(old_aggregation_tracker.most_recent_round),
            (previous_round := abi.Uint64()).set(previous_aggregation.execution_time),
            
            (current_round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (most_recent_round := abi.Uint64()).set(current_round_info.aggregation_round),
            If(previous_round.get() != Int(0)).Then(Assert(previous_round.get() != most_recent_round.get())),
        ])

    @external()
    def stake(
        self,
        asset_pay: abi.AssetTransferTransaction,
        vesting_on_behalf_of: abi.Account,
        main_app_ref: abi.Application,
        asset_reference: abi.Asset,
        manager_reference: abi.Account,
    ):

        return Seq([
            If(vesting_on_behalf_of.address() != Global.zero_address()).
                Then(
                    self.userAddr.store(vesting_on_behalf_of.address()),
                    (vesting_info := VestingTracker()).decode(self.vesting_tracker[self.userAddr.load()].get()),
                    (vesting_app := abi.Uint64()).set(vesting_info.vesting_app_id),
                    Assert(Or(vesting_app.get() == Int(0), vesting_app.get() == Global.caller_app_id())),
                    (vesting_amount := abi.Uint64()).set(vesting_info.vested_amount),
                    vesting_amount.set(vesting_amount.get() + asset_pay.get().asset_amount()),
                    (app_id := abi.Uint64()).set(Global.caller_app_id()),
                    vesting_info.set(vesting_amount, app_id),
                    self.vesting_tracker[self.userAddr.load()].set(vesting_info.encode())
                ).
            Else(Seq([
                self.userAddr.store(Txn.sender()),
            ])),

            self.assertActionTiming(),
            Assert(asset_pay.get().xfer_asset() == GORA_TOKEN_ID),
            self.update_stake_time(),
            opup.ensure_budget(op_up_ensure_budget, fee_source=OpUpFeeSource.GroupCredit),
            self.pending_deposits.set(BytesAdd(self.pending_deposits.get(), Itob(asset_pay.get().asset_amount()))),
            self.update_local_aggreagtion_tracker(asset_pay.get().asset_amount(), Int(1)),

            #update non stake (it doesn't get counted as "official stake" until the aggregation round ends in a deposit)
            (local_non_stake := RewardsTracker()).decode(self.local_non_stake[self.userAddr.load()].get()),
            (algo_non_stake := abi.Uint64()).set(local_non_stake.algo_rewards),
            (gora_non_stake := abi.Uint64()).set(local_non_stake.gora_rewards),
            gora_non_stake.set(gora_non_stake.get() + asset_pay.get().asset_amount()),
            local_non_stake.set(algo_non_stake, gora_non_stake),
            self.local_non_stake[self.userAddr.load()].set(local_non_stake.encode()),

            self.post_action_update()
        ])

    @external()
    def unstake(
        self,
        amount_to_withdraw: abi.Uint64,
        vesting_on_behalf_of: abi.Account,
        main_app_ref: abi.Application,
        asset_reference: abi.Asset,
        manager_reference: abi.Account,
    ):
        vesting_info = abi.make(VestingTracker)
        vesting_app = abi.make(abi.Uint64)
        vesting_amount = abi.make(abi.Uint64)

        return Seq([

            #if staking through a vesting app
            If(vesting_on_behalf_of.address() != Global.zero_address()).
                Then(Seq([
                    self.userAddr.store(vesting_on_behalf_of.address()),
                ])).
            Else(Seq([ #if staking from a normal wallet
                self.userAddr.store(Txn.sender()),
            ])),

            self.assertActionTiming(),
            self.update_stake_time(),
            opup.ensure_budget(op_up_ensure_budget, fee_source=OpUpFeeSource.GroupCredit),
            self.pending_withdrawals.set(BytesAdd(self.pending_withdrawals.get(), Itob(amount_to_withdraw.get()))),
            self.update_local_aggreagtion_tracker(amount_to_withdraw.get(), Int(0)),

            self.post_action_update()
        ])
    
    @internal(TealType.none)
    def post_action_update(
        self,
    ):
        return Seq([
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (algo_round_started := abi.Uint64()).set(round_info.aggregation_round_start),
            (goracle_timelock := abi.Uint64()).set(round_info.goracle_timeout),
            If((Global.round() - algo_round_started.get()) > goracle_timelock.get()).
                    Then(self.process_aggregation()),
        ])
    
    @internal(TealType.none)
    def update_local_aggreagtion_tracker(
        self,
        amount_arg,
        is_stake_arg
    ):
        return Seq([
            (round_info := Aggregation()).decode(self.global_most_recent_aggregation.get()),
            (is_stake := abi.Bool()).set(False),
            If(is_stake_arg > Int(0)).Then(
                is_stake.set(True)
            ),
            (amount := abi.Uint64()).set(amount_arg),
            (aggregation_tracker := LocalAggregationTracker()).set(round_info, amount, is_stake),
            self.aggregation_tracker[self.userAddr.load()].set(aggregation_tracker.encode()),
        ])

    @external(authorize=Authorize.opted_in())
    def user_claim(
        self,
        pay: abi.PaymentTransaction,
        asset_reference: abi.Asset,
        main_app_reference: abi.Application,
        manager_reference: abi.Account,
    ):
        return Seq([
            Assert(pay.get().amount() == Global.min_txn_fee()),
            self.post_action_update(),
            
            self.update_stake_time(),
            (current_funds := RewardsTracker()).decode(self.local_non_stake[self.userAddr.load()].get()),
            (algo_to_withdraw := abi.Uint64()).set(current_funds.algo_rewards),
            (gora_to_withdraw := abi.Uint64()).set(current_funds.gora_rewards),
            self.send_algo(Txn.sender(), algo_to_withdraw.get()),
            self.send_asset(GORA_TOKEN_ID, Txn.sender(), gora_to_withdraw.get()),
            algo_to_withdraw.set(0),
            gora_to_withdraw.set(0),
            current_funds.set(algo_to_withdraw, gora_to_withdraw),
            self.local_non_stake[self.userAddr.load()].set(current_funds.encode()),
            self.update_local_aggreagtion_tracker(Int(0), Int(0)),
        ])
    
    @internal(TealType.bytes)
    def goracle_claim(
        self,
    ):
        get_unclaimed_rewards_algo = App.localGetEx(Global.current_application_address(), MAIN_APP_ID, MLKEYMAP['account_algo'])
        get_unclaimed_rewards_gora = App.localGetEx(Global.current_application_address(), MAIN_APP_ID, MLKEYMAP['account_token_amount'])

        return Seq([
            get_unclaimed_rewards_algo,
            get_unclaimed_rewards_gora,
            
            opup.ensure_budget(op_up_ensure_budget, fee_source=OpUpFeeSource.GroupCredit),
            If(get_unclaimed_rewards_algo.value() > Int(0)).Then(
                withdraw_algo(MAIN_APP_ID, Itob(get_unclaimed_rewards_algo.value())),
            ),
            If(get_unclaimed_rewards_gora.value() > Int(0)).Then(
                withdraw_token(MAIN_APP_ID, GORA_TOKEN_ID, Itob(get_unclaimed_rewards_gora.value())),
            ),
            
            (manager_share_algo := abi.Uint64()).set(Int(0)),
            (manager_share_gora := abi.Uint64()).set(Int(0)),
            If(App.optedIn(self.manager.get(), Global.current_application_id())).
                Then(
                    Seq([
                        (manager_historacle_account_rewards := RewardsTracker()).decode(self.local_non_stake[self.manager.get()].get()),
                        (manager_historacle_algo := abi.Uint64()).set(manager_historacle_account_rewards.algo_rewards),
                        (manager_historacle_gora := abi.Uint64()).set(manager_historacle_account_rewards.gora_rewards),
                        manager_share_algo.set((get_unclaimed_rewards_algo.value() * self.manager_algo_share.get()) / Int(1000)),
                        manager_share_gora.set((get_unclaimed_rewards_gora.value() * self.manager_gora_share.get()) / Int(1000)),
                        (manager_algo := abi.Uint64()).set(manager_historacle_algo.get() + manager_share_algo.get()),
                        (manager_gora := abi.Uint64()).set(manager_historacle_gora.get() + manager_share_gora.get()),
                        (manager_account_rewards := RewardsTracker()).set(manager_algo, manager_gora),
                        self.local_non_stake[self.manager.get()].set(manager_account_rewards.encode()),
                    ])
                ),
            (round_info := Aggregation()).decode(self.global_most_recent_aggregation.get()),
            (rewards_accumulation := RewardsTracker()).set(round_info.rewards_this_round),
            (historacle_algo := abi.Uint64()).set(rewards_accumulation.algo_rewards),
            (historacle_gora := abi.Uint64()).set(rewards_accumulation.gora_rewards),
            (algo := abi.Uint64()).set(get_unclaimed_rewards_algo.value() + historacle_algo.get() - manager_share_algo.get()),
            (gora := abi.Uint64()).set(get_unclaimed_rewards_gora.value() + historacle_gora.get() - manager_share_gora.get()),

            (account_rewards := RewardsTracker()).set(algo, gora),
            Return(account_rewards.encode())
        ])

    @internal(TealType.bytes)
    def calculate_rewards(
        self,
    ):
        previous_aggregation = abi.make(Aggregation)
        account_rewards_old = abi.make(RewardsTracker)
        account_rewards_new = abi.make(RewardsTracker)
        adjustment = ScratchVar(TealType.uint64)
        get_old_rewards = Seq([
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (current_round := abi.Uint64()).set(round_info.aggregation_round),
            (previous_round := abi.Uint64()).set(current_round.get() - Int(1)),
            If(previous_round.get() != Int(0)).
                Then(Seq([
                    (aggregation_tracker := LocalAggregationTracker()).decode(self.aggregation_tracker[self.userAddr.load()].get()),
                    previous_aggregation.set(aggregation_tracker.most_recent_round),
                    account_rewards_old.set(previous_aggregation.rewards_this_round),
                ])).
            Else(
                Seq([
                    account_rewards_old.decode(Bytes(RewardsTrackerAlgoSdk.encode([0, 0])))
                ])
            )
        ])

        get_new_rewards = Seq([
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (current_round := abi.Uint64()).set(round_info.aggregation_round),
            (previous_round := abi.Uint64()).set(current_round.get() - Int(1)),
            If(previous_round.get() != Int(0)).
                Then(Seq([
                    (aggregation_tracker := Aggregation()).decode(self.global_most_recent_aggregation.get()),
                    account_rewards_new.set(aggregation_tracker.rewards_this_round),
                ])).
            Else(
                Seq([
                    account_rewards_new.decode(Bytes(RewardsTrackerAlgoSdk.encode([0, 0])))
                ])
            )
        ])

        time_since_last_update = ScratchVar(TealType.bytes)
        tmp_stake_time = ScratchVar(TealType.bytes)
        return Seq([
            #Get most recent rewards
            get_old_rewards,
            get_new_rewards,
            adjustment.store(self.handle_pending()),
            (total_algo := abi.Uint64()).set(account_rewards_new.algo_rewards),
            (total_gora := abi.Uint64()).set(account_rewards_new.gora_rewards),

            #Get the accumulated rewards from last time we calculated rewards
            (last_total_algo := abi.Uint64()).set(account_rewards_old.algo_rewards),
            (last_total_gora := abi.Uint64()).set(account_rewards_old.gora_rewards),

            #get the amount of new rewards collected
            (new_rewards_algo := abi.Uint64()).set(total_algo.get() - last_total_algo.get()),
            (new_rewards_gora := abi.Uint64()).set(total_gora.get() - last_total_gora.get()),

            #calculate new staketime
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (current_round := abi.Uint64()).set(round_info.aggregation_round),
            time_since_last_update.store(Itob(current_round.get() - self.last_update_time[self.userAddr.load()].get())),

            tmp_stake_time.store(
                BytesMinus( 
                    BytesMul(
                        self.local_stake[self.userAddr.load()].get(), 
                        time_since_last_update.load()
                    ),
                    Itob(adjustment.load())
                )
            ),

            #get your share of the rewards, which is (<Your stake_time> / <global stake_time>) * <new rewards unlocked since last calculation>
            (share_algo := abi.Uint64()).set(0),
            (share_gora := abi.Uint64()).set(0),
            If(And(Btoi(self.global_stake_time.get()) != Int(0), Btoi(self.global_stake_time.get()) != adjustment.load(), Btoi(self.global_stake_time.get()) > adjustment.load() ) ).Then(Seq([
                share_algo.set(((new_rewards_algo.get() * Btoi(tmp_stake_time.load())) / (Btoi(self.global_stake_time.get()) - adjustment.load()) )),
                share_gora.set(((new_rewards_gora.get() * Btoi(tmp_stake_time.load())) / (Btoi(self.global_stake_time.get()) - adjustment.load()) )),
            ])),
            (owed_rewards := RewardsTracker()).set(share_algo, share_gora),
            
            self.reset_global_stake_time(tmp_stake_time.load()),
            Return(owed_rewards.encode())
        ])
    
    @internal(TealType.none)
    def process_aggregation(
        self,
    ):
        new_aggregation = abi.make(Aggregation)
        adjustment = ScratchVar(TealType.bytes)
        return Seq([
            #Get accumulated rewards from goracle main contract
            (account_rewards := RewardsTracker()).decode(self.goracle_claim()),
            (current_time := abi.Uint64()).set(Global.latest_timestamp()),
            adjustment.store(Itob(Int(0))),

            If(Btoi(self.pending_deposits.get()) > Btoi(self.pending_withdrawals.get())).
                Then(Seq([
                    self.pending_deposits.set(BytesMinus(self.pending_deposits.get(), self.pending_withdrawals.get())),
                    self.pending_withdrawals.set(Itob(Int(0))),

                    stake_token(
                        MAIN_APP_ADDRESS,
                        MAIN_APP_ID,
                        GORA_TOKEN_ID,
                        Btoi(self.pending_deposits.get())
                    ),
                    Log(Bytes("Deposit sent")),
                    self.global_stake.set(BytesAdd(self.global_stake.get(), self.pending_deposits.get())),
                    adjustment.store(self.pending_deposits.get()),
                    self.pending_deposits.set(Itob(Int(0))),
                ])).
            ElseIf(Btoi(self.pending_withdrawals.get()) > Btoi(self.pending_deposits.get())).
                Then(Seq([
                    self.pending_withdrawals.set(BytesMinus(self.pending_withdrawals.get(), self.pending_deposits.get())),
                    self.pending_deposits.set(Itob(Int(0))),

                    unstake_token(
                        MAIN_APP_ID,
                        GORA_TOKEN_ID,
                        self.pending_withdrawals.get(),
                    ),
                    Log(Bytes("Withdrawal sent")),
                    self.global_stake.set(BytesMinus(self.global_stake.get(), self.pending_withdrawals.get())),
                    self.pending_withdrawals.set(Itob(Int(0))),
                ])).
            Else(Seq([
                self.pending_withdrawals.set(Itob(Int(0))),
                self.pending_deposits.set(Itob(Int(0)))
            ])),

            new_aggregation.set(current_time, account_rewards),
            (round_info := TimeoutTracker()).decode(self.global_aggregation_round.get()),
            (abi_aggregation_round := abi.Uint64()).set(round_info.aggregation_round),
            (aggregation_round_start := abi.Uint64()).set(round_info.aggregation_round_start),
            (goracle_timeout := abi.Uint64()).set(round_info.goracle_timeout),

            self.global_most_recent_aggregation.set(new_aggregation.encode()),
            abi_aggregation_round.set(abi_aggregation_round.get() + Int(1)),
            aggregation_round_start.set(Global.round()),

            round_info.set(abi_aggregation_round, aggregation_round_start, goracle_timeout),
            self.global_aggregation_round.set(round_info.encode()),
            self.global_last_update.set(abi_aggregation_round.get()),
            self.global_stake_time.set(BytesMinus(BytesAdd(self.global_stake_time.get(), self.global_stake.get()), adjustment.load()))
        ])

    @external(authorize=Authorize.opted_in())
    def manual_process_aggregation(
        self,
        asset_reference: abi.Asset,
        main_app_reference: abi.Application,
        manager_reference: abi.Account,
    ):
        return Seq([
            Assert(Txn.fee() == Global.min_txn_fee() * Int(2)),
            #self.update_stake_time(),
            self.post_action_update(),
            #self.update_local_aggreagtion_tracker(Int(0), Int(0)),
        ])
    
    @external()
    def register_participation_key(
        self,
        new_key: abi.Address,
        main_ref: abi.Application
    ):
        return Seq([
            Assert(Txn.sender() == self.manager.get()),
            register_key(MAIN_APP_ID, new_key.get())
        ])

    @external()
    def configure_settings(
        self,
        manager_address: abi.Address,
        manager_algo_share: abi.Uint64,
        manager_gora_share: abi.Uint64
    ):
        return Seq([
            Assert(Txn.sender() == self.manager.get()),
            self.manager.set(manager_address.get()),
            self.manager_algo_share.set(manager_algo_share.get()),
            self.manager_gora_share.set(manager_gora_share.get())
        ])
    
    @external()
    def withdraw_non_stake(
        self,
        vesting_on_behalf_of: abi.Account,
        goracle_token_reference: abi.Asset,
        main_app_reference: abi.Application,
        manager_reference: abi.Account,
    ):
        vesting_info = abi.make(VestingTracker)
        vesting_app = abi.make(abi.Uint64)
        vesting_amount = abi.make(abi.Uint64)

        algo_to_withdraw = abi.make(abi.Uint64)
        gora_to_withdraw = abi.make(abi.Uint64)
        
        return Seq([
            
            #if staking through a vesting app
            If(vesting_on_behalf_of.address() != Global.zero_address()).
                Then(
                    self.userAddr.store(vesting_on_behalf_of.address()),
                ).
            Else(Seq([ #if staking from a normal wallet
                self.userAddr.store(Txn.sender()),
            ])),

            self.assertActionTiming(),
            self.update_stake_time(),
            self.post_action_update(),

            If(vesting_on_behalf_of.address() == Global.zero_address()).Then(Seq([
                vesting_info.decode(self.vesting_tracker[self.userAddr.load()].get()),
                vesting_amount.set(vesting_info.vested_amount),
                (account_non_stake := RewardsTracker()).decode(self.local_non_stake[self.userAddr.load()].get()),
                algo_to_withdraw.set(account_non_stake.algo_rewards),
                gora_to_withdraw.set(account_non_stake.gora_rewards),
                #assures that user cannot withdraw vested balance
                gora_to_withdraw.set(gora_to_withdraw.get() - vesting_amount.get()),
                If(algo_to_withdraw.get() > Int(0)).Then(self.send_algo(Txn.sender(), algo_to_withdraw.get())),
                If(gora_to_withdraw.get() > Int(0)).Then(self.send_asset(GORA_TOKEN_ID , Txn.sender(), gora_to_withdraw.get())),
                (zero := abi.Uint64()).set(Int(0)),
                account_non_stake.set(zero,zero),
                self.local_non_stake[self.userAddr.load()].set(account_non_stake.encode())
            ])).
            ElseIf(vesting_on_behalf_of.address() != Global.zero_address()).Then(
                vesting_info.decode(self.vesting_tracker[self.userAddr.load()].get()),
                vesting_app.set(vesting_info.vesting_app_id),
                vesting_amount.set(vesting_info.vested_amount),
                gora_to_withdraw.set(vesting_amount),
                vesting_amount.set(Int(0)),
                (app_id := abi.Uint64()).set(Global.caller_app_id()),
                Assert(Or(vesting_app.get() == Int(0), vesting_app.get() == Global.caller_app_id())),
                vesting_info.set(vesting_amount, app_id),
                self.vesting_tracker[self.userAddr.load()].set(vesting_info.encode()),
                self.send_asset(GORA_TOKEN_ID , Txn.sender(), gora_to_withdraw.get()),

                (account_non_stake := RewardsTracker()).decode(self.local_non_stake[self.userAddr.load()].get()),
                algo_to_withdraw.set(account_non_stake.algo_rewards),
                (gora_rewards := abi.Uint64()).set(account_non_stake.gora_rewards),
                Log(Itob(gora_rewards.get())),
                Log(Itob(gora_to_withdraw.get())),
                # gora_rewards.set(gora_rewards.get() - gora_to_withdraw.get()),
                # account_non_stake.set(algo_to_withdraw, gora_rewards),
                # self.local_non_stake[self.userAddr.load()].set(account_non_stake.encode())
            ),
        ])

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    TEAL_VERSION = 8
    GORA_TOKEN_ID = Int(params['GORA_TOKEN_ID'])
    MAIN_APP_ID = Int(params['MAIN_APP_ID'])
    MAIN_APP_ADDRESS = Bytes(algosdk.encoding.decode_address(algosdk.logic.get_application_address(params['MAIN_APP_ID'])))
    StakeDelegator(version=TEAL_VERSION).dump("./assets/stake_delegator/artifacts", client=sandbox.get_algod_client())
