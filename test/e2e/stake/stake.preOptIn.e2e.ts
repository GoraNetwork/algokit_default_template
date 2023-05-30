import {
  Algodv2,
  Account,
  SuggestedParams,
  getApplicationAddress
} from "algosdk";
import {
  parseAppState
} from "algoutils";
import { getLocalStake } from "../../../utils/gora_utils";
import {
  init,
  userOptIn
} from "../../../assets/transactions/main_transactions";
import {
  commonTestSetup,
} from "../main_common";
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
  });

  it("user should have initialized local state", async () => {
    const optInGroup = userOptIn({
      user, 
      appId, 
      suggestedParams,
    });
      
    await optInGroup.execute(algodClient, 5);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    const localStake = await getLocalStake(user.addr,appId,algodClient);

    expect(localStake.currentLocalStake).toEqual(0);
    expect(localState["lt"]).toEqual(0);
    expect(localState["aa"]).toEqual(0);
    expect(localState["at"]).toEqual(0);
    expect(localState["pk"]).toMatch("");
  });
});