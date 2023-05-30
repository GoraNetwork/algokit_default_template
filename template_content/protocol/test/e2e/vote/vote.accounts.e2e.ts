import path from "path";
import {
  Algodv2,
  Account,
  getApplicationAddress,
  LogicSigAccount,
  decodeAddress,
  encodeUint64,
} from "algosdk";
import {
  loadABIContract,
  parseAppState,
  sendASA,
  optIn
} from "algoutils";
import {
  fundAccount
} from "algotest";
import {
  getGlobalStateMain,
  getLocalStateMain,
  getGlobalStateVote,
  testAssert,
} from "../../../utils/gora_utils";
import {
  getRequestInfo,
} from "../../../utils/gora_utils";
import {
  requestRefund,
  userOptOut,
  update_protocol_settings,
  userOptIn,
} from "../../../assets/transactions/main_transactions";

import {
  deleteBox,
  deregisterVoter,
  registerVoter
} from "../../../assets/transactions/vote_transactions";
import {
  claimRewards,
  depositAlgo,
  depositToken,
  stake,
  registerKey,
} from "../../../assets/transactions/staking_transactions";
import {
  testVote,
  waitForRounds
} from "../../util/utils";
import {
  DestinationType,
  LocalHistoryType,
  RequestArgsType,
} from "../../../utils/abi_types";
import {
  beforeEachVotingTest,
  submit_test_request,
  requesterSetup,
  voter_setup,
  test_optin,
  VotingTestState,
  AccountGenerator,
  generateUsers,
  checkRewards,
} from "./voting.helpers";

import { request } from "../../../assets/transactions/request_transactions";
import accounts from "../../test_fixtures/accounts.json";
import errorCodes from "../../../assets/smart_assert_errors.json";

const ABI_PATH = "../../../test/test_fixtures/consumer-contract.json";
const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));
const consumerMethod = consumerContract.methods[0].getSelector();

