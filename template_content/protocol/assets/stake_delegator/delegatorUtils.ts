import * as fs from "fs";
import * as bkr from "beaker-ts";
import {
  decodeUint64,
  Algodv2,
  Account,
} from "algosdk";
import {
  TimeoutTracker,
  Aggregation,
  LocalAggregationTracker,
  RewardsTracker,
  VestingTracker
} from "./abi_structures";
import { compileBeaker, sendGenericPayment } from "../../utils/beaker_test_utils";
import { MockMain } from "./artifacts/mock_main/mockmain_client";
import { StakeDelegator } from "./artifacts/stakedelegator_client";
import { fundAccount } from "algotest";
import { VotingTestState } from "../../test/e2e/vote/voting.helpers";
import { registerVoter } from "../transactions/vote_transactions";
import { depositAlgo, depositToken, stake } from "../transactions/staking_transactions";
import { sendASA } from "algoutils";

export const getAppBoxes = async (app_id: number, algodClient? : Algodv2) =>
{
  const output: any = {};
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const boxesResponse = await algodClient.getApplicationBoxes(app_id).do();
  const boxNames = boxesResponse.boxes.map(box => box.name);

  const aggregation_boxes: any = [];
  for(let i = 0; i < boxNames.length; i++)
  {   
    const name = boxNames[i];
    const box = await algodClient.getApplicationBoxByName(app_id, name).do();
    const boxName = new TextDecoder("utf-8").decode(box.name);
    const boxValue = box.value;
  }
  //aggregation_boxes.sort((a : any, b : any) => (a.box_round > b.box_round) ? 1 : -1);
  return output;
};

export async function getGlobal( app_id: number, algodClient? : Algodv2) {
  const output: any = {};
  const output_step: any = {};
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const app_info = await algodClient.getApplicationByID(app_id).do();
  const state = app_info.params["global-state"];
  for(let i = 0; i < state.length; i++)
  {
    output_step[Buffer.from(state[i].key, "base64").toString()] = state[i].value;
  }
  const previous_aggregation_raw = Aggregation.decode(Buffer.from(output_step["gmra"].bytes, "base64"));
  const aggregation_round_tuple : any = TimeoutTracker.decode(Buffer.from(output_step["ar"].bytes, "base64"));
  const previous_rewards = previous_aggregation_raw[1] as any;
  const previous_aggregation = {
    round_number: Number(aggregation_round_tuple[0]) - 1,
    execution_time: Number(previous_aggregation_raw[0]),
    algo_rewards: Number(previous_rewards[0]),
    gora_rewards: Number(previous_rewards[1]),
  }; 
  output["global_stake_time"] = Buffer.from(output_step["gst"].bytes, "base64").length ? decodeUint64(Buffer.from(output_step["gst"].bytes, "base64"), "safe") : 0;
  output["aggregation_round"] = Number(aggregation_round_tuple[0]);
  output["algorand_start_round"] = Number(aggregation_round_tuple[1]);
  output["goracle_timeout"] = Number(aggregation_round_tuple[2]);
  output["last_update"] = output_step["glut"].uint;
  output["pending_withdrawals"] = decodeUint64(Buffer.from(output_step["pw"].bytes, "base64"), "safe");
  output["pending_deposits"] = decodeUint64(Buffer.from(output_step["pd"].bytes, "base64"), "safe");
  output["goracle_local_stake"] = decodeUint64(Buffer.from(output_step["gs"].bytes, "base64"), "safe");
  output["previous_aggregation"] = previous_aggregation;
  output["manager_address"] = Buffer.from(output_step["m"].bytes, "base64");
  output["manager_algo_share"] = output_step["mas"].uint / 1000;
  output["manager_gora_share"] = output_step["mgs"].uint / 1000;
  return output;
}

export async function getLocal( app_id: number, address: string, algodClient? : Algodv2) {
  const output: any = {};
  const output_step: any = {};
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const app_info = await algodClient.accountApplicationInformation(address, app_id).do();
  const state = app_info["app-local-state"]["key-value"];
  for(let i = 0; i < state.length; i++)
  {
    output_step[Buffer.from(state[i].key, "base64").toString()] = state[i].value;
  }
  const local_aggregation_tracker_tuple = LocalAggregationTracker.decode(Buffer.from(output_step["lat"].bytes, "base64"));
  const previous_global_aggregation = local_aggregation_tracker_tuple[0] as any;
  const local_aggregation_tracker = 
    {
      previous_round: Number(previous_global_aggregation[0]),
      previous_round_algo_rewards: Number(previous_global_aggregation[1][0]),
      previous_round_gora_rewards: Number(previous_global_aggregation[1][1]),
      amount: Number(local_aggregation_tracker_tuple[1]),
      is_deposit: local_aggregation_tracker_tuple[2]
    };
  const local_non_stake_tuple = RewardsTracker.decode(Buffer.from(output_step["lns"].bytes, "base64"));
  const local_non_stake = 
    {
      algo: Number(local_non_stake_tuple[0]),
      gora: Number(local_non_stake_tuple[1])
    };
  const vesting_tracker_tuple = VestingTracker.decode(Buffer.from(output_step["vt"].bytes, "base64"));
  const vesting_tracker = {
    vesting_amount: Number(vesting_tracker_tuple[0]),
    vesting_app: Number(vesting_tracker_tuple[1])
  };

  output["vesting_tracker"] = vesting_tracker;
  output["local_aggregation_tracker"] = local_aggregation_tracker;
  output["local_non_stake"] = local_non_stake;
  output["stake"] = Buffer.from(output_step["ls"].bytes).length ? decodeUint64(Buffer.from(output_step["ls"].bytes, "base64"), "safe") : 0;
  output["last_update_time"] = output_step["lut"].uint;
  return output;
}

