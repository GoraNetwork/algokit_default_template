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

export async function deployDefaultConsumerApp(MAIN_APP_ID: number,MAIN_APP_ADDRESS: string, adminAccount: Account,testAsset: number)
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
    
  await compileBeaker("assets/stake_delegator/stake_delegator.py", {GORA_TOKEN_ID: testAsset, MAIN_APP_ID: MAIN_APP_ID});
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
