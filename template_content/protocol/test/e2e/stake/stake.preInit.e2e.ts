import {
  Algodv2,
  Account,
  getApplicationAddress,
  SuggestedParams
} from "algosdk";
import {
  AccountAsset,
  parseAppState
} from "algoutils";

import {
  commonTestSetup
} from "../main_common";
import {
  init
} from "../../../assets/transactions/main_transactions";
import { getGlobalStake } from "../../../utils/gora_utils";
import { AccountGenerator } from "../vote/voting.helpers";

import accounts from "../../test_fixtures/accounts.json";
import { fundAccount } from "algotest";

describe("Staking e2e", () => {
  let appId: number;
  let algodClient: Algodv2;
  let platformTokenAssetId: number;
  let user: Account;
  let suggestedParams: SuggestedParams;
  let accountGenerator: AccountGenerator;

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);

    const testParameters = await commonTestSetup(accountGenerator);
    appId = testParameters.appId;
    algodClient = testParameters.algodClient;
    platformTokenAssetId = testParameters.platformTokenAssetId;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;
  });

  it("should check on_creation init", async () => {
    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init({
      platformTokenAssetId: platformTokenAssetId,
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      manager: user.addr
    });

    await initGroup.execute(algodClient, 5);

    const appAccountInfo = await algodClient.accountInformation(getApplicationAddress(appId)).do();

    const stakingAppAsset = appAccountInfo.assets.find((asset: AccountAsset) => asset["asset-id"] === platformTokenAssetId);

    expect(stakingAppAsset).toBeDefined();

    const appInfo = await algodClient.getApplicationByID(appId).do();
    const globalState = parseAppState(appInfo.params["global-state"]);
    const totalStakeInfo = await getGlobalStake(appId,algodClient);
    expect(totalStakeInfo.currentTotalStake).toEqual(0);
    expect(globalState["af"]).toEqual(0);
    expect(globalState["tf"]).toEqual(0);
  });

  it("should init to opt into token", async () => {
    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init({
      platformTokenAssetId: platformTokenAssetId,
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      manager: user.addr
    });

    await initGroup.execute(algodClient, 5);

    const appAccountInfo = await algodClient.accountInformation(getApplicationAddress(appId)).do();

    const stakingAppAsset = appAccountInfo.assets.find((asset: AccountAsset) => asset["asset-id"] === platformTokenAssetId);

    expect(stakingAppAsset).toBeDefined();
  });
});