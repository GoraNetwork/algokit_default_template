import path from "path";
import * as fs from "fs";
import * as bkr from "beaker-ts";
import { 
  Account, 
  encodeUint64, 
  makeAssetTransferTxnWithSuggestedParamsFromObject, 
  makeBasicAccountTransactionSigner, 
  makePaymentTxnWithSuggestedParamsFromObject, 
  getApplicationAddress,
  Algodv2,
  LogicSigAccount
} from "algosdk";
import { fundAccount } from "algotest";
import { loadABIContract } from "algoutils";


import { SandboxAccount } from "beaker-ts/lib/sandbox/accounts";
import { StakeDelegator } from "../artifacts/stakedelegator_client";
import { compileBeaker, sendGenericAsset, sendGenericPayment } from "../../../utils/beaker_test_utils";
import { DestinationType, RequestArgsType } from "../../../utils/abi_types";
import { testVote, waitForRounds } from "../../../test/util/utils";
import { getGlobalStateMain, getGlobalStateVote, getLocalStateMain, getRequestInfo } from "../../../utils/gora_utils";
import { getGlobal, getLocal, getPredictedLocal, participation_optin } from "../delegatorUtils";
import { AccountGenerator, VotingTestState, beforeEachVotingTest, generateUsers, test_optin,voter_setup, submit_test_request } from "../../../test/e2e/vote/voting.helpers";
import accounts from "../../../test/test_fixtures/accounts.json";
import { update_protocol_settings } from "../../transactions/main_transactions";
import { request } from "../../../assets/transactions/request_transactions";
import { registerVoter } from "../../transactions/vote_transactions";

async function sleep_rounds(rounds:number, acc:SandboxAccount){
  for(let i = 0; i < rounds; i++)
  {
    await sendGenericPayment(acc.signer, acc.addr, acc.addr, 0);
  }
}

const ABI_PATH = "../../../test/test_fixtures/consumer-contract.json";
const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));
const consumerMethod = consumerContract.methods[0].getSelector();