export async function getMockMainLocal( app_id: number, address: string, algodClient? : Algodv2) {
  const output: any = {};
  const output_step: any = {};
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const app_info = await algodClient.accountApplicationInformation(address, app_id).do();
  const state = app_info["app-local-state"]["key-value"];
  for(let i = 0; i < state.length; i++)
  {
    output_step[Buffer.from(state[i].key, "base64").toString()] = state[i].value;
  }
  const account_algo = output_step["aa"].uint;
  const account_gora = output_step["at"].uint;
  output["rewards"] = {algo_rewards: Number(account_algo), gora_rewards: Number(account_gora)};
  return output;
}

export async function getPredictedLocal( app_id: number, address: string, algodClient? : Algodv2) {
  const output: any = {};
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const current_global = await getGlobal(app_id);
  const current_status = await algodClient.status().do();
  const current_round = current_status["last-round"];
  const predicted_aggregations_since = Math.floor((current_round - current_global.algorand_start_round) / 10) ? 1 : 0;
  current_global.aggregation_round += predicted_aggregations_since;
  current_global.global_stake_time += (current_global.goracle_local_stake * predicted_aggregations_since);
  const current_local = await getLocal(app_id, address);
  const time_since_last_update =  current_global.aggregation_round - current_local["last_update_time"];
  let adjustment = 0;

  //need to apply stake that may have gone through since
  const last_aggregation = current_local["local_aggregation_tracker"];
  let local_stake = current_local["stake"];
  const predicted_non_stake = current_local["local_non_stake"];
  //apply stakes that was part of a participation round that you have previously participated in, but haven't confirmed since.

  if(last_aggregation["is_deposit"])
  {
    local_stake += last_aggregation.amount;
    predicted_non_stake.gora -= last_aggregation.amount;
    adjustment = last_aggregation.amount;
  }
  else
  {
    local_stake -= last_aggregation.amount;
    predicted_non_stake.gora += last_aggregation.amount;
  }
  output["predicted_local_staketime"] = (local_stake * time_since_last_update) - adjustment;
  output["predicted_rewards_share_percent"] = current_global.global_stake_time ? output.predicted_local_staketime / (current_global.global_stake_time - adjustment) : 0;
  output["predicted_rewards_algo"] = output["predicted_rewards_share_percent"] * (current_global["previous_aggregation"] ? current_global["previous_aggregation"].algo_rewards : 0);
  output["predicted_rewards_gora"] = output["predicted_rewards_share_percent"] * (current_global["previous_aggregation"] ? current_global["previous_aggregation"].gora_rewards : 0);
  output["predicted_non_stake"] = predicted_non_stake;
  output["predicted_stake"] = local_stake;
  return output;
}

export async function deploy_delegator_with_mock_main(testAsset: number)
{
  const sandboxAccount = (await bkr.sandbox.getAccounts()).pop()!;
  const sandboxMockMainClient = new MockMain({
    client: bkr.clients.sandboxAlgod(),
    signer: sandboxAccount.signer,
    sender: sandboxAccount.addr,
  });
  let appCreateResults = await sandboxMockMainClient.create();
  const mockMainID = appCreateResults.appId;
  const mockMainAddress = appCreateResults.appAddress;
    
  await compileBeaker("assets/stake_delegator/stake_delegator.py", {GORA_TOKEN_ID: testAsset, MAIN_APP_ID: mockMainID});
  const program = JSON.parse(fs.readFileSync("./assets/stake_delegator/artifacts/application.json", "utf-8"));
  const approvalProgram = program.source.approval;
  const clearProgram = program.source.clear;

    
  const sandboxAppClient = new StakeDelegator({
    client: bkr.clients.sandboxAlgod(),
    signer: sandboxAccount.signer,
    sender: sandboxAccount.addr,
  });
  sandboxAppClient.approvalProgram = approvalProgram;
  sandboxAppClient.clearProgram = clearProgram;
    
  appCreateResults = await sandboxAppClient.create({extraPages: 1});
  const appId  = appCreateResults.appId;
  const appAddress = appCreateResults.appAddress;

    
  await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, mockMainAddress, 1e6);
  await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, appAddress, 1e6);
  await sandboxMockMainClient.optIn();
  await sandboxMockMainClient.init_app({asset: BigInt(testAsset)});
  await sandboxAppClient.init_app({asset: BigInt(testAsset), timelock: BigInt(10), main_app_id: BigInt(mockMainID), manager_address: sandboxAccount.addr, manager_algo_share: BigInt(0), manager_gora_share: BigInt(0)});

  return {
    "delegator_app_id": appId,
    "delegator_app_addr": appAddress,
    "mockMain_app_id": mockMainID,
    "mockMain_app_addr": mockMainAddress,
    "test_asset": testAsset
  };
}

export async function participation_optin(delegator_addr: string, testState: VotingTestState, participationAccount: Account) {
  await fundAccount(delegator_addr, 1_500_000);
  await sendASA({
    from: testState.mainAccount,
    to: delegator_addr,
    assetId: testState.platformTokenAssetId,
    amount: 20_000
  });
  // create a new map to avoid mutating the original
  const ephemeral_map_new = new Map(testState.ephemeral_map);
  ephemeral_map_new.set(delegator_addr, participationAccount);
  await fundAccount(participationAccount.addr, 1_500_000);
  await fundAccount(delegator_addr, 1_500_000);

  return ephemeral_map_new;
}