describe("Deploy Voting Contracts e2e", () => {
  let testState: VotingTestState;
  let votingAppId: number;
  let mainAppId: number;
  let destinationAppId: number;
  let platformTokenAssetId: number;
  let algodClient: Algodv2;
  let voteVerifyLsig: LogicSigAccount;
  let user: Account;
  let alt_user: Account;
  let mainAccount: Account;
  let current_request_round: any;
  // TODO: parameterize and pass into main contract deployment
  let TIME_LOCK: number;
  let goraRequestFee: number;
  let algoRequestFee: number;
  let requestBoxCost: number;
  let VOTE_REFILL_THRESHOLD: number;
  let VOTE_REFILL_AMOUNT: number;
  let accountGenerator: AccountGenerator;

  beforeEach(async () => {
    // Configure fresh variables for each test 
    accountGenerator = new AccountGenerator(accounts);

    testState = await beforeEachVotingTest(accountGenerator);
    // flatten the testState object
    ({ current_request_round, votingAppId, mainAppId, destinationAppId, platformTokenAssetId, algodClient, voteVerifyLsig, user, alt_user, mainAccount, TIME_LOCK, goraRequestFee, algoRequestFee, requestBoxCost, VOTE_REFILL_THRESHOLD, VOTE_REFILL_AMOUNT } = testState);
  });
  
  it("should reject if lsig is paying a txn fee", async () => {
    const voters = generateUsers(accountGenerator,3);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    await waitForRounds(TIME_LOCK + 1);
    // print ephemeral map
    const participationAccount = testState.ephemeral_map.get(voters[2].addr);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voters[0], undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const suggestedParams = await algodClient.getTransactionParams().do();
    if (!participationAccount) {
      throw new Error("Participation account does not exist for voter");
    }

    //propose the request
    const vote = testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(10),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: voters[2].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[0].addr),
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash,
      voteVerifyParams: suggestedParams
    });
    expect(async() => await vote).rejects.toThrowError("rejected by logic err=assert failed");
  });

  it("should allow a requester to refund request outside of the request timeout", async () => {
    const voters = generateUsers(accountGenerator,4);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    await waitForRounds(TIME_LOCK + 1);
    let localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    const preRequestAccountAlgo = localStateMain.account_algo;
    // print ephemeral map
    let participationAccount = testState.ephemeral_map.get(voters[2].addr);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voters[0], undefined, testState));
    let key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const suggestedParams = await algodClient.getTransactionParams().do();
    if (!participationAccount) {
      throw new Error("Participation account does not exist for voter");
    }

    //propose the request
    let results = await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(10),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: voters[2].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[0].addr),
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });
    let appInfo = await algodClient.getApplicationByID(votingAppId).do();
    let globalState = parseAppState(appInfo.params["global-state"]);
    expect(globalState["r"]).toEqual(1);

    // wait for request to expire
    await waitForRounds(41);

    participationAccount = testState.ephemeral_map.get(voters[1].addr);
    if (!participationAccount) {
      throw new Error("Participation account not found");
    }

    localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    const postRequestAccountAlgo = localStateMain.account_algo;
    const postRequestAccountGora = localStateMain.account_token_amount;

    expect(preRequestAccountAlgo - postRequestAccountAlgo - algoRequestFee - requestBoxCost).toEqual(0);
    await requestRefund({ algodClient, requesterAccount: voters[0], mainAppId, requestKeyHash: key_hash });
    localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    const postRefundAccountGora = localStateMain.account_token_amount;
    const postRefundAccountAlgo = localStateMain.account_algo;

    expect(postRefundAccountGora - postRequestAccountGora).toEqual(goraRequestFee);

    appInfo = await algodClient.getApplicationByID(votingAppId).do();
    globalState = parseAppState(appInfo.params["global-state"]);
    expect(globalState["r"]).toEqual(1);

    participationAccount = testState.ephemeral_map.get(voters[3].addr);
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voters[1], undefined, testState));
    key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    if (!participationAccount) {
      throw new Error("Participation account does not exist for voter");
    }

    //propose the request
    results = await testVote({
      algodClient,
      voter: participationAccount,
      userVote: "abcd",
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[1].addr,
      primaryAccount: voters[3].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[1].addr),
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    appInfo = await algodClient.getApplicationByID(votingAppId).do();
    globalState = parseAppState(appInfo.params["global-state"]);

    expect(globalState["r"]).toEqual(2);

    localStateMain = await getLocalStateMain(voters[2].addr, mainAppId, algodClient);
    const preClaimRewards = localStateMain.account_algo;

    const claimRewardsGroup = await claimRewards({
      primaryAccount: voters[2],
      rewardsAddress: voters[2].addr,
      appId: mainAppId,
      votingAppId: votingAppId,
      suggestedParams: suggestedParams,
      client: algodClient
    });
    await claimRewardsGroup.execute(algodClient, 5);
    localStateMain = await getLocalStateMain(voters[2].addr, mainAppId, algodClient);
    const postClaimRewards = localStateMain.account_algo;
    // since request simply expired, rewards returned are the txn fees for voting and claiming rewards
    expect(postClaimRewards - preClaimRewards).toEqual(2*1000);
    localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    const postBoxDeleteAccountAlgo = localStateMain.account_algo;
    //since someone voted they are entitled to get their txn fees refunded from the request fee
    expect(postBoxDeleteAccountAlgo - postRefundAccountAlgo).toEqual(requestBoxCost + algoRequestFee - 2*1000);
  });

  it("should allow a requester to refund request outside of the request timeout that hasn't been proposed", async () => {
    const voters = generateUsers(accountGenerator,3);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    await waitForRounds(TIME_LOCK + 1);

    let localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    const preRequestAccountAlgo = localStateMain.account_algo;

    let participationAccount = testState.ephemeral_map.get(voters[2].addr);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voters[0], undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    if (!participationAccount) {
      throw new Error("Participation account does not exist for voter");
    }

    // wait for request to expire
    await waitForRounds(41);

    participationAccount = testState.ephemeral_map.get(voters[1].addr);
    if (!participationAccount) {
      throw new Error("Participation account not found");
    }

    localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    const postRequestAccountAlgo = localStateMain.account_algo;
    const postRequestAccountGora = localStateMain.account_token_amount;

    expect(preRequestAccountAlgo - postRequestAccountAlgo - algoRequestFee - requestBoxCost).toEqual(0);
    await requestRefund({ algodClient, requesterAccount: voters[0], mainAppId, requestKeyHash: key_hash });

    localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    const postRefundAccountAlgo = localStateMain.account_algo;
    const postRefundAccountGora = localStateMain.account_token_amount;

    expect(postRefundAccountGora - postRequestAccountGora).toEqual(goraRequestFee);
    expect(postRefundAccountAlgo - postRequestAccountAlgo).toEqual(algoRequestFee + requestBoxCost);

  });

  it("should not let requester refund request if request was already refunded", async () => {
    const requester = accountGenerator.generateAccount();

    await fundAccount(requester.addr, 10e6);

    testState.ephemeral_map = await test_optin(requester, mainAppId, testState, accountGenerator);
    await waitForRounds(TIME_LOCK + 1);
    await voter_setup(requester, mainAppId, votingAppId, testState);

    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    const requestKeyHash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    await waitForRounds(41);

    const results = await requestRefund({ algodClient, requesterAccount: requester, mainAppId, requestKeyHash });

    await testAssert(requestRefund({ algodClient, requesterAccount: requester, mainAppId, requestKeyHash }),errorCodes[8]);
  });

  it("should let any user delete old boxes", async () => {
    const voters = generateUsers(accountGenerator,10);
    const randomUsers = generateUsers(accountGenerator,2);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    for (const randomUser of randomUsers) {
      testState.ephemeral_map = await test_optin(randomUser, mainAppId, testState, accountGenerator);
      await voter_setup(randomUser, mainAppId, votingAppId, testState);
    }
    const requesters = generateUsers(accountGenerator,2);
    for (const requester of requesters) {
      await fundAccount(requester.addr, 10e6);
      testState.ephemeral_map = await test_optin(requester, mainAppId, testState, accountGenerator);
      await waitForRounds(TIME_LOCK + 1);
      await voter_setup(requester, mainAppId, votingAppId, testState);

    }
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requesters[0], undefined, testState));
    let key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const old_key_hash = Buffer.from(key_hash).toString("base64");
    for (const voter of voters) {
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account not found");
      }
      const vote = testVote({
        algodClient,
        voter: participationAccount,
        userVote: encodeUint64(30),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: requesters[0].addr,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: testState.request_map.get(requesters[0].addr),
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      try {
        await vote;
      } catch (e) {
        // case where voter votes on an already completed request due to randomness in number of votes assigned to each voter
        await testAssert(vote,errorCodes[2]);
        await waitForRounds(TIME_LOCK + 1);
        ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requesters[1], undefined, testState));
        key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
        const participationAccount = testState.ephemeral_map.get(randomUsers[0].addr);
        if (!participationAccount) {
          throw new Error("Participation account not found");
        }
        await testVote({
          algodClient,
          voter: participationAccount,
          userVote: "efgh",
          mainAppId,
          votingAppId,
          destinationAppId,
          requesterAddress: requesters[1].addr,
          primaryAccount: randomUsers[0].addr,
          methodSelector: consumerMethod,
          requestRound: testState.request_map.get(requesters[1].addr),
          voteVerifyLsig,
          timelock: TIME_LOCK,
          request_key_hash: key_hash
        });
        const globalStateMain = await getGlobalStateMain(mainAppId, algodClient);
        const voteHash = globalStateMain.requests_completed[old_key_hash].vote_hash;
        await deleteBox(randomUsers[0], voteHash, votingAppId, testState.suggestedParams, algodClient);
        break;
      }

      const globalStateMain = await getGlobalStateMain(mainAppId, algodClient);
      let voteHash: any;
      try {
        voteHash = globalStateMain.requests_not_completed[Buffer.from(key_hash).toString("base64")].vote_hash;
      } catch (e) {
        voteHash = globalStateMain.requests_completed[Buffer.from(key_hash).toString("base64")].vote_hash;
      }
      await expect(
        deleteBox(randomUsers[0], voteHash, votingAppId, testState.suggestedParams, algodClient)
      ).rejects.toThrowError();
    }
  });

  it("should let a primary account deregister a participation account", async () => {
    const voters = generateUsers(accountGenerator,4);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);

    const requester = accountGenerator.generateAccount();
    testState.ephemeral_map = await test_optin(requester, mainAppId, testState, accountGenerator);
    await requesterSetup(
      requester,
      mainAppId,
      20_000_000_000,
      1e9,
      testState,
    );
    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);

    let participationAccounts: Account[] = [];
    for (let i = 0; i < voters.length; i++) {
      const participationAccount = testState.ephemeral_map.get(voters[i].addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }
      participationAccounts = participationAccounts.concat(participationAccount);
      await voter_setup(voters[i], mainAppId, votingAppId, testState, participationAccount);
      await waitForRounds(TIME_LOCK);
      fundAccount(user.addr, 0);
    }
    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    let key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    const voteCounts = [];
    const deregisterAccount = voters[0];
    const participationAccount = participationAccounts[0];
    const { voteCount } = await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(10),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      requestRound: current_request_round,
      primaryAccount: deregisterAccount.addr,
      methodSelector: consumerMethod,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });
    voteCounts.push(voteCount);
    const deregisterGroup = await deregisterVoter({
      user: participationAccount,
      primaryAccount: deregisterAccount.addr,
      votingAppId: votingAppId,
      mainAppId: mainAppId,
      suggestedParams: testState.suggestedParams,
    });
    await testAssert(deregisterGroup.execute(algodClient, 5),errorCodes[7]);
    await waitForRounds(TIME_LOCK + 1);
    ({ result, current_request_round, request_map: testState.request_map } = await submit_test_request(requester, "bar", testState));
    key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    fundAccount(requester.addr, 0);
    await testVote({
      algodClient,
      voter: participationAccounts[1],
      userVote: encodeUint64(10),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      requestRound: current_request_round,
      primaryAccount: voters[1].addr,
      methodSelector: consumerMethod,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });
    await deregisterGroup.execute(algodClient, 5);
  });

  it("should allow manual rewards claims", async () => {
    const voters = generateUsers(accountGenerator,5);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    const requesters = generateUsers(accountGenerator,2);
    for (const requester of requesters) {
      await fundAccount(requester.addr, 10e6);
      testState.ephemeral_map = await test_optin(requester, mainAppId, testState, accountGenerator);
      await waitForRounds(TIME_LOCK + 1);
      await voter_setup(requester, mainAppId, votingAppId, testState);

    }
    let result;
    ({ result, current_request_round, request_map: testState.request_map } = await submit_test_request(requesters[0], undefined, testState));
    let key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const old_key_hash = Buffer.from(key_hash).toString("base64");
    for (const voter of voters) {
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account not found");
      }
      const vote = testVote({
        algodClient,
        voter: participationAccount,
        userVote: encodeUint64(1),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: requesters[0].addr,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: testState.request_map.get(requesters[0].addr),
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      try {
        await vote;
      } catch (e) {
        // case where voter votes on an already completed request due to randomness in number of votes assigned to each voter
        await testAssert(vote,errorCodes[2]);
        break;
      }      
    }

    const globalStateVote = await getGlobalStateVote(votingAppId, algodClient);

    const randomUsers = generateUsers(accountGenerator,2);

    for (const randomUser of randomUsers) {
      testState.ephemeral_map = await test_optin(randomUser, mainAppId, testState, accountGenerator);
      await voter_setup(randomUser, mainAppId, votingAppId, testState);
    }

    await waitForRounds(TIME_LOCK + 1);
    await fundAccount(voters[0].addr,0);

    ({ result, current_request_round, request_map: testState.request_map } = await submit_test_request(requesters[1], undefined, testState));
    key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    await testVote({
      algodClient,
      voter: testState.ephemeral_map.get(randomUsers[0].addr) as Account,
      userVote: encodeUint64(100),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requesters[1].addr,
      primaryAccount: randomUsers[0].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(requesters[1].addr),
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    // user manually claiming own rewards
    let localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);
    let claimRewardsGroup = await claimRewards({
      primaryAccount: voters[0],
      rewardsAddress: voters[0].addr,
      appId: mainAppId,
      votingAppId: votingAppId,
      suggestedParams: testState.suggestedParams,
      client: algodClient
    });
    await claimRewardsGroup.execute(algodClient, 5);
    await checkRewards(localStateMain,globalStateVote,voters[0],old_key_hash,mainAppId,algodClient);

    // user attempting to manually claim someone else's rewards while other user is still opted into Main
    localStateMain = await getLocalStateMain(voters[1].addr, mainAppId, algodClient);

    claimRewardsGroup = await claimRewards({
      primaryAccount: voters[0],
      rewardsAddress: voters[1].addr,
      appId: mainAppId,
      votingAppId: votingAppId,
      suggestedParams: testState.suggestedParams,
      client: algodClient
    });
    await claimRewardsGroup.execute(algodClient, 5);
    await checkRewards(localStateMain,globalStateVote,voters[1],old_key_hash,mainAppId,algodClient);

    const optOutGroup = userOptOut({
      user: voters[2],
      appId: mainAppId,
      suggestedParams: testState.suggestedParams
    });
    await optOutGroup.execute(algodClient, 5);
    // user claiming other's rewards after other has opted out

    localStateMain = await getLocalStateMain(voters[0].addr, mainAppId, algodClient);

    claimRewardsGroup = await claimRewards({
      primaryAccount: voters[0],
      rewardsAddress: voters[2].addr,
      appId: mainAppId,
      votingAppId: votingAppId,
      suggestedParams: testState.suggestedParams,
      client: algodClient
    });
    await claimRewardsGroup.execute(algodClient, 5);
    await checkRewards(localStateMain,globalStateVote,voters[0],old_key_hash,mainAppId,algodClient,voters[2]);
  });

  it("should allow corresponding voters to claim rewards", async () => {
    const adversary = generateUsers(accountGenerator,2);
    const voters = generateUsers(accountGenerator,6);
    const requester = accountGenerator.generateAccount();

    const state = await getGlobalStateMain(mainAppId, algodClient);
  
    VOTE_REFILL_THRESHOLD = 100_000;
    VOTE_REFILL_AMOUNT = 4;
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

    for (const voter of adversary) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    testState.ephemeral_map = await test_optin(requester, mainAppId, testState, accountGenerator);
    await waitForRounds(TIME_LOCK + 1);
    for (const voter of adversary) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    await voter_setup(requester, mainAppId, votingAppId, testState);

    const evilParticipationAccount = testState.ephemeral_map.get(adversary[0].addr);
    if (!evilParticipationAccount) {
      throw new Error("Adversary participation account does not exist");
    }

    //initial vote, should result in no rewards
    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    let request_result = result;
    let key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    for (const voter of adversary) {
      const result = await testVote({
        algodClient,
        voter: testState.ephemeral_map.get(voter.addr)!,
        userVote: encodeUint64(10_000),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: requester.addr,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: current_request_round,
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
    }

    const USER_STAKE = 5000;
    const voteCounts = [];
    let users_voted = 0;
    let old_vote_hash;
    for (let i = 0; i < voters.length; i++) {
      const voter = voters[i];
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }
      const { voteCount, result, vote_hash } = await testVote({
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
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      const global_state = await getGlobalStateVote(votingAppId, algodClient);
      expect(global_state.proposals[Buffer.from(vote_hash).toString("base64")]);
      // TODO bandaid fix because each voter has different votecounts for some reason (we're looking into it)
      if (typeof result.methodResults[0].txInfo!["inner-txns"] !== undefined && typeof result.methodResults[0].txInfo!["inner-txns"] !== "undefined") {
        if (result.methodResults[0].txInfo!["inner-txns"].length == 2) {
          old_vote_hash = Buffer.from(vote_hash).toString("base64");
          users_voted = i;
          break;
        }
      }
      voteCounts.push(voteCount);
    }

    const app_id = 1234;
    const dest_method = consumerContract.methods[0].getSelector();
    const old_key_hash = Buffer.from(key_hash).toString("base64");
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
    const totalVotes = voteCounts.reduce((a, b) => a + b, 0);

    let evil_state_pre = await getLocalStateMain(adversary[1].addr, mainAppId, algodClient);
    //follow up vote, should get votes from history and add to rewards counter
    //adversary voter should not get any rewards, plus should still be able to vote even though their previous history box has now been deleted (due to wrong vote)
    await testVote({
      algodClient,
      voter: testState.ephemeral_map.get(adversary[1].addr)!,
      userVote: encodeUint64(BigInt("18446744073709551615")), //max uint64
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[1].addr,
      primaryAccount: adversary[1].addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    let evil_state_post = await getLocalStateMain(adversary[1].addr, mainAppId, algodClient);
    expect(evil_state_post.account_token_amount).toEqual(evil_state_pre.account_token_amount);

    //first we're going to try to get the adversary to try to trick the system by doubling their votes that they pass in.
    const previousVoteBox = await algodClient.getApplicationBoxByName(votingAppId, decodeAddress(adversary[0].addr).publicKey).do();
    const previousVoteEntry: any = LocalHistoryType.decode(previousVoteBox.value);
    //try to double the amount of votes than what you caseted
    previousVoteEntry[1][1] = Number(previousVoteEntry[1][1]) * 2;
    const modifiedPreviousVote = LocalHistoryType.encode(previousVoteEntry);

    await testAssert(testVote({
      algodClient,
      voter: evilParticipationAccount,
      userVote: encodeUint64(10_000),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[1].addr,
      primaryAccount: adversary[0].addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash,
      mockPreviousVote: modifiedPreviousVote
    }),errorCodes[6]);

    expect(users_voted).toBeGreaterThan(0); // can't properly do this test if no one got to vote
    let requester_info = await getLocalStateMain(requester.addr, mainAppId, algodClient);
    const old_requester_account_balance = requester_info.account_algo;

    //test to make sure that key hash was exists
    for (let i = 0; i <= users_voted; i++) {
      const voter = voters[i];
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }

      let accountInfo = await algodClient.accountInformation(getApplicationAddress(votingAppId)).do();
      let former_amount = 0;
      if (accountInfo.amount - accountInfo["min-balance"] < (VOTE_REFILL_THRESHOLD * 1000)) // test if vote contract gas refill is going to happen
      {
        former_amount = accountInfo.amount;
      }
      const voterStatePre = await getLocalStateMain(voter.addr, mainAppId, algodClient);
      const voteStatePre = await getGlobalStateVote(votingAppId,algodClient);
      const { voteCount, result, vote_hash } = await testVote({
        algodClient,
        voter: participationAccount,
        userVote: encodeUint64(1),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: voters[1].addr,
        primaryAccount: voter.addr,
        requestRound: current_request_round,
        methodSelector: consumerMethod,
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      const global_state = await getGlobalStateVote(votingAppId, algodClient);
      //test to make sure that old key hash was deleted
      expect(global_state.proposals).not.toContain(old_vote_hash);
      // TODO bandaid fix because each voter has different votecounts for some reason (we're looking into it)
      if (typeof result.methodResults[0].txInfo!["inner-txns"] !== undefined && typeof result.methodResults[0].txInfo!["inner-txns"] !== "undefined") {
        if (result.methodResults[0].txInfo!["inner-txns"].length == 2) {
          break;
        }
      }
      await checkRewards(voterStatePre,voteStatePre,voter,old_key_hash,mainAppId,algodClient);

      accountInfo = await algodClient.accountInformation(voter.addr).do();

      accountInfo = await algodClient.accountInformation(getApplicationAddress(votingAppId)).do();
      expect(accountInfo.amount - former_amount).toBe(1000 * (VOTE_REFILL_AMOUNT - 1));
    }
    requester_info = await getLocalStateMain(requester.addr, mainAppId, algodClient);

    const new_requester_account_balance = requester_info.account_algo;
    //expect requester to get their box fee refunded
    expect(new_requester_account_balance).toEqual(old_requester_account_balance + requestBoxCost);

    ({ result, current_request_round, request_map: testState.request_map } = await submit_test_request(voters[0], "bar", testState));
    request_result = result;

    key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    evil_state_pre = await getLocalStateMain(adversary[0].addr, mainAppId, algodClient);
    //adversary voter should not get any rewards, plus should still be able to vote even though their previous history box has now been deleted (due to wrong vote)
    await testVote({
      algodClient,
      voter: evilParticipationAccount,
      userVote: encodeUint64(0),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: adversary[0].addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    evil_state_post = await getLocalStateMain(adversary[0].addr, mainAppId, algodClient);
    expect(evil_state_post.account_token_amount).toEqual(evil_state_pre.account_token_amount);
  });

  it("should allow rewards for coexisting minimum and maximum stake", async () => {
    const whale = accountGenerator.generateAccount();
    const shrimp = accountGenerator.generateAccount();
    const requester = accountGenerator.generateAccount();

    // empty default accounts
    await sendASA({
      from: user,
      to: mainAccount.addr,
      assetId: platformTokenAssetId,
      amount: 50_000_000_000_000
    });
    await sendASA({
      from: alt_user,
      to: mainAccount.addr,
      assetId: platformTokenAssetId,
      amount: 50_000_000_000_000
    });

    // set up requester with 1 GORA
    const suggestedParams = await testState.algodClient.getTransactionParams().do();
    const optInGroup = userOptIn({ user: requester, appId: mainAppId, suggestedParams: suggestedParams });
    await optInGroup.execute(testState.algodClient, 5);

    const requesterGora = 2_000_000_000;
    await fundAccount(requester.addr, 1e9);
    await optIn(testState.platformTokenAssetId, requester);
    await sendASA({
      from: testState.mainAccount,
      to: requester.addr,
      assetId: testState.platformTokenAssetId,
      amount: requesterGora
    });

    const depositAlgoGroup = depositAlgo({
      user: requester,
      appId: mainAppId,
      suggestedParams: await testState.algodClient.getTransactionParams().do(),
      amount: 1e9
    });
  
    await depositAlgoGroup.execute(testState.algodClient, 5);
  
    const depositTokenGroup = depositToken({
      platformTokenAssetId: testState.platformTokenAssetId,
      user: requester,
      appId: mainAppId,
      suggestedParams: await testState.algodClient.getTransactionParams().do(),
      amount: requesterGora
    });
  
    await depositTokenGroup.execute(testState.algodClient, 5);

    // min stake is 10,000 GORA
    const min_stake = 10_000_000_000_000;
    await fundAccount(shrimp.addr, 1e9);
    await optIn(testState.platformTokenAssetId, shrimp);
    await sendASA({
      from: testState.mainAccount,
      to: shrimp.addr,
      assetId: testState.platformTokenAssetId,
      amount: min_stake
    });

    const shrimpParticipationAccount = accountGenerator.generateAccount();

    let ephemeral_map_new = new Map(testState.ephemeral_map);
    ephemeral_map_new.set(shrimp.addr, shrimpParticipationAccount);
    await fundAccount(shrimpParticipationAccount.addr, 1_500_000);

    //opt ephemeral account into staking contract
    const shrimpPartOptInGroup = userOptIn({ user: shrimpParticipationAccount, appId: mainAppId, suggestedParams: await testState.algodClient.getTransactionParams().do() });
    await shrimpPartOptInGroup.execute(testState.algodClient, 5);

    //opt main account into staking contract
    const shrimpOptInGroup = userOptIn({ user: shrimp, appId: mainAppId, suggestedParams: await testState.algodClient.getTransactionParams().do() });
    await shrimpOptInGroup.execute(testState.algodClient, 5);

    const registerGroup = registerKey({
      user: shrimp,
      appId: mainAppId,
      publicKey: shrimpParticipationAccount.addr,
      suggestedParams: await testState.algodClient.getTransactionParams().do()
    });
    await registerGroup.execute(testState.algodClient, 5);

    //register ephemeral account into voting contract
    const shrimpRegisterVoterGroup = registerVoter({
      user: shrimpParticipationAccount,
      primaryAccount: shrimp.addr,
      votingAppId: votingAppId,
      mainAppId: mainAppId,
      suggestedParams: await testState.algodClient.getTransactionParams().do()
    });
    await shrimpRegisterVoterGroup.execute(testState.algodClient, 5);

    const shrimpStakeGroup = stake({
      platformTokenAssetId,
      user: shrimp,
      amount: min_stake,
      suggestedParams: await testState.algodClient.getTransactionParams().do(),
      appId: mainAppId
    });

    await shrimpStakeGroup.execute(testState.algodClient, 5);

    // max stake is 100,000,000 - 10,000 - 2 = 99989999
    const whaleStake = BigInt(100_000_000_000_000_000) - BigInt(min_stake) - BigInt(requesterGora);  //99_989_990_000_000_000;
    await fundAccount(whale.addr, 1e9);
    await optIn(testState.platformTokenAssetId, whale);
    await sendASA({
      from: testState.mainAccount,
      to: whale.addr,
      assetId: testState.platformTokenAssetId,
      amount: whaleStake
    });

    const whaleParticipationAccount = accountGenerator.generateAccount();

    ephemeral_map_new = new Map(testState.ephemeral_map);
    ephemeral_map_new.set(whale.addr, whaleParticipationAccount);
    await fundAccount(whaleParticipationAccount.addr, 1_500_000);

    //opt ephemeral account into staking contract
    const whalePartOptInGroup = userOptIn({ user: whaleParticipationAccount, appId: mainAppId, suggestedParams: await testState.algodClient.getTransactionParams().do() });
    await whalePartOptInGroup.execute(testState.algodClient, 5);

    //opt main account into staking contract
    const whaleOptInGroup = userOptIn({ user: whale, appId: mainAppId, suggestedParams: await testState.algodClient.getTransactionParams().do() });
    await whaleOptInGroup.execute(testState.algodClient, 5);

    const whaleRegisterGroup = registerKey({
      user: whale,
      appId: mainAppId,
      publicKey: whaleParticipationAccount.addr,
      suggestedParams: await testState.algodClient.getTransactionParams().do()
    });
    await whaleRegisterGroup.execute(testState.algodClient, 5);

    //register ephemeral account into voting contract
    const whaleRegisterVoterGroup = registerVoter({
      user: whaleParticipationAccount,
      primaryAccount: whale.addr,
      votingAppId: votingAppId,
      mainAppId: mainAppId,
      suggestedParams: await testState.algodClient.getTransactionParams().do()
    });
    await whaleRegisterVoterGroup.execute(testState.algodClient, 5);

    const whaleStakeGroup = stake({
      platformTokenAssetId,
      user: whale,
      amount: whaleStake,
      suggestedParams: await testState.algodClient.getTransactionParams().do(),
      appId: mainAppId
    });

    await whaleStakeGroup.execute(testState.algodClient, 5);

    // wait few rounds for voters keys to become valid
    await waitForRounds(TIME_LOCK);

    // make request
    let request_result;
    ({ result: request_result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    let key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    // shrimp votes
    await testVote({
      algodClient,
      voter: shrimpParticipationAccount,
      userVote: encodeUint64(1),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      primaryAccount: shrimp.addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash,
    });

    // whale votes
    await testVote({
      algodClient,
      voter: whaleParticipationAccount,
      userVote: encodeUint64(1),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      primaryAccount: whale.addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash,
    });

    request_result;
    ({ result: request_result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, "test", testState));
    key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    // whale votes and claims rewards
    await testVote({
      algodClient,
      voter: whaleParticipationAccount,
      userVote: encodeUint64(1),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      primaryAccount: whale.addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash,
    });

    // shrimp claims rewards
    const shrimpClaimRewardsGroup = await claimRewards({
      primaryAccount: shrimp,
      rewardsAddress: shrimp.addr,
      appId: mainAppId,
      votingAppId: votingAppId,
      suggestedParams: suggestedParams,
      client: algodClient
    });
    await shrimpClaimRewardsGroup.execute(algodClient, 5);

    const shrimpLocalStateMain = await getLocalStateMain(shrimp.addr, mainAppId, algodClient);

    const whaleLocalStateMain = await getLocalStateMain(whale.addr, mainAppId, algodClient);

    expect(shrimpLocalStateMain.account_algo).toEqual(1);
    expect(shrimpLocalStateMain.account_token_amount).toEqual(100000);

    expect(whaleLocalStateMain.account_algo).toEqual(9998);
    expect(whaleLocalStateMain.account_token_amount).toEqual(999899000);
  });

});