import {
  Algodv2,
  Account,
  getApplicationAddress,
  SuggestedParams
} from "algosdk";
import {
  parseAppState
} from "algoutils";
import { getGlobalStake, getLocalStake } from "../../../utils/gora_utils";

import {
  init,
  userOptIn,
  heartbeat
} from "../../../assets/transactions/main_transactions";
import {
  stake,
  unstake,
  depositAlgo,
  depositToken,
  withdrawAlgo,
  withdrawToken
} from "../../../assets/transactions/staking_transactions";
import { waitForRounds } from "../../util/utils";
import {
  commonTestSetup
} from "../main_common";
import { AccountGenerator } from "../vote/voting.helpers";
import accounts from "../../test_fixtures/accounts.json";
import {  exec } from "child_process";
import { fundAccount } from "algotest";

describe("Staking e2e", () => {
  let appId: number;
  let algodClient: Algodv2;
  let platformTokenAssetId: number;
  let user: Account;
  let alt_user: Account;
  let suggestedParams: SuggestedParams;
  let accountGenerator: AccountGenerator;
  const TIME_LOCK = 10;

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);

    const testParameters = await commonTestSetup(accountGenerator);
    appId = testParameters.appId;
    algodClient = testParameters.algodClient;
    platformTokenAssetId = testParameters.platformTokenAssetId;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;
    alt_user = testParameters.alt_user;

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

    const optInGroup = userOptIn({
      user, 
      appId, 
      suggestedParams
    });

    await optInGroup.execute(algodClient, 5);
  });

  async function deposit(user: Account, suggestedParams: SuggestedParams, algo: boolean, amount?: number, deposit_address?: string){
    let stakingGroup;
  
    if (amount === undefined) {
      amount = 500;
    }

    if (deposit_address === undefined) {
      deposit_address = user.addr;
    }

    if(algo) {
      stakingGroup = depositAlgo({
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: amount,
        account_to_deposit_to: deposit_address
      });
    } else {
      stakingGroup = depositToken({
        platformTokenAssetId: platformTokenAssetId, 
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: amount,
        account_to_deposit_to: deposit_address
      });
    }

    await stakingGroup.execute(algodClient, 5);
  }
  
  it("should not allow user to stake/unstake many times", async () => {
    let stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      amount: 500
    });
      
    await stakingGroup.execute(algodClient, 5);

    stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      amount: 501
    });
      
    await expect(stakingGroup.execute(algodClient, 5)).rejects.toThrowError("assert failed");
  });

  it("should update stake totals for token stake after stake", async () => {
    const userInfoPre = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();
    const stakeAmount = 500;
    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      amount: stakeAmount
    });
      
    await stakingGroup.execute(algodClient, 5);
    const userInfoPost = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();
    
    expect(userInfoPre["asset-holding"]["amount"]-stakeAmount).toEqual(userInfoPost["asset-holding"]["amount"]);

    
    const addressInfo = await algodClient.accountAssetInformation(getApplicationAddress(appId), platformTokenAssetId).do();
    expect(addressInfo["asset-holding"]["amount"]).toEqual(stakeAmount);

    const appInfo = await algodClient.getApplicationByID(appId).do();
    const totalStakeInfo = await getGlobalStake(appId,algodClient);
    expect(totalStakeInfo.currentTotalStake).toEqual(stakeAmount);
  });

  it("should update stake totals for token stake after unstake", async () => {
    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      amount: 750
    });
      
    await stakingGroup.execute(algodClient, 5);
    const userInfoPre = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();

    deposit(user, suggestedParams, true, 3000);
    const unstakeAmount = 250;

    await waitForRounds(TIME_LOCK + 1);
    
    const unstakingGroup = unstake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      amount: unstakeAmount
    });
      
    await unstakingGroup.execute(algodClient, 5);

    const userInfoPost = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();
    expect(userInfoPre["asset-holding"]["amount"]+unstakeAmount).toEqual(userInfoPost["asset-holding"]["amount"]);

    const addressInfo = await algodClient.accountAssetInformation(getApplicationAddress(appId), platformTokenAssetId).do();
    expect(addressInfo["asset-holding"]["amount"]).toEqual(500);

    const localStake = await getLocalStake(user.addr,appId,algodClient);
    expect(localStake.currentLocalStake).toEqual(500);

    const totalStakeInfo = await getGlobalStake(appId,algodClient);
    expect(totalStakeInfo.currentTotalStake).toEqual(500);
  });

  it("should update stake history after staking and unstaking", async () => {
    const initialTotalStake = await getGlobalStake(appId,algodClient);
    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      amount: 750
    });
      
    await stakingGroup.execute(algodClient, 5);
    
    const totalStake = await getGlobalStake(appId,algodClient);

    deposit(user, suggestedParams, true, 3000);
    await waitForRounds(TIME_LOCK + 1);
    const unstakeAmount = 250;
    const unstakingGroup = unstake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      amount: unstakeAmount
    });
      
    await unstakingGroup.execute(algodClient, 5);

    const finalTotalStake = await getGlobalStake(appId,algodClient);
    expect(finalTotalStake.currentTotalStake).toEqual(totalStake.currentTotalStake-unstakeAmount);
    expect(finalTotalStake.historicalTotalStake).toEqual(totalStake.currentTotalStake);
  });

  it("should update account token totals with deposit", async () => {
    const userInfoPre = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();

    await deposit(user, suggestedParams, false);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    expect(localState["at"]).toEqual(500);

    const userInfoPost = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();
    expect(userInfoPre["asset-holding"]["amount"] - 500).toEqual(userInfoPost["asset-holding"]["amount"]);
  });

  it("should update account token totals with deposit alternative depositor", async () => {
    const userInfo_pre = await algodClient.accountInformation(user.addr).do();
    await deposit(alt_user, suggestedParams, false, undefined, user.addr);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    expect(localState["at"]).toEqual(500);

    const userInfo = await algodClient.accountInformation(user.addr).do();
    expect(userInfo["amount"]).toEqual(userInfo_pre["amount"]);
  });

  it("should update account algo totals with deposit", async () => {
    const userInfoPre = await algodClient.accountInformation(user.addr).do();
    await deposit(user, suggestedParams, true);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    expect(localState["aa"]).toEqual(500);

    const userInfoPost = await algodClient.accountInformation(user.addr).do();
    expect(userInfoPre["amount"] - 500 - 2000).toEqual(userInfoPost["amount"]);
  });

  it("should update account algo totals with deposit alternative depositor", async () => {
    const userInfo_pre = await algodClient.accountInformation(user.addr).do();
    await deposit(alt_user, suggestedParams, true, undefined, user.addr);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    expect(localState["aa"]).toEqual(500);

    const userInfo = await algodClient.accountInformation(user.addr).do();
    expect(userInfo["amount"]).toEqual(userInfo_pre["amount"]);
  });

  it("should update account token totals with withdrawal", async () => {
    const depositAmount = 1500;
    const withdrawAmount = 250;
    await deposit(user, suggestedParams, true, depositAmount);
    await deposit(user, suggestedParams, false);
    const userInfoPre = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();

    const withdrawGroup = withdrawToken({ 
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams, 
      amount: withdrawAmount
    });

    await withdrawGroup.execute(algodClient, 5);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    expect(localState["at"]).toEqual(500 - withdrawAmount);

    const userInfoPost = await algodClient.accountAssetInformation(user.addr, platformTokenAssetId).do();
    expect(userInfoPre["asset-holding"]["amount"] + withdrawAmount).toEqual(userInfoPost["asset-holding"]["amount"]);
  });

  it("should fail on overwithdraw", async () => {
    await deposit(user, suggestedParams, false);

    const withdrawGroup = withdrawToken({ 
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams, 
      amount: 501
    });

    await expect(withdrawGroup.execute(algodClient, 5)).rejects.toThrowError("would result negative");
  });

  it("should update algo account totals with withdrawal", async () => {
    const depositAmount = 1500;
    await deposit(user, suggestedParams, true, depositAmount);
    const withdrawAmount = 250;
    const userInfoPre = await algodClient.accountInformation(user.addr).do();

    const withdrawGroup = withdrawAlgo({ 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams, 
      amount: withdrawAmount
    });

    await withdrawGroup.execute(algodClient, 5);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    expect(localState["aa"]).toEqual(depositAmount - withdrawAmount);

    const userInfoPost = await algodClient.accountInformation(user.addr).do();
    expect(userInfoPre["amount"]+ withdrawAmount - 2000).toEqual(userInfoPost["amount"]); // TODO: Where is the 500 from?
  });

  it("should allow heartbeat txn", async () => {
    const txn =  heartbeat({
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      ip: Buffer.from([127, 0, 0, 1]),
      port: 1234,
      network: 123
    });
    
    await txn.execute(algodClient, 5);
  });

  it("unstake (to zero)", async () => {
    // Do stake
    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId,
      user: user,
      appId: appId,
      suggestedParams: suggestedParams,
      amount: 500
    });
    await stakingGroup.execute(algodClient, 5);

    // Ensure it's in the contract
    let addressInfo = await algodClient.accountInformation(getApplicationAddress(appId)).do();
    expect(addressInfo["assets"][0]["amount"]).toEqual(500);

    // wait for time lock
    await waitForRounds(TIME_LOCK + 1);

    await fundAccount(getApplicationAddress(appId),1000);

    // Unstake
    const unstakingGroup = unstake({
      platformTokenAssetId: platformTokenAssetId,
      user: user,
      appId: appId,
      suggestedParams: suggestedParams,
      amount: 500,
    });
    await unstakingGroup.execute(algodClient, 5);

    // Ensure it's out
    addressInfo = await algodClient.accountInformation(getApplicationAddress(appId)).do();
    expect(addressInfo["assets"][0]["amount"]).toEqual(0);

  });

  it("unstake fail: amount < MINIMUM_STAKE_ALLOWED", async () => {
    // Do stake
    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId,
      user: user,
      appId: appId,
      suggestedParams: suggestedParams,
      amount: 500,
    });
    await stakingGroup.execute(algodClient, 5);

    // Ensure it's in the contract
    let addressInfo = await algodClient.accountInformation(getApplicationAddress(appId)).do();
    expect(addressInfo["assets"][0]["amount"]).toEqual(500);

    await waitForRounds(TIME_LOCK + 1);

    // Unstake
    const unstakingGroup = unstake({
      platformTokenAssetId: platformTokenAssetId,
      user: user,
      appId: appId,
      suggestedParams: suggestedParams,
      amount: 499,
    });

    await expect(unstakingGroup.execute(algodClient, 5)).rejects.toThrowError("assert failed");

    // No change in total stake
    addressInfo = await algodClient.accountInformation(getApplicationAddress(appId)).do();
    expect(addressInfo["assets"][0]["amount"]).toEqual(500);
  });


  it("stake allowed: >= MINIMUM_STAKE_ALLOWED", async () => {
    // Do stake
    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId,
      user: user,
      appId: appId,
      suggestedParams: suggestedParams,
      amount: 500
    });
    await stakingGroup.execute(algodClient, 5);
  });

  it("stake failed: < MINIMUM_STAKE_ALLOWED", async () => {
    // Do stake
    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId,
      user: user,
      appId: appId,
      suggestedParams: suggestedParams,
      amount: 250
    });
    await expect(stakingGroup.execute(algodClient, 5)).rejects.toThrowError("assert failed");
  });

});