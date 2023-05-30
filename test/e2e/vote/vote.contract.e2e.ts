import path from "path";
import {
  Algodv2,
  Account,
  LogicSigAccount,
  encodeUint64,
} from "algosdk";
import {
  loadABIContract,
  sendASA,
} from "algoutils";
import {
  fundAccount
} from "algotest";
import {
  getGlobalStateMain,
  getLocalStateMain,
  getGlobalStateVote,
  testAssert} from "../../../utils/gora_utils";
import {
  init,
} from "../../../assets/transactions/main_transactions";
import {
  stake
} from "../../../assets/transactions/staking_transactions";
import {
  testVote,
  waitForRounds
} from "../../util/utils";

import {
  beforeEachVotingTest,
  submit_test_request,
  voter_setup,
  test_optin,
  VotingTestState,
  AccountGenerator,
  generateUsers,
} from "./voting.helpers";

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
  let algodClient: Algodv2;
  let voteVerifyLsig: LogicSigAccount;
  let user: Account;
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
    ({ votingAppId, mainAppId, destinationAppId, algodClient, voteVerifyLsig, user, TIME_LOCK, goraRequestFee, algoRequestFee, requestBoxCost, current_request_round } = testState);
  });

  it("should not fail even after large stake due to history", async () => {
    await sendASA({
      from: testState.mainAccount,
      to: user.addr,
      assetId: testState.platformTokenAssetId,
      amount: 50_000_000
    });

    await waitForRounds(TIME_LOCK+1);

    const voters = generateUsers(accountGenerator,3);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }

    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voters[2], undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    const stakingGroup = stake({
      platformTokenAssetId: testState.platformTokenAssetId, 
      user: user, 
      appId: mainAppId, 
      suggestedParams: testState.suggestedParams,
      amount: 50_000_000
    });
    await stakingGroup.execute(algodClient, 1);

    let innertxns = [];
    // let consumerMethodTxn
    for (const voter of voters) {
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }
      const results = await testVote({
        algodClient,
        voter: participationAccount,
        userVote: encodeUint64(100),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: voters[2].addr,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: current_request_round,
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      const txnInfo = results.result.methodResults[0].txInfo;
      if (txnInfo){
        if(Object.prototype.hasOwnProperty.call(txnInfo,"inner-txns")) {
          innertxns = txnInfo["inner-txns"];
          //the request completes
          if(innertxns.length == 2)
          {
            break;
          }
        }
      }
    }
    expect(innertxns.length).toEqual(2);
  });

  it("should fail after large stake before request", async () => {
    await sendASA({
      from: testState.mainAccount,
      to: user.addr,
      assetId: testState.platformTokenAssetId,
      amount: 50_000_000_000_000
    });

    const stakingGroup = stake({
      platformTokenAssetId: testState.platformTokenAssetId, 
      user: user, 
      appId: mainAppId, 
      suggestedParams: testState.suggestedParams,
      amount: 50_000_000_000_000
    });
    await stakingGroup.execute(algodClient, 1);

    await waitForRounds(TIME_LOCK+1);

    const voters = generateUsers(accountGenerator,3);
    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }

    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voters[2], undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    let innertxns;
    // let consumerMethodTxn
    for (const voter of voters) {
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }
      const results = await testVote({
        algodClient,
        voter: participationAccount,
        userVote: encodeUint64(BigInt("18446744073709551615")), // 2^64 - 1
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: voters[2].addr,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: current_request_round,
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      const txnInfo = results.result.methodResults[0].txInfo;
      if (txnInfo){
        if(Object.prototype.hasOwnProperty.call(txnInfo,"inner-txns")) {
          innertxns = txnInfo["inner-txns"];
        }
      }
    }
    expect(innertxns.length).toEqual(1);
  });

  it("should reject a second init", async () => {
    const initGroup = init({
      platformTokenAssetId: testState.platformTokenAssetId,
      user: testState.mainAccount, 
      appId: mainAppId, 
      suggestedParams: testState.suggestedParams,
      manager: user.addr
    });

    await expect(initGroup.execute(algodClient, 5)).rejects.toThrowError();
  });

  it("should get the global and local states for the main and voting contracts", async () => {
    const voters = generateUsers(accountGenerator,5);
    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    let globalStateMain = await getGlobalStateMain(mainAppId,algodClient);
    let localStateMain = await getLocalStateMain(voters[0].addr,mainAppId,algodClient);
    let globalStateVote = await getGlobalStateVote(votingAppId,algodClient);

    const requester = accountGenerator.generateAccount();
    await fundAccount(requester.addr, 10e6);
    testState.ephemeral_map = await test_optin(requester, mainAppId, testState, accountGenerator);
    await waitForRounds(TIME_LOCK + 1);
    await voter_setup(requester, mainAppId, votingAppId, testState);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    globalStateMain = await getGlobalStateMain(mainAppId,algodClient);
    localStateMain = await getLocalStateMain(requester.addr,mainAppId,algodClient);
    globalStateVote = await getGlobalStateVote(votingAppId,algodClient);
    for (const voter of voters){
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account not found");
      }
      const vote = testVote({
        algodClient,
        voter: participationAccount,
        userVote: encodeUint64(100),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: requester.addr,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: testState.request_map.get(requester.addr),
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      try {
        await vote;
        localStateMain = await getLocalStateMain(requester.addr, mainAppId, algodClient);
        globalStateVote = await getGlobalStateVote(votingAppId, algodClient);
      } catch (e) {
        // case where voter votes on an already completed request due to randomness in number of votes assigned to each voter
        await testAssert(vote, errorCodes[2]);
        // console.log(error.message.split(":")[4]);
        // await expect(vote).rejects.toThrowError("1000004");
        localStateMain = await getLocalStateMain(requester.addr, mainAppId, algodClient);
        globalStateVote = await getGlobalStateVote(votingAppId, algodClient);
        break;
      }
    }
    globalStateVote = await getGlobalStateVote(votingAppId,algodClient);
  });

});