describe("Stake Delegator Tests", () => {
  let sandboxAccount: SandboxAccount;
  let sandboxAppClient: StakeDelegator;
  let appId: number;
  let MainAddress: string;
  let testAsset: number;
  let appAddress: string;
  let users : Account[];
  let goracle_timelock: number;
  let accountGenerator: AccountGenerator;
  let algodClient: Algodv2;
  // let testParameters: any;
  let TIME_LOCK: number;
  let votingAppId: number;
  let destinationAppId: number;
  let user: Account;
  let current_request_round: any;
  let network: number;
  let testState: VotingTestState;
  let voteVerifyLsig: LogicSigAccount;
  let mainAppId: number;
  let goraRequestFee: number;
  let algoRequestFee: number;
  let requestBoxCost: number;
  let VOTE_REFILL_THRESHOLD: number;
  let VOTE_REFILL_AMOUNT: number;

  let approvalProgram: any;
  let clearProgram: any;

  function getDelegatorClient(user: Account){
    const client = new StakeDelegator(
      {
        client: bkr.clients.sandboxAlgod(),
        signer: makeBasicAccountTransactionSigner(user),
        sender: user.addr,
        appId: appId
      }
    );
    client.approvalProgram = approvalProgram;
    client.clearProgram = clearProgram;
    return client;
  }

  beforeEach(async () => {
    goracle_timelock = 10;
    accountGenerator = new AccountGenerator(accounts);
    testState = await beforeEachVotingTest(accountGenerator);
    // flatten the testState object
    ({ current_request_round, votingAppId, mainAppId, destinationAppId, algodClient, voteVerifyLsig, user, network, TIME_LOCK, goraRequestFee, algoRequestFee, requestBoxCost, VOTE_REFILL_THRESHOLD, VOTE_REFILL_AMOUNT } = testState);

    // testParameters = await commonTestSetup(accountGenerator);
    // MainID = testParameters.appId;
    MainAddress = getApplicationAddress(mainAppId);
    testAsset = testState.platformTokenAssetId;
    // Configure fresh variables for each test 
    
    // Grab an account
    sandboxAccount = (await bkr.sandbox.getAccounts()).pop()!;
    if (sandboxAccount === undefined) return;
    const NUM_USERS = 10;

    await compileBeaker("assets/stake_delegator/stake_delegator.py", {GORA_TOKEN_ID: testAsset, MAIN_APP_ID: mainAppId});
    const program = JSON.parse(fs.readFileSync("./assets/stake_delegator/artifacts/application.json", "utf-8"));
    approvalProgram = program.source.approval;
    clearProgram = program.source.clear;
    // Create a new client that will talk to our app
    // Including a signer lets it worry about signing
    // the app call transactions 
    sandboxAppClient = getDelegatorClient({addr: sandboxAccount.addr, sk: sandboxAccount.privateKey});

    const appCreateResults = await sandboxAppClient.create({extraPages: 1});
    appId  = appCreateResults.appId;
    appAddress = appCreateResults.appAddress;

    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, MainAddress, 1e6);

    users = [];
    for(let i = 0; i < NUM_USERS; i++)
    {   
      const tempUser = accountGenerator.generateAccount();
      await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, tempUser.addr, 1e6);
      await sendGenericAsset(makeBasicAccountTransactionSigner(tempUser), testAsset, tempUser.addr, tempUser.addr, 0);
      await sendGenericAsset(makeBasicAccountTransactionSigner(testState.mainAccount), testAsset, testState.mainAccount.addr, tempUser.addr, 20_000);
      users.push(tempUser);
    }
    await sandboxAppClient.optIn();
  });
  
  async function stake(amount: number, user: Account) {
    const state = await getGlobal(appId);
    const userClient = getDelegatorClient(user);
    const result = await userClient.stake({
      asset_pay: makeAssetTransferTxnWithSuggestedParamsFromObject(
        {
          from: user.addr, 
          to: appAddress,
          amount: amount,
          assetIndex: testAsset,
          suggestedParams: await userClient.client.getTransactionParams().do()
        }
      ),
      vesting_on_behalf_of: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
      main_app_ref: BigInt(mainAppId),
      asset_reference: BigInt(testAsset),
      manager_reference: sandboxAccount.addr
    });
    return result;
  }

  async function unstake(amount: number, user: Account) {
    const state = await getGlobal(appId);
    const userClient = getDelegatorClient(user);

    const result = await userClient.unstake({
      amount_to_withdraw: BigInt(amount),
      main_app_ref: BigInt(mainAppId),
      vesting_on_behalf_of: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
      asset_reference: BigInt(testAsset),
      manager_reference: sandboxAccount.addr
    });
  }


  it("Basic stake, unstake and round iteration", async () => {
    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, appAddress, 800_000);
    //opt in all users
    for(let i = 0; i < users.length; i++)
    {
      const userClient = getDelegatorClient(users[i]);
      await userClient.optIn();
    }
    await sandboxAppClient.init_app({asset: BigInt(testAsset), timelock: BigInt(goracle_timelock), main_app_id: BigInt(mainAppId), manager_address: sandboxAccount.addr, manager_algo_share: BigInt(0), manager_gora_share: BigInt(0)});

    //stake through until next round triggers
    await sleep_rounds(1, sandboxAccount);
    for(let i = 0; i < users.length && i <= goracle_timelock - 1; i++) //-2 cause of extra actions I have to do with the real main
    {
      await stake(10_000, users[i]);
      const state = await getGlobal(appId);
      if(i === users.length - 1 || i === goracle_timelock - 1)
      {
        expect(state["pending_deposits"]).toEqual(0);
      }
      else
      {
        expect(state["pending_deposits"]).toEqual(10_000 + (i * 10_000));
      }
      expect(state["pending_withdrawals"]).toEqual(0);
    }
    let state = await getGlobal(appId);
    await sleep_rounds(1, sandboxAccount);
    expect(state["aggregation_round"]).toEqual(2);
    await stake(10_000, users[0]);
    await stake(10_000, users[1]);
    
    state = await getGlobal(appId);
    expect(state["pending_deposits"]).toEqual(20_000);
    for(let i = 2; i < users.length && i <= goracle_timelock; i++)
    {
      await unstake(5_000, users[i]);
      const state = await getGlobal(appId);
      if(i === users.length - 1 || i === goracle_timelock)
      {
        expect(state["pending_withdrawals"]).toEqual(0);
      }
      else
      {
        expect(state["pending_withdrawals"]).toEqual(5_000 + (i * 5_000) - 10_000);
      }
    }
    state = await getGlobal(appId);
    expect(state["pending_withdrawals"]).toEqual(0);
    expect(state["pending_deposits"]).toEqual(0);
  });

  it("should accumulate rewards add to non stake, and then allow users to claim", async () => {
    let expectedRewards = 0;
    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, appAddress, 800_000);
    //opt in all users
    for(let i = 0; i < users.length; i++)
    {
      const userClient = getDelegatorClient(users[i]);
      await userClient.optIn();
    }
    await sandboxAppClient.init_app({asset: BigInt(testAsset), timelock: BigInt(goracle_timelock), main_app_id: BigInt(mainAppId), manager_address: sandboxAccount.addr, manager_algo_share: BigInt(0), manager_gora_share: BigInt(0)});
    await sandboxAppClient.configure_settings({manager_address: sandboxAccount.addr, manager_algo_share: BigInt(200), manager_gora_share: BigInt(100)});
    expect(await sandboxAppClient.register_participation_key({new_key: users[0].addr, main_ref: BigInt(mainAppId)}));
    //stake through until next round triggers (time for 8 users to stake on devnet)
    for(let i = 0; i <= 8; i++)
    {
      await stake(10_000, users[i]);
      waitForRounds(TIME_LOCK+1);

      if(i == 7)
      {
        const voters = generateUsers(accountGenerator,4);
        const requester = accountGenerator.generateAccount();

        const state = await getGlobalStateMain(mainAppId, algodClient);
      
        const VOTE_REFILL_THRESHOLD = 550;
        const VOTE_REFILL_AMOUNT = 4;
        const upsGroup = update_protocol_settings(
          {
            user: user, 
            appId: mainAppId, 
            suggestedParams: await algodClient.getTransactionParams().do(),
            manager: state.manager_address,
            refund_request_made_percentage: state.refund_processing_percentage,
            refund_processing_percentage: state.refund_processing_percentage,
            algo_request_fee: state.algo_request_fee,
            gora_request_fee: state.gora_request_fee,
            voting_threshold: state.voting_threshold,
            time_lock: state.time_lock,
            vote_refill_threshold: VOTE_REFILL_THRESHOLD, // just updating vote_refill so that we can test it easier
            vote_refill_amount: VOTE_REFILL_AMOUNT,
            subscription_token_lock: state.subscription_token_lock
          }
        );
        await upsGroup.execute(algodClient, 5);

        for (const voter of voters) {
          testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
        }

        testState.ephemeral_map = await participation_optin(appAddress,testState,users[0]);

        testState.ephemeral_map = await test_optin(requester, mainAppId, testState, accountGenerator);
        await waitForRounds(TIME_LOCK + 1);
        for (const voter of voters) {
          await voter_setup(voter, mainAppId, votingAppId, testState);
        }

        const delegatorParticipationAccount = testState.ephemeral_map.get(appAddress)!;

        const registerVoterGroup = registerVoter({
          user: delegatorParticipationAccount,
          primaryAccount: appAddress,
          votingAppId: votingAppId,
          mainAppId: mainAppId,
          suggestedParams: await testState.algodClient.getTransactionParams().do()
        });
        await registerVoterGroup.execute(testState.algodClient, 5);

        await voter_setup(requester, mainAppId, votingAppId, testState);

        //initial vote, should result in no rewards
        //wait for participation key lock to expire 
        await waitForRounds(TIME_LOCK);
        fundAccount(user.addr, 0);
        let result;
        ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
        let request_result = result;
        let key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
        const old_key_hash = Buffer.from(key_hash).toString("base64");

        await testVote({
          algodClient,
          voter: delegatorParticipationAccount,
          userVote: encodeUint64(100_000),
          mainAppId,
          votingAppId,
          destinationAppId,
          requesterAddress: requester.addr,
          primaryAccount: appAddress,
          methodSelector: consumerMethod,
          requestRound: current_request_round,
          network: network,
          voteVerifyLsig,
          timelock: TIME_LOCK,
          request_key_hash: key_hash
        });

        for (let i = 0; i < voters.length; i++) {
          const voter = voters[i];
          const participationAccount = testState.ephemeral_map.get(voter.addr);
          if (!participationAccount) {
            throw new Error("Participation account does not exist for voter");
          }
          const vote = testVote({
            algodClient,
            voter: participationAccount,
            userVote: encodeUint64(100_000),
            mainAppId,
            votingAppId,
            destinationAppId,
            requesterAddress: requester.addr,
            primaryAccount: voter.addr,
            methodSelector: consumerMethod,
            requestRound: current_request_round,
            network: network,
            voteVerifyLsig,
            timelock: TIME_LOCK,
            request_key_hash: key_hash
          });
          try {
            await vote;
          } catch (e) {
            // case where voter votes on an already completed request due to randomness in number of votes assigned to each voter
            await expect(vote).rejects.toThrowError("1000004");
            break;
          }      
        }

        const app_id = 1234;
        const dest_method = consumerContract.methods[0].getSelector();
        const url_buf: Uint8Array = new Uint8Array(Buffer.from("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1"));
        const path_buf: Uint8Array = new Uint8Array(Buffer.from("market_cap"));
        const userdata = new Uint8Array(Buffer.from("Hello world"));
        const source_id = 0;
        const requestArgs = RequestArgsType.encode([[[source_id, [url_buf, path_buf], 60]], 0, userdata]);

        const request_group = request({
          user: voters[1],
          appID: mainAppId,
          suggestedParams: testState.suggestedParams,
          request_args: requestArgs,
          destination: DestinationType.encode([app_id, dest_method]),
          type: 0,
          key: Buffer.from("foo"),
          appRefs: [],
          assetRefs: [],
          accountRefs: [],
          boxRefs: []
        });
        request_result = await request_group.execute(algodClient, 5);
        key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
        const request_info = await getRequestInfo(mainAppId, key_hash, algodClient);
        current_request_round = request_info.request_round;

        const globalStateVote = await getGlobalStateVote(votingAppId, algodClient);
        const appAddressVoteCount = globalStateVote.previous_vote[appAddress].proposal.vote_count;

        // user manually claiming own rewards
        let localStateMain = await getLocalStateMain(appAddress, mainAppId, algodClient);
        const preClaimVoterAlgo = localStateMain.account_algo;
        const preClaimVoterToken = localStateMain.account_token_amount;
        const globalStateMain = await getGlobalStateMain(mainAppId, algodClient);
        const expectedVoteCount: number = globalStateMain.requests_completed[old_key_hash].vote_count;
        await testVote({
          algodClient,
          voter: delegatorParticipationAccount,
          userVote: encodeUint64(1),
          mainAppId,
          votingAppId,
          destinationAppId,
          requesterAddress: voters[1].addr,
          primaryAccount: appAddress,
          requestRound: current_request_round,
          methodSelector: consumerMethod,
          network: network,
          voteVerifyLsig,
          timelock: TIME_LOCK,
          request_key_hash: key_hash
        });
        localStateMain = await getLocalStateMain(appAddress, mainAppId, algodClient);
        const postClaimVoterAlgo = localStateMain.account_algo;
        const postClaimVoterToken = localStateMain.account_token_amount;
        const algoRewardResults: number = postClaimVoterAlgo - preClaimVoterAlgo;
        const tokenRewardResults: number = postClaimVoterToken - preClaimVoterToken;
        expectedRewards = Math.floor(appAddressVoteCount * 100 / expectedVoteCount);
        expect(expectedRewards).toEqual(algoRewardResults);
        expect(expectedRewards).toEqual(tokenRewardResults);
      }
    }
    
    await waitForRounds(TIME_LOCK * 3);
    const delegatorGlobal = await getGlobal(appId);
    const availableAlgoRewards = expectedRewards - expectedRewards * delegatorGlobal.manager_algo_share;
    const availableGoraRewards =  expectedRewards - expectedRewards * delegatorGlobal.manager_gora_share;
    const userStakeAmount = 0;
    await stake(userStakeAmount, users[0]);
    const postStakeLocal = await getLocal(appId,users[0].addr,algodClient);
    const userAlgoReward = postStakeLocal.local_non_stake.algo;
    const userGoraReward = postStakeLocal.local_non_stake.gora - userStakeAmount;
    expect(Math.floor(availableAlgoRewards / postStakeLocal.last_update_time)).toEqual(userAlgoReward);
    expect(Math.floor(availableGoraRewards / postStakeLocal.last_update_time)).toEqual(userGoraReward);

    const predictedLocal2 = await getPredictedLocal(appId, users[9].addr); // this user didn't get a chance to stake before the round was over

    //everyone has the same staketime since the "time" element is aggregation rounds and everyone staked during the first aggregation round
    expect(Math.floor(predictedLocal2.predicted_rewards_algo)).toEqual(0);
    expect(Math.floor(predictedLocal2.predicted_rewards_gora)).toEqual(0);

    //claim rewards
    const userClient = getDelegatorClient(users[1]);
    const transferTxn = {
      txn: makePaymentTxnWithSuggestedParamsFromObject({
        from: users[1].addr,
        suggestedParams: await userClient.client.getTransactionParams().do(),
        amount: 1000,
        to: appAddress,
      }),
      signer: makeBasicAccountTransactionSigner(users[1])
    };
    let asset_info_result = await userClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    let assetBalance_pre = asset_info_result["asset-holding"]["amount"];
    let account_info_result = await userClient.client.accountInformation(users[1].addr).do();
    const algo_balance_pre = account_info_result["amount"];

    await userClient.user_claim({pay: transferTxn, asset_reference: BigInt(testAsset), main_app_reference: BigInt(mainAppId), manager_reference: sandboxAccount.addr});
    asset_info_result = await userClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    let assetBalance_post = asset_info_result["asset-holding"]["amount"];
    account_info_result = await userClient.client.accountInformation(users[1].addr).do();
    const algo_balance_post = account_info_result["amount"];
    
    expect(Math.round(3000 + algo_balance_post - algo_balance_pre)).toEqual(userAlgoReward); //3k because 3 txns
    expect(Math.round(assetBalance_post - assetBalance_pre)).toEqual(userGoraReward);

    await sleep_rounds(goracle_timelock, sandboxAccount);
    //unstake 
    await unstake(10_000, users[1]);

    await sleep_rounds(goracle_timelock, sandboxAccount);

    asset_info_result = await userClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    assetBalance_pre = asset_info_result["asset-holding"]["amount"];

    await userClient.withdraw_non_stake({
      vesting_on_behalf_of: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
      goracle_token_reference: BigInt(testAsset),
      main_app_reference: BigInt(mainAppId),
      manager_reference: sandboxAccount.addr
    });

    asset_info_result = await userClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    assetBalance_post = asset_info_result["asset-holding"]["amount"];
    expect(assetBalance_post - assetBalance_pre).toEqual(10_000);
  });

  it("manager key registration", async () => {
    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, appAddress, 800_000);
    //opt in all users
    for(let i = 0; i < users.length; i++)
    {
      const userClient = getDelegatorClient(users[i]);
      await userClient.optIn();
    }
    const result = await sandboxAppClient.init_app({asset: BigInt(testAsset), timelock: BigInt(goracle_timelock), main_app_id: BigInt(mainAppId), manager_address: sandboxAccount.addr, manager_algo_share: BigInt(0), manager_gora_share: BigInt(0)});

    //should not allow non manager to change participation key
    const userClient = getDelegatorClient(users[0]);
  
    await expect(userClient.register_participation_key({new_key: users[0].addr, main_ref: BigInt(mainAppId)})).rejects.toThrow("assert failed");
    
    //should allow manager to register
    expect(await sandboxAppClient.register_participation_key({new_key: users[0].addr, main_ref: BigInt(mainAppId)}));

    const local_state = await getLocalStateMain(appAddress, mainAppId, sandboxAppClient.client);
    expect(local_state.local_public_key).toEqual(users[0].addr);
  });
});