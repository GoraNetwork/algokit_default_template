#!/usr/bin/env -S npx ts-node

import path from "path";
import fs from "fs";
import algosdk, {
  mnemonicToSecretKey,
  LogicSigAccount,
  Algodv2,
  bytesToBigInt,
  getApplicationAddress,
} from "algosdk";
import {
  compilePyTeal,
  parseAppState
} from "algoutils";

import {
  getABIHash,
  approxCDF
} from "./utils/gora_utils";
import * as main_transactions from "./assets/transactions/main_transactions";
import * as vote_transactions from "./assets/transactions/vote_transactions";
import * as stake_transactions from "./assets/transactions/staking_transactions";
import * as request_transactions from "./assets/transactions/request_transactions";

function sleep(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

type network_json_type = {
  main_id : string,
  logic_sig_body: any,
  logic_sig_address : string,
  vote_app_ids : string[],
}

function initialSetup()
{
  const app_config = get_app_config();
  const token = app_config.token;
  const server = app_config.server;
  const port = app_config.port;
  const user = mnemonicToSecretKey(app_config.account.sk);
  let algodClient: Algodv2;
  process.env.ALGOD_AUTH_HEADER = app_config.header;

  let authKey = {};
  if (app_config.header && token) {
    authKey = {
      [app_config.header]: token
    };
    algodClient = new Algodv2(authKey, server, port); // TODO: write test to cover this
  } else {
    algodClient = new Algodv2(token, server, port);
  }

  process.env.ALGOD_TOKEN = token;
  process.env.ALGOD_SERVER = server;
  process.env.ALGOD_PORT = port;
  return {algodClient,user};
}
let network_json: network_json_type;
function display_default_help()
{
  console.log("Available Commands:");
  console.log("deploy_main");
  console.log("deploy_vote");
  console.log("create_network");
  console.log("deposit_token");
  console.log("withdraw_token");
  console.log("deposit_algo");
  console.log("withdraw_algo");
  console.log("stake_token");
  console.log("unstake_token");
  console.log("claim_rewards");
  console.log("heartbeat");
  console.log("register_participation_account");
  console.log("vote");
  console.log("request");
  console.log("subscription");
  console.log("For additional info execute ./cli <command> help");

  console.log("\nYour environment should have a JSON string under the key APP_CONFIG, or you must pass the environment variable as a prefix to launching the CLI command.");
  console.log("\nExample:\n APP_CONFIG='{\"token\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"server\":\"http://localhost\",\"port\":49212,\"header\":\"X-Algo-API-Token\",\"account\":\"{\"addr\":\"KI7N5KZ7ILV5MTRJ2KDBV7U3QRDU2HJ6QUNS22NM3TBHAVZV2YBMETZDI4\",\"sk\":\"vault envelope shaft result minimum exclude first battle donate meat lawsuit craft remember small lawsuit bench combine misery bomb excess venture chase pipe abstract turtle\"}\"}'");

  console.log("\n\nIf your Algorand Node is running in DevNet Mode, you may need to pass in the argument \"devnetMode True\" ");
}

function get_app_config()
{
  return JSON.parse(process.env.APP_CONFIG as string);
}
async function run() {
  
  const args = process.argv.slice(2);
  if(args.length == 0)
  {
    display_default_help();
    return;
  }

  function get_arg(arg_name: string) {
    for (let i = 0; i < args.length; i++) {
      const val = args[i];
      if (val === arg_name) {
        if (arg_name == "help") {
          return "True";
        }
        return args[i + 1];
      }
    }
    return undefined;
  }

  async function deploy_main()
  {
    const {algodClient,user} = initialSetup();

    const program = await compilePyTeal(path.join(__dirname, "./assets/vote_verify_lsig.py"));
    const voteVerifyLsig = new LogicSigAccount(program);

    const fund_txn = algosdk.makePaymentTxnWithSuggestedParams(
      user.addr,
      voteVerifyLsig.address(),
      1e6,
      undefined,
      undefined,
      await algodClient.getTransactionParams().do(),
      undefined
    );

    const signed_fund_txn = fund_txn.signTxn(user.sk);
    const { txId } = await algodClient.sendRawTransaction(signed_fund_txn).do();
    if (!get_arg("devnetMode")) {
      const fund_txn_result = await algosdk.waitForConfirmation(algodClient, txId, 15);
    }

    const abiHash = getABIHash("../assets/abi/main-contract.json");
    const votingContractParams = {
      CONTRACT_VERSION: abiHash,
      VOTE_VERIFY_LSIG_ADDRESS: voteVerifyLsig.address(),
    };

    const main_id = await main_transactions.deployMainContract(
      {
        platformTokenAssetId: parseInt(get_arg("platformTokenAssetId")!),
        deployer: user,
        voteApprovalProgram: await compilePyTeal(path.join(__dirname, "./assets/voting_approval.py"), votingContractParams),
        voteClearProgram: await compilePyTeal(path.join(__dirname, "./assets/voting_clear.py")),
        minimumStake: parseInt(get_arg("minimumStake")!)
      }
    );

    const fund_main_txn = algosdk.makePaymentTxnWithSuggestedParams(
      user.addr,
      getApplicationAddress(main_id),
      1e6,
      undefined,
      undefined,
      await algodClient.getTransactionParams().do(),
      undefined
    );

    const signed_fund_main_txn = fund_main_txn.signTxn(user.sk);
    const txnResults = await algodClient.sendRawTransaction(signed_fund_main_txn).do();

    if (!get_arg("devnetMode")) {
      await algosdk.waitForConfirmation(algodClient, txnResults.txId, 15);
    }

    const init_txn = main_transactions.init({
      platformTokenAssetId: parseInt(get_arg("platformTokenAssetId")!),
      user: user, 
      appId: main_id, 
      suggestedParams: await algodClient.getTransactionParams().do(),
      manager: user.addr
    });
    await init_txn.execute(algodClient, 15);

    console.log("Main Contract ID: " + main_id);
    console.log("logic Signature Address: " + voteVerifyLsig.address());
    network_json = 
    {
      "main_id": main_id,
      "logic_sig_address": voteVerifyLsig.address(),
      "logic_sig_body": Buffer.from(voteVerifyLsig.toByte()).toString("base64"),
      "vote_app_ids": [],
    };
    
    return network_json;
  }

  async function deploy_vote()
  {
    const {algodClient,user} = initialSetup();

    let suggestedParams = await algodClient.getTransactionParams().do();
    suggestedParams = {
      ...suggestedParams,
      flatFee: true,
      fee: 3000
    };
    const deploy_vote_group = main_transactions.deployVoteContract(
      {
        staker: user,
        appID: parseInt(get_arg("appID")!),
        suggestedParams: suggestedParams,
      }
    );
    const vote_results = await deploy_vote_group.execute(algodClient, 15);
    if (vote_results.methodResults[0].txInfo) {
      const log = vote_results.methodResults[0].txInfo.logs[0];
      console.log("Vote Contract ID: " + Number(bytesToBigInt(log)));
      
      return Number(bytesToBigInt(log));
    }
    return -1;
  }

  switch (args[0]) {
  case "deploy_main": {
    if (get_arg("help")) {
      console.log("deploy_main args:");
      console.log("thresholdRatio <integer>");
      console.log("platformTokenAssetID <integer>");
      console.log("requestTokenFee <integer>");
      console.log("requestAlgoFee <integer>");
      console.log("subscriptionTokenLock <integer>");
      console.log("registerKeyTimeLock <integer>");
      console.log("voteRefillThreshold <integer>");
      console.log("voteRefillAmount <integer>");

      console.log("\n Example: \n ./cli.ts deploy_main thresholdRatio 66 platformTokenAssetId 1 requestTokenFee 100 requestAlgoFee 100 subscriptionTokenLock 10 registerKeyTimeLock 10 voteRefillThreshold 10 voteRefillAmount 10000' ");
      return;
    }
    deploy_main();
    break;
  }

  case "deploy_vote": {
    if (get_arg("help")) {
      console.log("deploy_vote args:");
      console.log("appID <integer>");
      console.log("\nExample:\n ./cli.ts deploy_vote appID 12");
      return;
    }
    deploy_vote();
    break;
  }

  case "create_network": {
    if (get_arg("help")) {
      console.log("create_network args:");
      console.log("thresholdRatio <integer>");
      console.log("platformTokenAssetID <integer>");
      console.log("requestTokenFee <integer>");
      console.log("requestAlgoFee <integer>");
      console.log("subscriptionTokenLock <integer>");
      console.log("registerKeyTimeLock <integer>");
      console.log("voteRefillThreshold <integer>");
      console.log("voteRefillAmount <integer>");
      console.log("vote_num <integer>");
      console.log("\nExample:\n ./cli.ts create_network devnetMode True thresholdRatio 66 platformTokenAssetId 1 requestTokenFee 100 requestAlgoFee 100 subscriptionTokenLock 10 registerKeyTimeLock 10 voteRefillThreshold 10 voteRefillAmount 10000 vote_num 3");
      return;
    }

    const {algodClient,user} = initialSetup();

    const main_info = await deploy_main();
    args.push("appID");
    args.push(main_info["main_id"]);
    for(let i = 0; i < parseInt(get_arg("vote_num")!); i++)
    {
      const fund_txn = algosdk.makePaymentTxnWithSuggestedParams(
        user.addr,
        getApplicationAddress(parseInt(main_info["main_id"])),
        30_000_000, // TODO: I think this was for just one and a little under the new charge for 1.
        undefined,
        undefined,
        await algodClient.getTransactionParams().do(),
        undefined
      );
  
      const signed_fund_txn = fund_txn.signTxn(user.sk);
      const { txId } = await algodClient.sendRawTransaction(signed_fund_txn).do();
      if (!get_arg("devnetMode")) {
        await algosdk.waitForConfirmation(algodClient, txId, 15);
      }
      
      const vote_id = await deploy_vote();
      main_info["vote_app_ids"].push(String(vote_id));
      fs.writeFile("network_info.json", JSON.stringify(network_json), "utf8", (err) => {
        if(err)
          console.log(err);
        else {
          console.log("file written");
          console.log(JSON.stringify(network_json));
        }
      });
      await sleep(1000);
    }
    break;
  }
  case "update_network": {
    if (get_arg("help")) {
      console.log("update_network args:");
      console.log("mainContractID <integer>");
      console.log("voteContractIDs <integer[]>");
      console.log("thresholdRatio <integer>");
      console.log("platformTokenAssetID <integer>");
      console.log("requestTokenFee <integer>");
      console.log("requestAlgoFee <integer>");
      console.log("subscriptionTokenLock <integer>");
      console.log("registerKeyTimeLock <integer>");
      console.log("voteRefillThreshold <integer>");
      console.log("voteRefillAmount <integer>");
      console.log("\nExample:\n ./cli.ts create_network devnetMode True thresholdRatio 66 platformTokenAssetId 1 requestTokenFee 100 requestAlgoFee 100 subscriptionTokenLock 10 registerKeyTimeLock 10 voteRefillThreshold 10 voteRefillAmount 10000 mainContractID 12 voteContractIDs [14,15,16]");
      return;
    }

    const {algodClient,user} = initialSetup();

    const voteAppIDs = JSON.parse(get_arg("voteContractIDs")!);

    const mainAppID = parseInt(get_arg("mainContractID")!);
    const abiHash = getABIHash("../assets/abi/main-contract.json");
    const program = await compilePyTeal(path.join(__dirname, "./assets/vote_verify_lsig.py"));
    const voteVerifyLsig = new LogicSigAccount(program);
    const votingContractParams = {
      CONTRACT_VERSION: abiHash,
      VOTE_VERIFY_LSIG_ADDRESS: voteVerifyLsig.address(),
    };
    const txns: any = [];
    let txn = await main_transactions.updateMainContract(
      {
        appIdToUpdate: mainAppID,
        platformTokenAssetId: parseInt(get_arg("platformTokenAssetId")!),
        deployer: user,
        voteApprovalProgram: await compilePyTeal(path.join(__dirname, "./assets/voting_approval.py"), votingContractParams),
        voteClearProgram: await compilePyTeal(path.join(__dirname, "./assets/voting_clear.py")),
        minimumStake: parseInt(get_arg("minimumStake")!)
      }
    );
    console.log("updated: " + mainAppID.toString());
    for(let i = 0; i < voteAppIDs.length; i++)
    {
      const vote_id = voteAppIDs[i];
      txn = await vote_transactions.updateVoteContract(
        {
          updater: user, 
          mainAppId: mainAppID,
          appIdToUpdate: vote_id,
          ...votingContractParams
        }
      );
      console.log("updated: " + vote_id.toString());
    }
    break;
  }


  case "deposit_token": {
    if (get_arg("help")) {
      console.log("deposit_token args:");
      console.log("platformTokenAssetId <integer>");
      console.log("appID <integer>");
      console.log("amount <integer>");
      console.log("accountToDepositTo <string>");
      console.log("\nExample:\n ./cli.ts deposit_token appID 12 accountToDepositTo KXWF2LA2AJTN6AXBLF2JA3HZHCQKVG2YCM6THQBTHEBHLLP4UVXWTMT4TQ amount 1000 platformTokenAssetId 1");
      return;
    }

    const {algodClient,user} = initialSetup();

    const amount = parseInt(get_arg("amount")!);
    const account_to_deposit_to = get_arg("accountToDepositTo");
    const group = stake_transactions.depositToken(
      {
        platformTokenAssetId: parseInt(get_arg("platformTokenAssetId")!),
        user: user,
        appId: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        amount: amount,
        account_to_deposit_to: account_to_deposit_to
      }
    );
    await group.execute(algodClient, 15);
    console.log(amount + " Gora deposited to " + account_to_deposit_to);
    break;
  }

  case "withdraw_token": {
    if (get_arg("help")) {
      console.log("withdraw_token args:");
      console.log("appID <integer>");
      console.log("amount <integer>");
      console.log("platformTokenAssetId <string>");
      console.log("\nExample:\n ./cli.ts withdraw_token appID 12 amount 500 platformTokenAssetId 1");
      return;
    }

    const {algodClient,user} = initialSetup();

    const amount = parseInt(get_arg("amount")!);
    const group = stake_transactions.withdrawToken(
      {
        platformTokenAssetId: parseInt(get_arg("platformTokenAssetId")!),
        user: user,
        appId: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        amount: amount
      }
    );
    await group.execute(algodClient, 15);
    console.log(amount + " Gora withdrawn from account " + user.addr);
    break;
  }

  case "deposit_algo": {
    if (get_arg("help")) {
      console.log("deposit_algo args:");
      console.log("appID <integer>");
      console.log("amount <integer>");
      console.log("accountToDepositTo <string>");
      console.log("\nExample:\n ./cli.ts deposit_algo appID 12 accountToDepositTo 7GRDUITRNEO2RYXDCE6RTXEPBAKMAM3GDEXH2PTF5BZL5HUN2V7EYKIBHU amount 1000'");
      return;
    }

    const {algodClient,user} = initialSetup();

    const amount = parseInt(get_arg("amount")!);
    const account_to_deposit_to = get_arg("accountToDepositTo");
    const group = stake_transactions.depositAlgo(
      {
        user: user,
        appId: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        amount: amount,
        account_to_deposit_to: account_to_deposit_to
      }
    );
    await group.execute(algodClient, 15);
    console.log(amount + " Algo deposited to " + account_to_deposit_to);
    break;
  }
  case "withdraw_algo": {
    if (get_arg("help")) {
      console.log("withdraw_algo args:");
      console.log("appID <integer>");
      console.log("amount <integer>");
      console.log("\nExample:\n ./cli.ts withdraw_algo appID 12 amount 500");
      return;
    }

    const {algodClient,user} = initialSetup();

    const amount = parseInt(get_arg("amount")!);
    const group = stake_transactions.withdrawAlgo(
      {
        user: user,
        appId: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        amount: amount
      }
    );
    await group.execute(algodClient, 15);
    console.log(amount + " Algo withdrawn from account " + user.addr);
    break;
  }
  case "stake_token": {
    if (get_arg("help")) {
      console.log("stake_token args:");
      console.log("appID <integer>");
      console.log("amount <integer>");
      console.log("platformTokenAssetId <integer>");
      console.log("\nExample:\n ./cli.ts stake_token appID 12 amount 1000 platformTokenAssetId 1");
      return;
    }

    const {algodClient,user} = initialSetup();

    const amount = parseInt(get_arg("amount")!);
    const group = stake_transactions.stake(
      {
        platformTokenAssetId: parseInt(get_arg("platformTokenAssetId")!),
        user: user,
        appId: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        amount: amount,
      }
    );
    await group.execute(algodClient, 15);
    console.log(amount + " Gora staked to " + user.addr);
    break;
  }
  case "unstake_token": {
    if (get_arg("help")) {
      console.log("unstake_token args:");
      console.log("appID <integer>");
      console.log("amount <integer>");
      console.log("platformTokenAssetId <integer>");
      console.log("\nExample:\n ./cli.ts unstake_token appID 12 amount 500 platformTokenAssetId 1");
      return;
    }

    const {algodClient,user} = initialSetup();

    const amount = parseInt(get_arg("amount")!);
    const group = stake_transactions.unstake(
      {
        platformTokenAssetId: parseInt(get_arg("platformTokenAssetId")!),
        user: user,
        appId: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        amount: amount,
      }
    );
    await group.execute(algodClient, 15);
    console.log(amount + " Gora unstaked");
    break;
  }
  case "claim_rewards": {
    if (get_arg("help")) {
      console.log("claim_rewards args:");
      console.log("appID <integer>");
      console.log("votingContract <integer>");
      console.log("platformTokenAssetId <integer");
      console.log("claimAccount <string>");
      console.log("ip <array of bytes, length 4>");
      console.log("port <integer>");
      console.log("network <integer>");
      console.log("\nExample:\n ./cli.ts claim_rewards appID 12 votingContract 2 platformTokenAssetId 1 claimAccount 7GRDUITRNEO2RYXDCE6RTXEPBAKMAM3GDEXH2PTF5BZL5HUN2V7EYKIBHU ip 127,0,0,1 port 1234 network 1");
      return;
    }

    const {algodClient,user} = initialSetup();

    const claim_account = get_arg("claimAccount");
    const vote_contract = parseInt(get_arg("votingContract")!);
    const group = await stake_transactions.claimRewards(
      {
        primaryAccount: user,
        rewardsAddress: claim_account!,
        appId: parseInt(get_arg("appID")!),
        votingAppId: parseInt(get_arg("votingContract")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        client: algodClient
      }
    );
    await group.execute(algodClient, 15);
    console.log("claimed rewards for account " + claim_account + " from " + vote_contract);
    break;
  }
  case "heartbeat": {
    if (get_arg("help")) {
      console.log("heartbeat args:");
      console.log("appID <integer>");
      console.log("ip <array of bytes, length 4>");
      console.log("port <integer>");
      console.log("network <integer>");
      console.log("\nExample:\n ./cli.ts heartbeat appID 12 ip 127,0,0,1 port 1234 network 1");
      return;
    }

    const {algodClient,user} = initialSetup();

    const group = main_transactions.heartbeat(
      {
        user: user,
        appId: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        ip: Buffer.from((get_arg("ip")!).split(",").map(Number)),
        port: parseInt(get_arg("port")!),
        network: parseInt(get_arg("network")!),
      }
    );
    await group.execute(algodClient, 15);
    console.log("heartbeat sent");
    break;
  }
  case "register_participation_account": {
    const publicKey = get_arg("publicKey")!;
    if (get_arg("help")) {
      console.log("register_participation_account args:");
      console.log("publicKey <string>");
      console.log("appID <integer>");
      console.log("\nExample:\n ./cli.ts register_participation_account appID 12 publicKey PK7MYQWY46HMQLNIBYCQF5OHOUY65DI6RKFPMRGKEIMETNHAVVSPB7IYB4'");
      return;
    }

    const {algodClient,user} = initialSetup();

    const group = stake_transactions.registerKey(
      {
        user: user,
        appId: parseInt(get_arg("appID")!),
        publicKey: publicKey,
        suggestedParams: await algodClient.getTransactionParams().do(),
      }
    );
    await group.execute(algodClient, 15);
    console.log(user.addr + " registered the participation account " + publicKey);
    break;
  }
  case "vote": {
    if (get_arg("help")) {
      console.log("vote args:");
      console.log("voteAppID <integer>");
      console.log("vote <string>");
      console.log("mainAppID <integer>");
      console.log("ip <array of bytes, length 4>");
      console.log("port <integer>");
      console.log("network <integer>");
      console.log("destinationAppID <integer>");
      console.log("destinationMethod <array of bytes>");
      console.log("requesterAddress <string>");
      console.log("primaryAccount <string>");
      console.log("timeLock <number>");
      console.log("request_key_hash <array of bytes, length 32>");
      console.log("\nExample:\n ./cli.ts vote devnetMode True voteAppID 1097 vote abcd requestRound 3844 mainAppID 1091 ip 127,0,0,1 port 1234 network 1 destinationAppID 1099 destinationMethod 40,91,162,227 requesterAddress 6ZSOMPEW4KK7SXT24NIWE3BKMGO2UNCX3BFUZDMDR6IKTXGH64FRTZW7BA primaryAccount 6ZSOMPEW4KK7SXT24NIWE3BKMGO2UNCX3BFUZDMDR6IKTXGH64FRTZW7BA requestID abc userData this_is_user_data errorCode 123 bitField 10 timeLock 10");
      return;
    }

    const {algodClient,user} = initialSetup();

    const program = await compilePyTeal(path.join(__dirname, "./assets/vote_verify_lsig.py"));
    const voteVerifyLsig = new LogicSigAccount(program);

    const requestRound = parseInt(get_arg("requestRound")!);

    const suggestedParams = await algodClient.getTransactionParams().do();

    let _requestRound = requestRound;
    if (!_requestRound) {
      _requestRound = suggestedParams.firstRound - 1;
    }

    const blockInfo = await algodClient.block(_requestRound).do();

    const requestRoundSeed = blockInfo.block.seed;

    /* eslint-disable @typescript-eslint/no-var-requires */
    const Vrf = require("@algoracle/vrf-algorand-sodium");

    const vrfProof = Vrf.prove(user.sk, requestRoundSeed);

    const vrfResult = Vrf.proofToHash(vrfProof);

    const accountAppInfo = await algodClient.accountApplicationInformation(get_arg("primaryAccount")!, parseInt(get_arg("mainAppID")!)).do();
    const localStake = parseAppState(accountAppInfo["app-local-state"]["key-value"])["ls"] as number;

    const { voteCount, zIndex } = approxCDF(vrfResult, localStake);
  
    const group = await vote_transactions.vote(
      {
        user: user,
        voteVerifyLsig: voteVerifyLsig,
        votingAppId: parseInt(get_arg("voteAppID")!),
        vrfProof,
        vrfResult,
        requestRoundSeed: new Uint8Array(requestRoundSeed),
        mainContractAppId: parseInt(get_arg("mainAppID")!),
        suggestedParams,
        ip: Buffer.from((get_arg("ip")!).split(",").map(Number)),
        port: parseInt(get_arg("port")!),
        network: parseInt(get_arg("network")!),
        destinationAppId: parseInt(get_arg("destinationAppID")!),
        destinationMethod: Buffer.from((get_arg("destinationMethod")!).split(",").map(Number)),
        requesterAddress: get_arg("requesterAddress")!,
        primaryAccount: get_arg("primaryAccount")!,
        request_id: get_arg("requestID")!,
        return_value: get_arg("vote")!,
        user_data: get_arg("userData")!,
        error_code: parseInt(get_arg("errorCode")!),
        bit_field: parseInt(get_arg("bitField")!),
        mockSeed: new Uint8Array(requestRoundSeed),
        voteCount,
        timelock: parseInt(get_arg("timeLock")!),
        zIndex,
        request_key_hash: Buffer.from(get_arg("request_key_hash")!),
        appRefs: [],
        assetRefs: [],
        accountRefs: [],
        boxRefs: []
      }
    );
    await group.execute(algodClient, 15);
    console.log("vote submitted");
    break;
  }
  case "request": {
    if (get_arg("help")) {
      console.log("request args:");
      console.log("appID <integer>");
      console.log("requestArgs <array of bytes>");
      console.log("destination <array of bytes>");
      console.log("key <array of bytes>");
      console.log("type <integer>");
      console.log("appRefs <array of integers>");
      console.log("assetRefs <array of integers>");
      console.log("addressRefs <array of strings>");
      console.log("boxRefs <array of base64 encoded strings>");
      console.log("\nExample:\n ./cli.ts request appID 12 requestArgs 0,4,0,108,0,102,104,116,116,112,115,58,47,47,97,112,105,46,99,111,105,110,103,101,99,107,111,46,99,111,109,47,97,112,105,47,118,51,47,99,111,105,110,115,47,109,97,114,107,101,116,115,63,118,115,95,99,117,114,114,101,110,99,121,61,117,115,100,38,111,114,100,101,114,61,109,97,114,107,101,116,95,99,97,112,95,100,101,115,99,38,112,101,114,95,112,97,103,101,61,49,38,112,97,103,101,61,49,0,10,109,97,114,107,101,116,95,99,97,112 destination 0,3,0,4,0,12,116,101,115,116,40,117,105,110,116,54,52,41 type 1 appRefs 1 assetRefs 1 accountRefs AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ boxRefs dGVzdAo=");
      return;
    }

    const {algodClient,user} = initialSetup();

    const appRefs = get_arg("appRefs");
    const assetRefs = get_arg("assetRefs");
    const accountRefs = get_arg("accountRefs");
    const boxRefs = get_arg("boxRefs");

    const group = request_transactions.request(
      {
        user: user,
        appID: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        request_args: Buffer.from((get_arg("requestArgs")!).split(",").map(Number)),
        destination: Buffer.from((get_arg("destination")!).split(",").map(Number)),
        type: parseInt(get_arg("type")!),
        key: Buffer.from(get_arg("key")!),
        appRefs: appRefs ? appRefs.split(",").map(s => parseInt(s!)) : [],
        assetRefs: assetRefs ? assetRefs.split(",").map(s => parseInt(s)) : [],
        accountRefs: accountRefs ? accountRefs.split(",") : [],
        boxRefs: boxRefs ? boxRefs.split(",").map(s => new Uint8Array(Buffer.from(s, "base64"))) : []
      }
    );
    await group.execute(algodClient, 15);
    console.log("request submitted");
    break;
  }
  case "subscription": {
    if (get_arg("help")) {
      console.log("subscription args:");
      console.log("appID <integer>");
      console.log("requestArgs <array of bytes>");
      console.log("destination <array of bytes>");
      console.log("subscription <array of bytes>");
      console.log("type <integer>");
      console.log("\nExample:\n ./cli.ts subscription appID 12 requestArgs 0,4,0,108,0,102,104,116,116,112,115,58,47,47,97,112,105,46,99,111,105,110,103,101,99,107,111,46,99,111,109,47,97,112,105,47,118,51,47,99,111,105,110,115,47,109,97,114,107,101,116,115,63,118,115,95,99,117,114,114,101,110,99,121,61,117,115,100,38,111,114,100,101,114,61,109,97,114,107,101,116,95,99,97,112,95,100,101,115,99,38,112,101,114,95,112,97,103,101,61,49,38,112,97,103,101,61,49,0,10,109,97,114,107,101,116,95,99,97,112 destination 0,3,0,4,0,12,116,101,115,116,40,117,105,110,116,54,52,41 type 1");
      return;
    }

    const {algodClient,user} = initialSetup();
      
    const group = request_transactions.subscribe(
      {
        user: user,
        appID: parseInt(get_arg("appID")!),
        suggestedParams: await algodClient.getTransactionParams().do(),
        request_args: Buffer.from(get_arg("requestArgs")!),
        destination: Buffer.from(get_arg("destination")!),
        subscription: Buffer.from(get_arg("subscription")!),
        type: parseInt(get_arg("type")!),
      }
    );
    await group.execute(algodClient, 15);
    console.log("subscription submitted");
    break;
  }
  default: {
    display_default_help();
    break;
  }
  }
}

run();