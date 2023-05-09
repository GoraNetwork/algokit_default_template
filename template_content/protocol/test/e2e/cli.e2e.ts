import util from "util";
import path from "path";
import { exec } from "child_process";
import {
  Algodv2,
  Account,
  secretKeyToMnemonic,
  getApplicationAddress,
  SuggestedParams,
} from "algosdk";
import {
  loadABIContract,
  optIn,
  sendASA,
} from "algoutils";
import {
  fundAccount
} from "algotest";

import { commonTestSetup } from "./main_common";
import { optIntoContract, waitForRounds } from "../util/utils";
import {
  DestinationType,
  RequestArgsType,
  SubscriptionType,
} from "../../utils/abi_types";
import {
  AccountGenerator,
} from "./vote/voting.helpers";
import { deployConsumerContract } from "../test_fixtures/consumer_transactions";
import accounts from "../test_fixtures/accounts.json";

const execAsync = util.promisify(exec);

describe("CLI e2e", () => {
  let appId: number;
  let algodClient: Algodv2;
  let platformTokenAssetId: number;
  let user: Account;
  let suggestedParams: SuggestedParams;
  let app_config: any;
  let command_start: string;
  let deploy_main_command: string;
  let mainAccount: Account;
  const TIMELOCK = 10;
  let accountGenerator: AccountGenerator;

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);
    const testParameters = await commonTestSetup(accountGenerator);
    mainAccount = testParameters.mainAccount;
    appId = testParameters.appId;
    algodClient = testParameters.algodClient;
    platformTokenAssetId = testParameters.platformTokenAssetId;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;
    const algodServer = process.env.ALGOD_SERVER;
    const algodPort = process.env.ALGOD_PORT;
    const algodToken = process.env.ALGOD_TOKEN;
    const algodAuthHeader = process.env.ALGOD_AUTH_HEADER;

    if (!algodServer || !algodPort || !algodToken || !algodAuthHeader) {
      throw new Error("Must define ALGOD_SERVER, ALGOD_PORT, ALGOD_TOKEN and ALGOD_AUTH_HEADER");
    }
    await fundAccount(user.addr, 10e9);

    app_config = JSON.stringify({
      "token": algodToken,
      "server": algodServer,
      "port": algodPort,
      "header": algodAuthHeader,
      "account":
        {
          "addr": user.addr,
          "sk": secretKeyToMnemonic(user.sk)
        }
      ,
    });
    command_start = `APP_CONFIG='${app_config}' ./cli.ts `;
    deploy_main_command = command_start + "deploy_main "
      + "devnetMode " + "True "
      + "thresholdRatio " + "66 "
      + "platformTokenAssetId " + platformTokenAssetId
      + " requestTokenFee " + 1_000_000
      + " requestAlgoFee " + 10_000
      + " requestTimeOut " + 300
      + " minimumStake " + 500 
      + " subscriptionTokenLock " + 10
      + " registerKeyTimeLock " + 10
      + " voteRefillThreshold " + 10
      + " voteRefillAmount " + 10000
      + " registerKeyTimeLock " + 10;
  });

  function make_generic_args(): [string, string, number, string, number, number] {
    const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1";
    const path = "market_cap";
    const appID = appId;
    const signature = "test(uint64)";
    const interval = 256;
    const num_execs = 32;
    return [url, path, appID, signature, interval, num_execs];
  }

  function encode_args(url: string, path: string, appId: number, signature: string, interval: number, num_execs: number) {
    const url_buf : Uint8Array = new Uint8Array(Buffer.from(url));
    const path_buf : Uint8Array = new Uint8Array(Buffer.from(path));
    const signature_buf : Uint8Array = new Uint8Array(Buffer.from(signature));
    //Note that the first argument in create_request_args must be an array of the source args array created in the line above
    //This example only uses a single source, but typically aggregation methods will take many sources.
    const userdata = new Uint8Array(Buffer.from("Hello world"));
    const source_id = 0;
    const requestArgs = RequestArgsType.encode([ [[source_id, [url_buf, path_buf], 60]], 0, userdata]);
    const destination = DestinationType.encode([appId, signature_buf]);
    const subscription_arg = SubscriptionType.encode([interval, num_execs]);

    return [requestArgs, destination, subscription_arg];
  }

  it("should deply main contract", async () => {
    await execAsync(deploy_main_command);
  });

  it("should deply vote contract", async () => {
    const { stdout, stderr } = await execAsync(deploy_main_command);
    
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2955000);

    const deploy_vote_command = command_start + "deploy_vote "
      + "devnetMode " + "True "
      + "appID " + mainId;

    await execAsync(deploy_vote_command);
  });

  it("should deploy network", async () => {
    const deploy_network_command = command_start + "create_network "
      + "devnetMode " + "True "
      + "thresholdRatio " + "66 "
      + "platformTokenAssetId " + platformTokenAssetId
      + " requestTokenFee " + 100
      + " requestAlgoFee " + 100
      + " requestTimeOut " + 300
      + " minimumStake " + 500 
      + " subscriptionTokenLock " + 10
      + " registerKeyTimeLock " + 10
      + " voteRefillThreshold " + 10
      + " voteRefillAmount " + 10000
      + " vote_num " + 3;

    await execAsync(deploy_network_command);
  });

  it("should update network", async () => {
    const deploy_network_command = command_start + "create_network "
      + "devnetMode " + "True "
      + "thresholdRatio " + "66 "
      + "platformTokenAssetId " + platformTokenAssetId
      + " requestTokenFee " + 100
      + " requestAlgoFee " + 100
      + " requestTimeOut " + 300
      + " minimumStake " + 500 
      + " subscriptionTokenLock " + 10
      + " registerKeyTimeLock " + 10
      + " voteRefillThreshold " + 10
      + " voteRefillAmount " + 10000
      + " vote_num " + 3;

    let { stdout } = await execAsync(deploy_network_command);
    const mainID = parseInt(stdout.match("Main Contract ID: (.*)")![1]);
    const vote_regex = /"vote_app_ids":(.*)}/g;
    const voteIDs = JSON.parse(Array.from(stdout.matchAll(vote_regex)).map(match => match[1])[2]).map((ele: string) => parseInt(ele));
    const update_network_command = command_start + "update_network "
      + "devnetMode " + "True "
      + "thresholdRatio " + "66 "
      + "platformTokenAssetId " + platformTokenAssetId
      + " requestTokenFee " + 100
      + " requestAlgoFee " + 100
      + " requestTimeOut " + 300
      + " minimumStake " + 500 
      + " subscriptionTokenLock " + 10
      + " registerKeyTimeLock " + 10
      + " voteRefillThreshold " + 10
      + " voteRefillAmount " + 10000
      + " mainContractID " + mainID
      + " voteContractIDs " + "[" + voteIDs + "]";

    ({ stdout } = await execAsync(update_network_command));
  });

  it("should deposit tokens", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2755000);
    await fundAccount(user.addr, 1e6);

    await optIn(platformTokenAssetId, user);
    await sendASA({
      from: mainAccount,
      to: user.addr,
      assetId: platformTokenAssetId,
      amount: 10_000
    });

    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);
    const deposit_token_command = command_start + "deposit_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 1000
      + " platformTokenAssetId " + platformTokenAssetId;
    await execAsync(deposit_token_command);
  });

  it("should stake tokens", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2755000);
    await fundAccount(user.addr, 1e6);

    await optIn(platformTokenAssetId, user);
    await sendASA({
      from: mainAccount,
      to: user.addr,
      assetId: platformTokenAssetId,
      amount: 10_000
    });
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);

    const stake_token_command = command_start + "stake_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " amount " + 1000
      + " platformTokenAssetId " + platformTokenAssetId;

    await execAsync(stake_token_command);
  });

  it("should deposit algo", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2755000);
    await fundAccount(user.addr, 1e6);

    await optIn(platformTokenAssetId, user);
    await sendASA({
      from: mainAccount,
      to: user.addr,
      assetId: platformTokenAssetId,
      amount: 10_000
    });
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);

    const deposit_algo_command = command_start + "deposit_algo "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 1000;
    
    await execAsync(deposit_algo_command);
  });

  it("should withdraw tokens", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2755000);
    await fundAccount(user.addr, 1e6);

    await optIn(platformTokenAssetId, user);
    await sendASA({
      from: mainAccount,
      to: user.addr,
      assetId: platformTokenAssetId,
      amount: 10_000
    });
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);

    const deposit_token_command = command_start + "deposit_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 1000
      + " platformTokenAssetId " + platformTokenAssetId;
    await execAsync(deposit_token_command);

    const withdraw_token_command = command_start + "withdraw_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " amount " + 500
      + " platformTokenAssetId " + platformTokenAssetId;

    await execAsync(withdraw_token_command);
  });

  it("should withdraw algo", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2755000);
    await fundAccount(user.addr, 1e6);

    await optIn(platformTokenAssetId, user);
    await sendASA({
      from: mainAccount,
      to: user.addr,
      assetId: platformTokenAssetId,
      amount: 10_000
    });
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);

    const deposit_algo_command = command_start + "deposit_algo "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 1000;
    
    await execAsync(deposit_algo_command);

    const withdraw_algo_command = command_start + "withdraw_algo "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " amount " + 500;
    
    await execAsync(withdraw_algo_command);
  });

  it("should unstake tokens", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2755000);
    await fundAccount(user.addr, 1e6);

    await optIn(platformTokenAssetId, user);
    await sendASA({
      from: mainAccount,
      to: user.addr,
      assetId: platformTokenAssetId,
      amount: 10_000
    });
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);

    const stake_token_command = command_start + "stake_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " amount " + 1000
      + " platformTokenAssetId " + platformTokenAssetId;

    await execAsync(stake_token_command);
    for(let i = 0; i <= TIMELOCK; i++)
    {
      await fundAccount(mainAccount.addr, 0);
    }
    
    const unstake_token_command = command_start + "unstake_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " amount " + 500
      + " platformTokenAssetId " + platformTokenAssetId;

    await execAsync(unstake_token_command);
  });

  it("should execute heartbeat txn", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);
    const heartbeat_command = command_start + "heartbeat "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " ip " + [127, 0, 0, 1]
      + " port " + 1234
      + " network " + 1;
    await execAsync(heartbeat_command);
  });

  it("should register a participation account", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);

    // wait for registration lock to expire
    await waitForRounds(TIMELOCK + 1);

    const register_command = command_start + "register_participation_account "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " publicKey " + user.addr;

    await execAsync(register_command);
  });

  it("should send a request", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);
    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination, subscription_arg] = encode_args(url, path, appID, signature, interval, num_execs);

    const deposit_token_command = command_start + "deposit_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 50_000_000_000
      + " platformTokenAssetId " + platformTokenAssetId;
    
    await execAsync(deposit_token_command);

    const deposit_algo_command = command_start + "deposit_algo "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 7_000_000;
    
    await execAsync(deposit_algo_command);

    const request_command = command_start + "request "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " requestArgs " + request_args
      + " destination " + destination
      + " type " + 1
      + " key " + "test";

    await execAsync(request_command);
  });

  it("should send a subscription", async () => {
    const { stdout } = await execAsync(deploy_main_command);
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);
    const [url, path, appID, signature, interval, num_execs] = make_generic_args();
    const [request_args, destination, subscription_arg] = encode_args(url, path, appID, signature, interval, num_execs);

    const deposit_token_command = command_start + "deposit_token "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 1000
      + " platformTokenAssetId " + platformTokenAssetId;
    
    await execAsync(deposit_token_command);

    const deposit_algo_command = command_start + "deposit_algo "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " accountToDepositTo " + user.addr
      + " amount " + 1000;
    
    await execAsync(deposit_algo_command);
    
    const subscribe_command = command_start + "subscription "
      + "devnetMode " + "True "
      + "appID " + mainId
      + " requestArgs " + request_args
      + " destination " + destination
      + " type " + 1;

    await execAsync(subscribe_command);
  });

  // skip for dev mode
  it.skip("should send a vote", async () => {
    const { stdout, stderr } = await execAsync(deploy_main_command);
    
    const mainId = parseInt(stdout.match("Main Contract ID: (.*)")![1]);

    await fundAccount(getApplicationAddress(mainId), 2955000);

    const deploy_vote_command = command_start + "deploy_vote "
      + "devnetMode " + "True "
      + "appID " + mainId;

    const { stdout: voteDeployStdout } = await execAsync(deploy_vote_command);

    const vote_id = parseInt(voteDeployStdout.match("Vote Contract ID: (.*)")![1]);
    const destinationAppId = await deployConsumerContract({
      deployer: mainAccount
    });
    await optIntoContract(user, mainId, await algodClient.getTransactionParams().do(), algodClient);
    await optIntoContract(user, vote_id, await algodClient.getTransactionParams().do(), algodClient);

    const stake_token_command = command_start + "stake_token "
        + "devnetMode " + "True "
        + "appID " + mainId
        + " amount " + 1000
        + " platformTokenAssetId " + platformTokenAssetId;

    await execAsync(stake_token_command);

    // wait for registration lock to expire
    await waitForRounds(TIMELOCK + 1);

    const register_command = command_start + "register_participation_account "
            + "devnetMode " + "True "
            + "appID " + mainId
            + " publicKey " + user.addr;
    await execAsync(register_command);
    // wait for participation lock to expire
    await waitForRounds(TIMELOCK + 1);
    const ABI_PATH = "../../test/test_fixtures/consumer-contract.json";

    const algodStatus = await algodClient.status().do();
    const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));
    const vote_command = command_start + "vote "
      + "devnetMode " + "True "
      + "voteAppID " + vote_id
      + " vote " + "abcd"
      + " requestRound " + (algodStatus["last-round"] - 1)
      + " mainAppID " + mainId
      + " ip " + [127, 0, 0, 1]
      + " port " + 1234
      + " network " + 100001
      + " destinationAppID " + destinationAppId
      + " destinationMethod " + consumerContract.methods[0].getSelector()
      + " requesterAddress " + user.addr
      + " primaryAccount " + user.addr
      + " requestID " + "abc"
      + " userData " + "this_is_user_data"
      + " errorCode " + 123
      + " bitField " + 10;
      
    await execAsync(vote_command);
  });
});