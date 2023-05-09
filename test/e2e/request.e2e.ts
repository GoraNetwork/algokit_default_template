import util from "util";
import{
  Algodv2,
  Account,
  SuggestedParams,
  getApplicationAddress
} from "algosdk";
import {
  parseAppState
} from "algoutils";

import {
  request,
  subscribe
} from "../../assets/transactions/request_transactions";

import {
  init,
  userOptIn
} from "../../assets/transactions/main_transactions";

import {
  commonTestSetup
} from "./main_common";

import {
  DestinationType,
  RequestArgsType,
  SubscriptionType,
} from "../../utils/abi_types";

import { depositAlgo, depositToken, stake } from "../../assets/transactions/staking_transactions";
import { getGlobalStateMain, getLocalStateMain, testAssert } from "../../utils/gora_utils";
import { fundAccount } from "algotest";
import accounts from "../test_fixtures/accounts.json";
import errorCodes from "../../assets/smart_assert_errors.json";

import {
  AccountGenerator,
} from "./vote/voting.helpers";

describe("request e2e", () => {
  let appId: number;
  let algodClient: Algodv2;
  let platformTokenAssetId: number;
  let user: Account;
  let suggestedParams: SuggestedParams;
  let accountGenerator: AccountGenerator;
  
  function make_generic_args(): [string, string, number, string, number, number]
  {
    const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1";
    const path = "market_cap";
    const appID = appId;
    const signature = "test(uint64)";
    const interval = 256;
    const num_execs = 32;
    return [url, path, appID, signature, interval, num_execs];
  }

  function encode_args(url: string, path: string, appId: number, signature: string, interval: number, num_execs: number)
  {
    const url_buf : Uint8Array = new Uint8Array(Buffer.from(url));
    const path_buf : Uint8Array = new Uint8Array(Buffer.from(path));
    const signature_buf : Uint8Array = new Uint8Array(Buffer.from(signature));
    const userdata = new Uint8Array(Buffer.from("Hello world"));
    const source_id = 0;
    const requestArgs = RequestArgsType.encode([ [[source_id, [url_buf, path_buf], 60]], 0, userdata]);
    const destination = DestinationType.encode([appId, signature_buf]);
    const subscription_arg = SubscriptionType.encode([interval, num_execs]);

    return[requestArgs, destination, subscription_arg];
  }

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);

    const testParameters = await commonTestSetup(accountGenerator);
    appId = testParameters.appId;
    algodClient = testParameters.algodClient;
    platformTokenAssetId = testParameters.platformTokenAssetId;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;

    const optInGroup = userOptIn(
      {
        user, 
        appId, 
        suggestedParams,
      }
    );

    await optInGroup.execute(algodClient, 5);
  });

  it("should make a valid request", async () => {
    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination] = encode_args(url, path, appID, signature, interval, num_execs);

    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );

    await initGroup.execute(algodClient, 5);
    await fundAccount(user.addr,1e9);
    const algoDepositAmount = 1e9;
    const depositAlgoGroup = depositAlgo(
      { 
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: algoDepositAmount
      }
    );

    await depositAlgoGroup.execute(algodClient, 5);

    const goraDepositAmount = 500_000_000;

    const depositTokenGroup = depositToken(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: goraDepositAmount
      }
    );
    
    await depositTokenGroup.execute(algodClient, 5);

    const requestGroup = request(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        type: 0,
        key: Buffer.from("foo"),
        appRefs: [],
        assetRefs: [],
        accountRefs: [],
        boxRefs: []
      }
    );
    await requestGroup.execute(algodClient, 5);
    const state = await getLocalStateMain(user.addr, appId, algodClient);
    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    const globalStateMain = await getGlobalStateMain(appID,algodClient);
    expect(localState["at"]).toEqual(goraDepositAmount-globalStateMain.gora_request_fee);
    expect(localState["aa"]).toEqual(algoDepositAmount-globalStateMain.algo_request_fee-60900); //TODO: not sure where 60900 comes from?

    const appInfo = await algodClient.getApplicationByID(appId).do();
    const globalState = parseAppState(appInfo.params["global-state"]);
    expect(globalState["af"]).toEqual(globalStateMain.algo_request_fee-1001); // Subtract the vote_refill_refund
    expect(globalState["tf"]).toEqual(globalStateMain.gora_request_fee);

    const requestGroup2 = request(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        type: 1,
        key: Buffer.from("foo"),
        appRefs: [],
        assetRefs: [],
        accountRefs: [],
        boxRefs: []
      }
    );

    await expect(requestGroup2.execute(algodClient, 5)).rejects.toThrow("assert failed");

    const requestGroup3 = request(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        type: 1,
        key: Buffer.from("bar"),
        appRefs: [],
        assetRefs: [],
        accountRefs: [],
        boxRefs: []
      }
    );

    await requestGroup3.execute(algodClient, 5);

  });

  it("invalid request due to too low of algo fee", async () => {

    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );
  
    await initGroup.execute(algodClient, 5);
    const encoder = new util.TextEncoder();

    const requestGroup = request(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: encoder.encode("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1, market_cap, "),
        destination: encoder.encode(String(appId) + ", test(uint64)"),
        type: 0,
        key: Buffer.from("foo"),
        appRefs: [],
        assetRefs: [],
        accountRefs: [],
        boxRefs: []
      }
    );
    await testAssert(requestGroup.execute(algodClient, 5),errorCodes[12]);
  });

  it("invalid request due to too low of token fee", async () => {
    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );
  
    await initGroup.execute(algodClient, 5);
    const encoder = new util.TextEncoder();

    const requestGroup = request(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: encoder.encode("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1, market_cap, "),
        destination: encoder.encode(String(appId) + ", test(uint64)"),
        type: 0,
        key: Buffer.from("foo"),
        appRefs: [],
        assetRefs: [],
        accountRefs: [],
        boxRefs: []
      }
    );
  
    await testAssert(requestGroup.execute(algodClient, 5),errorCodes[12]);
  });

  it("should make a valid subscription request", async () => {

    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination, subscription_arg] = encode_args(url, path, appID, signature, interval, num_execs);

    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );
  
    await initGroup.execute(algodClient, 5);

    const depositAlgoGroup = depositAlgo(
      { 
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 500
      }
    );

    await depositAlgoGroup.execute(algodClient, 5);

    const depositTokenGroup = depositToken(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 500
      }
    );

    await depositTokenGroup.execute(algodClient, 5);

    const requestGroup = subscribe(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        subscription: subscription_arg,
        type: 0,
      }
    );
  
    await requestGroup.execute(algodClient, 5);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const localState = parseAppState(accountAppInfo["app-local-state"]["key-value"]);
    expect(localState["lt"]).toEqual(10);
  });

  it("valid subscription request, but not enough algo in account", async () => {
    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination, subscription_arg] = encode_args(url, path, appID, signature, interval, num_execs);

    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );
  
    await initGroup.execute(algodClient, 5);

    const stakingTokenGroup = stake(
      {
        platformTokenAssetId: platformTokenAssetId, 
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 500
      }
    );

    await stakingTokenGroup.execute(algodClient, 5);

    const requestGroup = subscribe(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        subscription: subscription_arg,
        type: 0,
      }
    );
  
    await expect(requestGroup.execute(algodClient, 5)).rejects.toThrowError("would result negative");
  });

  it("valid subscription request, but not enough token in account", async () => {
    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination, subscription_arg] = encode_args(url, path, appID, signature, interval, num_execs);

    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );
  
    await initGroup.execute(algodClient, 5);

    const stakingAlgoGroup = stake(
      {
        platformTokenAssetId: platformTokenAssetId, 
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 500
      }
    );

    await stakingAlgoGroup.execute(algodClient, 5);

    const requestGroup = subscribe(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        subscription: subscription_arg,
        type: 0,
      }
    );
  
    await expect(requestGroup.execute(algodClient, 5)).rejects.toThrowError("would result negative");
  });

  it("should reject if more than 4 refs are passed", async () => {
    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination] = encode_args(url, path, appID, signature, interval, num_execs);

    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );

    await initGroup.execute(algodClient, 5);

    const depositAlgoGroup = depositAlgo(
      { 
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 109000
      }
    );

    await depositAlgoGroup.execute(algodClient, 5);

    const depositTokenGroup = depositToken(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 500
      }
    );
    
    await depositTokenGroup.execute(algodClient, 5);

    const requestGroup = request(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        type: 0,
        key: Buffer.from("foo"),
        appRefs: [1, 2, 3, 4],
        assetRefs: [1],
        accountRefs: [],
        boxRefs: []
      }
    );
    await expect(requestGroup.execute(algodClient, 5)).rejects.toThrow();
  });

  it("should allow all ref types", async () => {
    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination] = encode_args(url, path, appID, signature, interval, num_execs);

    // fund main contract
    await fundAccount(getApplicationAddress(appId), 101_000); // To account for opting in and the cost of the opt in txn

    const initGroup = init(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        manager: user.addr
      }
    );

    await initGroup.execute(algodClient, 5);

    const depositAlgoGroup = depositAlgo(
      { 
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 109000
      }
    );

    await depositAlgoGroup.execute(algodClient, 5);

    const depositTokenGroup = depositToken(
      {
        platformTokenAssetId: platformTokenAssetId,
        user: user, 
        appId: appId, 
        suggestedParams: suggestedParams,
        amount: 500_000_000
      }
    );
    
    await depositTokenGroup.execute(algodClient, 5);
    
    const requestGroup = request(
      {
        user: user, 
        appID: appId,
        suggestedParams: suggestedParams,
        request_args: request_args,
        destination: destination,
        type: 0,
        key: Buffer.from("foo"),
        appRefs: [1],
        assetRefs: [1],
        accountRefs: [user.addr],
        boxRefs: [[Uint8Array.from(Buffer.from("test", "ascii")),123]]
      }
    );
    await requestGroup.execute(algodClient, 5);
  });
});
