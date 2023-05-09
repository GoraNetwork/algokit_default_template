import path from "path";
import {
  Algodv2,
  Account,
  LogicSigAccount,
  secretKeyToMnemonic,
  mnemonicToSecretKey,
  encodeUint64,
  bytesToBigInt,
  getApplicationAddress,
} from "algosdk";
import {
  loadABIContract,
  parseAppState,
} from "algoutils";
import {
  fundAccount
} from "algotest";
import {
  getGlobalStateVote,
  getVoteHash,
  testAssert
} from "../../../utils/gora_utils";
import {
  getRequestInfo,
  getRequestInfoVote
} from "../../../utils/gora_utils";
import {
  registerKey
} from "../../../assets/transactions/staking_transactions";
import {
  generateVRFProof,
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
import { deployVoteContract } from "../../../assets/transactions/main_transactions";
import { registerVoter } from "../../../assets/transactions/vote_transactions";
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
  let network: number;
  // TODO: parameterize and pass into main contract deployment
  let VOTE_REFILL_THRESHOLD: number;
  let VOTE_REFILL_AMOUNT: number;
  let TIME_LOCK: number;
  let requestBoxCost: number;
  let accountGenerator: AccountGenerator;

  beforeEach(async () => {
    // Configure fresh variables for each test 
    accountGenerator = new AccountGenerator(accounts);

    testState = await beforeEachVotingTest(accountGenerator);
    // flatten the testState object
    ({ current_request_round, votingAppId, mainAppId, destinationAppId, algodClient, voteVerifyLsig, user, network, TIME_LOCK, VOTE_REFILL_AMOUNT, VOTE_REFILL_THRESHOLD, requestBoxCost } = testState);
  });

  it("should count votes according to binomial CDF", async () => {
    const voterSk = "rCq9c4ysc7iyvYljHyqwU4h84Lj3efEfYo0VIR0IiOBQep3CPAmDz0ZK46hGEeR7j+RWHz5aU09gcR4pY+9lAA==";

    const participationSk = "hsm4vjShG2N7ypFosr9Wb2yEaTKDJ76ZQCwIAFFjyREEFmZGHVofqBwloJPd1DpvFTnjyAzFJh1ZiYtw645+MA==";

    const voterMnemonic = secretKeyToMnemonic(Buffer.from(voterSk, "base64"));
    const voter = mnemonicToSecretKey(voterMnemonic);

    const participationMnemonic = secretKeyToMnemonic(Buffer.from(participationSk, "base64"));
    const participationAccount = mnemonicToSecretKey(participationMnemonic);

    await fundAccount(voter.addr, 10e6);

    testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator, participationAccount);
    await waitForRounds(TIME_LOCK + 1);
    await voter_setup(voter, mainAppId, votingAppId, testState);

    const requester = accountGenerator.generateAccount();
    await fundAccount(requester.addr, 1e7);
    testState.ephemeral_map =await test_optin(requester, mainAppId,testState, accountGenerator);
    await waitForRounds(TIME_LOCK);
    await voter_setup(requester, mainAppId, votingAppId, testState);

    if (!participationAccount) {
      throw new Error("Participation account not found");
    }

    // random seed
    const seed = Uint8Array.from(Buffer.from("8993062d53bb600fa8a956b75fc406fa8a917bc26660fe45efdb7ef09dbe3767", "hex"));

    const {vrfResult, vrfProof} = generateVRFProof(seed, participationAccount.sk);

    const vrfResultB64 = "QyZazyyja/cJEIu3O5bFFbZUH4mimMyyERYaZg3uGGcRgijPO2JFV8HEo9vidO1M+JlLVFZTET0NPv7VI+lubw==";

    expect(vrfResult.toString("base64")).toEqual(vrfResultB64);

    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(30),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      primaryAccount: voter.addr,
      voteVerifyLsig,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(requester.addr),
      network,
      mockSeed: seed,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    const proposal_tallys = await getGlobalStateVote(votingAppId,algodClient);
    const request_info = await getRequestInfo(mainAppId, key_hash, algodClient);
    const requestId = new Uint8Array(Buffer.from(request_info.request_id as Uint8Array));
    const voteHash = await getVoteHash(
      destinationAppId,
      consumerMethod,
      requester.addr,
      requestId,
      encodeUint64(30),
      "this_is_user_data",
      0,
      10
    );
    const voteHashBase64 = Buffer.from(voteHash).toString("base64");
    expect(proposal_tallys.proposals[voteHashBase64].vote_count).toEqual(499605);
  });

  it("should reject a vote outside of the request timeout", async () => {
    const voter = accountGenerator.generateAccount();

    await fundAccount(voter.addr, 10e6);
    testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
    await waitForRounds(TIME_LOCK + 1);
    await voter_setup(voter, mainAppId, votingAppId, testState);
    const participationAccount = testState.ephemeral_map.get(voter.addr);
    
    if (!participationAccount) {
      throw new Error("Participation account not found");
    }

    const suggestedParams = await algodClient.getTransactionParams().do();

    const requestRound = (suggestedParams.firstRound - 1);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voter, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    // wait for request to expire
    await waitForRounds(TIME_LOCK + 1);

    await expect(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(72),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voter.addr,
      primaryAccount: voter.addr,
      methodSelector: consumerMethod,
      network: network,
      voteVerifyLsig,
      requestRound,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrowError("txn dead");
  });

  it("should tally votes", async () => {
    const voters = generateUsers(accountGenerator,3);
    for (const voter of voters) {
      testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
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
    const request_result = result;
    let appInfo = await algodClient.getApplicationByID(votingAppId).do();
    let globalState = parseAppState(appInfo.params["global-state"]);

    const key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const request_info = await getRequestInfo(mainAppId, key_hash, algodClient);
    for (const voter of voters) {
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }
      const vote = testVote({
        algodClient,
        voter: participationAccount,
        userVote: encodeUint64(1),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: voters[2].addr,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: current_request_round,
        network:network,
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

      //only need to check this after proposal vote
      if(voter.addr == voters[0].addr)
      {
        appInfo = await algodClient.getApplicationByID(votingAppId).do();
        //ensure that the proposed txn_ID is populated in global state
        const cri = await getRequestInfoVote(votingAppId, algodClient);
        expect(cri.request_id).toEqual(request_info.request_id);

        //round should iterate
        appInfo = await algodClient.getApplicationByID(votingAppId).do();
        globalState = parseAppState(appInfo.params["global-state"]);
        expect(globalState["r"]).toEqual(1);
      }
    }

    //should call destination app
    appInfo = await algodClient.getApplicationByID(destinationAppId).do();
    globalState = parseAppState(appInfo.params["global-state"]);
    const value = Buffer.from(appInfo.params["global-state"][0].value.bytes, "base64");
    expect(value.slice(2)).toEqual(Buffer.from(encodeUint64(1)));
  });

  it("should not allow proposal to 2 voting contracts", async () => {
    const voters = generateUsers(accountGenerator,3);
    for (const voter of voters) {
      testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
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
    const request_result = result;
    const appInfo = await algodClient.getApplicationByID(votingAppId).do();
    const globalState = parseAppState(appInfo.params["global-state"]);

    const key_hash = request_result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const request_info = await getRequestInfo(mainAppId, key_hash, algodClient);

    const voter = voters[0];
    const voter2 = voters[1];
    const participationAccount = testState.ephemeral_map.get(voter.addr);
    const voter2ParticipationAccount = testState.ephemeral_map.get(voter2.addr);
    if (!participationAccount) {
      throw new Error("Participation account does not exist for voter");
    }
    if (!voter2ParticipationAccount) {
      throw new Error("Participation account does not exist for voter");
    }

    //deploy another voting contract
    await fundAccount(getApplicationAddress(mainAppId), 3000000);
    let suggestedParams = await algodClient.getTransactionParams().do();
    suggestedParams = {
      ...suggestedParams,
      flatFee: true,
      fee: 3000
    };
    const deployVoteContractGroup = deployVoteContract({
      staker: user,
      appID: mainAppId,
      suggestedParams: suggestedParams
    });
    const voteContract = await deployVoteContractGroup.execute(algodClient, 5);
    let log: Uint8Array;
    let secondVotingAppId: number;
    if (voteContract.methodResults[0].txInfo) {
      log = voteContract.methodResults[0].txInfo.logs[0];
      secondVotingAppId = Number(bytesToBigInt(log));
    } else {
      // todo - is this required?
      throw new Error("Vote contract deployment failed");
    }
    const registerVoterGroup = registerVoter({
      user: voter2ParticipationAccount,
      votingAppId: secondVotingAppId,
      mainAppId: mainAppId,
      primaryAccount: voter2.addr,
      suggestedParams: await algodClient.getTransactionParams().do()
    });
    await registerVoterGroup.execute(algodClient, 5);
    
    //first vote assigns the txn to the first contract
    await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(1),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[2].addr,
      primaryAccount: voter.addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      network:network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    //second proposal should fail
    await expect(testVote({
      algodClient,
      voter: voter2ParticipationAccount,
      userVote: encodeUint64(1),
      mainAppId,
      votingAppId: secondVotingAppId,
      destinationAppId,
      requesterAddress: voters[2].addr,
      primaryAccount: voter2.addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      network:network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrow("invalid App reference");

  });

  it("should allow vote if voter is in certification committee", async () => {
    // we have no way to mock block seed, so can't really test committee membership, placeholder voting txn for now
    const voter = accountGenerator.generateAccount();

    await fundAccount(voter.addr, 10e6);

    testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
    await waitForRounds(TIME_LOCK);
    await voter_setup(voter, mainAppId, votingAppId, testState);

    const participationAccount = testState.ephemeral_map.get(voter.addr);

    if (!participationAccount) {
      throw new Error("Participation account not found");
    }
    await waitForRounds(TIME_LOCK);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voter, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(42),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voter.addr,
      primaryAccount: voter.addr,
      methodSelector: consumerMethod,
      requestRound: current_request_round,
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });
  });

  it("cannot vote on a transaction that doesn't exist", async () => {
    const adversary = accountGenerator.generateAccount();
    const voters = generateUsers(accountGenerator,3);

    testState.ephemeral_map =await test_optin(adversary, mainAppId, testState, accountGenerator);

    for (const voter of voters) {
      testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);
    await voter_setup(adversary, mainAppId, votingAppId, testState);
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }

    const evilParticipationAccount = testState.ephemeral_map.get(adversary.addr);
    if (!evilParticipationAccount) {
      throw new Error("Adversary participation account does not exist");
    }

    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);
    const key_hash = new Uint8Array(Buffer.from("FOO"));

    await testAssert(testVote({
      algodClient,
      voter: evilParticipationAccount,
      userVote: encodeUint64(1),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: adversary.addr,
      primaryAccount: adversary.addr,
      methodSelector: consumerMethod,
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash : key_hash
    }),errorCodes[8]);
  });

  it("should not let someone vote again in a round after closeout and re optin", async () => {
    const voters = generateUsers(accountGenerator,4);

    for (const voter of voters) {
      testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);

    const requester = accountGenerator.generateAccount();
    testState.ephemeral_map =await test_optin(requester, mainAppId, testState, accountGenerator);
    await voter_setup(requester, mainAppId, votingAppId, testState);
    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);
   
    let participationAccounts: Account[] = [];
    for(let i=0; i < voters.length - 2; i++)
    {
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
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    const voteCounts = [];
    const closeoutVoter = voters[0];
    const participationAccount = participationAccounts[0];
    const { voteCount } = await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(200),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress:requester.addr,
      requestRound: current_request_round,
      primaryAccount: closeoutVoter.addr,
      methodSelector: consumerMethod,
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });
    voteCounts.push(voteCount);
    await expect(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(300),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      requestRound: current_request_round,
      primaryAccount: closeoutVoter.addr,
      methodSelector: consumerMethod,
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrowError("using an overlapping lease");
  });

  it("should not let user vote again in same round if voter clears state", async () =>{
    const voters = generateUsers(accountGenerator,4);
    
    for (const voter of voters) {
      testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);

    const requester = accountGenerator.generateAccount();
    testState.ephemeral_map =await test_optin(requester, mainAppId, testState, accountGenerator);
    await voter_setup(requester, mainAppId, votingAppId, testState);
    //wait for participation key lock to expire 
    await waitForRounds(TIME_LOCK);
    fundAccount(user.addr, 0);
   
    const voteCounts = [];
    let participationAccounts: Account[] = [];
    for(let i=0; i < voters.length - 2; i++)
    {
      const participationAccount = testState.ephemeral_map.get(voters[i].addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }
      participationAccounts = participationAccounts.concat(participationAccount);
      await voter_setup(voters[i], mainAppId, votingAppId, testState, participationAccount);
      await waitForRounds(TIME_LOCK);
      fundAccount(user.addr, 0);
    }

    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    for(let i=0; i < voters.length - 2; i++)
    {
      const { voteCount } = await testVote({
        algodClient,
        voter: participationAccounts[i],
        userVote: encodeUint64(300),
        mainAppId,
        votingAppId,
        destinationAppId,
        requesterAddress: requester.addr,
        requestRound: current_request_round,
        primaryAccount: voters[i].addr,
        methodSelector: consumerMethod,
        network: network,
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash
      });
      voteCounts.push(voteCount);
    }
    const clearStateVoter = voters[0];  
    await fundAccount(voters[1].addr,1e3);
    await testAssert(testVote({
      algodClient,
      voter: participationAccounts[0],
      userVote: encodeUint64(1000),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      requestRound: current_request_round,
      primaryAccount: clearStateVoter.addr,
      methodSelector: consumerMethod,
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
      // With the populate_request_info_tmps now checking for is_history, this no longer gets to the lease check first.
    }),errorCodes[2]);
  });

  it("should try to vote too soon after registering their key", async () => {
    const voter = accountGenerator.generateAccount();

    testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);

    await waitForRounds(TIME_LOCK + 1);

    await voter_setup(voter, mainAppId, votingAppId, testState);

    await waitForRounds(TIME_LOCK + 1);

    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voter, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;

    const participationAccount = testState.ephemeral_map.get(voter.addr);
    if (!participationAccount) {
      throw new Error("Participation account does not exist for voter");
    }

    const registerGroup = registerKey({
      user: voter,
      appId: mainAppId,
      publicKey: participationAccount.addr,
      suggestedParams: testState.suggestedParams
    });
    await registerGroup.execute(algodClient, 5);
    
    await expect(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(100),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voter.addr,
      primaryAccount: voter.addr,
      methodSelector: consumerMethod,
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrowError();
  });

  it("should fail if incorrect VRF proof is sent", async () => {
    const voter = accountGenerator.generateAccount();

    await fundAccount(voter.addr, 10e6);

    testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
    await waitForRounds(TIME_LOCK + 1);
    await voter_setup(voter, mainAppId, votingAppId, testState);

    const participationAccount = testState.ephemeral_map.get(voter.addr);

    if (!participationAccount) {
      throw new Error("Participation account not found");
    }

    // this will be used when block seed is available in dev mode
    // const suggestedParams = await algodClient.getTransactionParams().do();
    // const blockInfo = await algodClient.block(suggestedParams.firstRound - 1).do();
    // const requestRoundSeed = blockInfo.block.seed;

    const requestRoundSeed = new Uint8Array([...Array(32).keys()]);

    const mockSeed = new Uint8Array([...Array(32).reverse().keys()]);

    // generate proof with wrong secret key
    const { vrfResult, vrfProof } = generateVRFProof(requestRoundSeed, testState.mainAccount.sk);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voter, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    await expect(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(2 ** 32),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voter.addr,
      primaryAccount: voter.addr,
      methodSelector: consumerMethod,
      network: network,
      voteVerifyLsig,
      vrfResult,
      vrfProof,
      mockSeed,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrowError("assert failed");
  });

  it("should fail on invalid lease", async () => {
    const voters = generateUsers(accountGenerator,3);

    for (const voter of voters) {
      testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator);
    }
    await waitForRounds(TIME_LOCK + 1);
    for (const voter of voters) {
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    await waitForRounds(TIME_LOCK + 1);

    const participationAccount = testState.ephemeral_map.get(voters[2].addr);
    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(voters[0], undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    let suggestedParams = await algodClient.getTransactionParams().do();
    if (!participationAccount) {
      throw new Error("Participation account does not exist for voter");
    }

    //fail lease on wrong lease
    await testAssert(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(1),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: voters[2].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[0].addr),
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      mockLease: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      request_key_hash: key_hash
    }),errorCodes[9]);

    suggestedParams.firstRound = suggestedParams.firstRound + 1;
    //fail lease on wrong firstRound
    await testAssert(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(3),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: voters[2].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[0].addr),
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      mockParams: suggestedParams,
      request_key_hash: key_hash
    }),errorCodes[11]);

    suggestedParams.firstRound = suggestedParams.firstRound - 1;
    suggestedParams.lastRound = suggestedParams.lastRound - 1;
    //fail lease on wrong lastRound
    await testAssert(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(100),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: voters[2].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[0].addr),
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      mockParams: suggestedParams,
      request_key_hash: key_hash
    }),errorCodes[10]);

    //vote successfully
    await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(100),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: voters[2].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[0].addr),
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    //no double vote
    await expect(testVote({
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
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrowError("using an overlapping lease");

    suggestedParams = await algodClient.getTransactionParams().do();
    suggestedParams.firstRound = testState.request_map.get(voters[0].addr) + 2;
    suggestedParams.lastRound = testState.request_map.get(voters[0].addr) + TIME_LOCK;

    //no double vote
    await expect(testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(BigInt("18446744073709551615")),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: voters[0].addr,
      primaryAccount: voters[2].addr,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(voters[0].addr),
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrowError("using an overlapping lease");

    suggestedParams = await algodClient.getTransactionParams().do();
    suggestedParams.firstRound = testState.request_map.get(voters[0].addr) + 3;
    suggestedParams.lastRound = testState.request_map.get(voters[0].addr) + TIME_LOCK;

    //no double vote
    await expect(testVote({
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
      network: network,
      voteVerifyLsig,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    })).rejects.toThrowError("using an overlapping lease");
  });

  it("should tally correctly for Q near 0.5", async () => {
    const participationMnemonic = "near equal town mass choose draft sword soup nasty wool couch dream loyal luggage road more own letter busy blur toast burst enroll absent misery";

    const voterSk = "rCq9c4ysc7iyvYljHyqwU4h84Lj3efEfYo0VIR0IiOBQep3CPAmDz0ZK46hGEeR7j+RWHz5aU09gcR4pY+9lAA==";

    const voterMnemonic = secretKeyToMnemonic(Buffer.from(voterSk, "base64"));
    const voter = mnemonicToSecretKey(voterMnemonic);

    const participationAccount = mnemonicToSecretKey(participationMnemonic);

    await fundAccount(voter.addr, 10e6);

    testState.ephemeral_map =await test_optin(voter, mainAppId, testState, accountGenerator, participationAccount);
    await waitForRounds(TIME_LOCK + 1);
    await voter_setup(voter, mainAppId, votingAppId, testState);

    const requester = accountGenerator.generateAccount();
    await fundAccount(requester.addr, 1e7);
    testState.ephemeral_map =await test_optin(requester, mainAppId,testState, accountGenerator);
    await waitForRounds(TIME_LOCK);
    await voter_setup(requester, mainAppId, votingAppId, testState);

    if (!participationAccount) {
      throw new Error("Participation account not found");
    }

    // random seed
    const seed = Uint8Array.from(Buffer.from("afc96d5d401df8e756e0a2d58727594e5be319f4edd863ed687c6a8d22cb3588", "hex"));

    const {vrfResult, vrfProof} = generateVRFProof(seed, participationAccount.sk);

    const vrfResultHex = "7fd5e035ded9769677a3073672df391a97f5138043ca7658cd6c4ed0e8789d0b1e0573f2240ed9900c835f2ced324ddeb9f5c31962742ce36171b3b8678bd9fb";
    
    expect(vrfResult.toString("hex")).toEqual(vrfResultHex);

    let result;
    ({ result, current_request_round, request_map: testState.request_map, suggestedParams: testState.suggestedParams } = await submit_test_request(requester, undefined, testState));
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    await testVote({
      algodClient,
      voter: participationAccount,
      userVote: encodeUint64(30),
      mainAppId,
      votingAppId,
      destinationAppId,
      requesterAddress: requester.addr,
      primaryAccount: voter.addr,
      voteVerifyLsig,
      methodSelector: consumerMethod,
      requestRound: testState.request_map.get(requester.addr),
      network,
      mockSeed: seed,
      timelock: TIME_LOCK,
      request_key_hash: key_hash
    });

    const proposal_tallys = await getGlobalStateVote(votingAppId,algodClient);
    const request_info = await getRequestInfo(mainAppId, key_hash, algodClient);
    const requestId = new Uint8Array(Buffer.from(request_info.request_id as Uint8Array));
    const voteHash = await getVoteHash(
      destinationAppId,
      consumerMethod,
      requester.addr,
      requestId,
      encodeUint64(30),
      "this_is_user_data",
      0,
      10
    );
    const voteHashBase64 = Buffer.from(voteHash).toString("base64");
    expect(proposal_tallys.proposals[voteHashBase64].vote_count).toEqual(500_000);
  });
});