import path from "path";
import {
  Algodv2,
  Account,
  SuggestedParams,
  getApplicationAddress,
  bytesToBigInt,
  LogicSigAccount,
  mnemonicToSecretKey,
} from "algosdk";
import {
  loadABIContract,
  optIn,
  sendASA,
} from "algoutils";
import {
  fundAccount
} from "algotest";
import {
  deployVoteContract,
  init,
  userOptIn} from "../../../assets/transactions/main_transactions";
import {
  getRequestInfo,
  getGlobalStateMain,
  getLocalStateMain,
} from "../../../utils/gora_utils";

import {
  deployConsumerContract
} from "../../test_fixtures/consumer_transactions";
import {
  registerVoter,
} from "../../../assets/transactions/vote_transactions";
import {
  stake,
  depositToken,
  depositAlgo,
  registerKey
} from "../../../assets/transactions/staking_transactions";
import {
  DestinationType,
  RequestArgsType,
  RequestInfoType,
} from "../../../utils/abi_types";

import {
  commonTestSetup
} from "../main_common";

import { request } from "../../../assets/transactions/request_transactions";
import accounts from "../../test_fixtures/accounts.json";

const ABI_PATH = "../../../test/test_fixtures/consumer-contract.json";
const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));
const consumerMethod = consumerContract.methods[0].getSelector();

export class AccountGenerator {
  index: number;
  accounts: any;
  
  constructor(accounts: any) {
    this.accounts = accounts;
    this.index = 0;
  }

  generateAccount() {
    const account = mnemonicToSecretKey(accounts[this.index].mnemonic as string);
    this.index += 1;
    return account;
  }
}

export function generateUsers(accountGenerator:AccountGenerator,numberOfUsers:number){
  const users: Account[] = [];
  for (let i = 0; i < numberOfUsers; i++){
    users[i] = accountGenerator.generateAccount();
  }
  return users;
}

export interface VotingTestState {
  votingAppId: number;
  mainAppId: number;
  destinationAppId: number;
  algodClient: Algodv2;
  platformTokenAssetId: number;
  mainAccount: Account;
  voteVerifyLsig: LogicSigAccount;
  user: Account;
  suggestedParams: SuggestedParams;
  current_request_round: any;
  network: number;
  goraRequestFee: number;
  algoRequestFee: number;
  requestBoxCost: number;
  VOTE_REFILL_THRESHOLD: number;
  VOTE_REFILL_AMOUNT: number;
  // // TODO: parameterize and pass into main contract deployment
  TIME_LOCK: number;
  ephemeral_map: Map<string, Account>;
  request_map: Map<string, any>;
}

// export interface OneTimeVotingTestSetup extends VotingTestState {
//   // These values can change inside a test and need to be kept
//   // out of VotingTestState to reduce confusion
// }

export async function checkRewards(accountStatePreClaim:any,voteStatePreClaim:any,account:Account,key_hash:string,mainAppId:number,algodClient:Algodv2,rewardsAccount?:Account){
  let voterCount:number;
  if(rewardsAccount){
    voterCount = voteStatePreClaim.previous_vote[rewardsAccount.addr].proposal.vote_count;
  } else {
    voterCount = voteStatePreClaim.previous_vote[account.addr].proposal.vote_count;
  }
  const globalStateMain = await getGlobalStateMain(mainAppId, algodClient);
  const algoRequestFee = globalStateMain.algo_request_fee;
  const goraRequestFee = globalStateMain.gora_request_fee;
  const expectedVoteCount: number = globalStateMain.requests_completed[key_hash].vote_count;
  const expectedAlgoRewards = Math.floor(voterCount * 100 / expectedVoteCount)*Math.floor(algoRequestFee/100);
  const expectedGoraRewards = Math.floor(voterCount * 100 / expectedVoteCount)*Math.floor(goraRequestFee/100);
  const voter_main_state_post = await getLocalStateMain(account.addr, mainAppId, algodClient);
  expect(voter_main_state_post.account_algo).toEqual(accountStatePreClaim.account_algo + expectedAlgoRewards);
  expect(voter_main_state_post.account_token_amount).toEqual(accountStatePreClaim.account_token_amount + expectedGoraRewards);
}

// Called by beforeEach
export async function beforeEachVotingTest(accountGenerator:AccountGenerator) {
  // static vars
  const network = 100_001;
  const VOTE_REFILL_THRESHOLD = 10;
  const VOTE_REFILL_AMOUNT = 10;
  // // TODO: parameterize and pass into main contract deployment
  const TIME_LOCK = 10;
  const ephemeral_map = new Map<string, Account>();
  const request_map = new Map<string, any>();
  const requestBoxCost = (RequestInfoType.byteLen() + 32) * 400 + 2500;

  // test setup
  // eslint-disable-next-line prefer-const
  let { appId, algodClient, platformTokenAssetId, user, suggestedParams, mainAccount, voteVerifyLsig } = await commonTestSetup(accountGenerator);
  const mainAppId = appId;
  let votingAppId: number;

  const destinationAppId = await deployConsumerContract({
    deployer: mainAccount
  });

  const optInRequesterGroup = userOptIn({ user: mainAccount, appId: appId, suggestedParams: suggestedParams });
  await optInRequesterGroup.execute(algodClient, 5);
  const optInUserGroup = userOptIn({ user: user, appId: appId, suggestedParams: suggestedParams });
  await optInUserGroup.execute(algodClient, 5);

  const userParticipationAccount = accountGenerator.generateAccount();
  ephemeral_map.set(user.addr, userParticipationAccount);
  await fundAccount(userParticipationAccount.addr, 1_500_000);
  await fundAccount(user.addr, 1_500_000);

  const participationAccount = ephemeral_map.get(user.addr)!;
  //register ephemeral account to allow voting on the users behalf
  const registerGroup = registerKey({
    user: user,
    appId: appId,
    publicKey: userParticipationAccount.addr,
    suggestedParams: await algodClient.getTransactionParams().do()
  });
  await registerGroup.execute(algodClient, 5);

  // fund main contract
  await fundAccount(getApplicationAddress(mainAppId), 101_000); // To account for opting in and the cost of the opt in txn

  //initialize main contract
  const initGroup = init({
    platformTokenAssetId,
    user: mainAccount,
    appId: mainAppId,
    suggestedParams,
    manager: user.addr
  });

  await initGroup.execute(algodClient, 5);

  suggestedParams = {
    ...suggestedParams,
    flatFee: true,
    fee: 3000
  };

  // Deploying vote, contract, we fund it this amount to account for:
  // min balance increase of main for creating app,
  // funding vote contract with a min balance and refill amount
  await fundAccount(getApplicationAddress(mainAppId), 12855000);

  const deployVoteContractGroup = deployVoteContract({
    staker: user,
    appID: appId,
    suggestedParams: suggestedParams
  });
  const voteContract = await deployVoteContractGroup.execute(algodClient, 5);

  let log: Uint8Array;
  if (voteContract.methodResults[0].txInfo) {
    log = voteContract.methodResults[0].txInfo.logs[0];
    votingAppId = Number(bytesToBigInt(log));
  } else {
    // todo - is this required?
    throw new Error("Vote contract deployment failed");
  }

  const globalStateMain = await getGlobalStateMain(mainAppId, algodClient);
  const goraRequestFee = globalStateMain.gora_request_fee;
  const algoRequestFee = globalStateMain.algo_request_fee;

  return {
    votingAppId,
    mainAppId,
    destinationAppId,
    algodClient,
    platformTokenAssetId,
    mainAccount,
    voteVerifyLsig,
    user,
    suggestedParams,
    current_request_round: undefined,
    network,
    VOTE_REFILL_THRESHOLD,
    VOTE_REFILL_AMOUNT,
    TIME_LOCK,
    ephemeral_map,
    request_map,
    goraRequestFee,
    algoRequestFee,
    requestBoxCost,
  } as VotingTestState;
}

export async function submit_test_request(user: Account, key = "foo", testState: VotingTestState) {
  const suggestedParams = await testState.algodClient.getTransactionParams().do();
  const url = new Uint8Array(Buffer.from("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1"));
  const jsonPath = new Uint8Array(Buffer.from("market_cap"));
  //Note that the first argument in create_request_args must be an array of the source args array created in the line above
  //This example only uses a single source, but typically aggregation methods will take many sources.
  const userdata = new Uint8Array(Buffer.from("Hello world"));
  const source_id = 0;

  const requestArgs = RequestArgsType.encode([[[source_id, [url, jsonPath], 60]], 0, userdata]);
  const destMethod = consumerContract.methods[0].getSelector();
  const destination = DestinationType.encode([testState.destinationAppId, destMethod]);

  const request_group = request({
    user: user,
    appID: testState.mainAppId,
    suggestedParams: suggestedParams,
    request_args: requestArgs,
    destination: destination,
    type: 0,
    key: Buffer.from(key),
    appRefs: [],
    assetRefs: [],
    accountRefs: [],
    boxRefs: []
  });
  const result = await request_group.execute(testState.algodClient, 5);

  const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
  const request_info = await getRequestInfo(testState.mainAppId, key_hash, testState.algodClient);
  const current_request_round = request_info.request_round;
  // create a new map to avoid mutating the original
  const request_map_new = new Map(testState.request_map);
  request_map_new.set(user.addr, request_info.request_round);
  return { result, current_request_round, request_map: request_map_new, suggestedParams };
}

export async function voter_setup(voter: Account, mainAppId: number, votingAppId: number, testState: VotingTestState, participationAccountOverride?: Account) {
  const participationAccount = testState.ephemeral_map.get(voter.addr)!;
  //register ephemeral account to allow voting on the users behalf
  const registerGroup = registerKey({
    user: voter,
    appId: mainAppId,
    publicKey: participationAccount.addr,
    suggestedParams: await testState.algodClient.getTransactionParams().do()
  });
  await registerGroup.execute(testState.algodClient, 5);

  //register ephermeral account into voting contract
  const registerVoterGroup = registerVoter({
    user: participationAccount,
    primaryAccount: voter.addr,
    votingAppId: votingAppId,
    mainAppId: mainAppId,
    suggestedParams: await testState.algodClient.getTransactionParams().do()
  });
  await registerVoterGroup.execute(testState.algodClient, 5);

  const stakingGroup = stake({
    platformTokenAssetId: testState.platformTokenAssetId,
    user: voter,
    appId: mainAppId,
    suggestedParams: await testState.algodClient.getTransactionParams().do(),
    amount: 500_000_000
  });

  await stakingGroup.execute(testState.algodClient, 5);

  const depositAlgoGroup = depositAlgo({
    user: voter,
    appId: mainAppId,
    suggestedParams: await testState.algodClient.getTransactionParams().do(),
    amount: 100_000
  });

  await depositAlgoGroup.execute(testState.algodClient, 5);

  const depositTokenGroup = depositToken({
    platformTokenAssetId: testState.platformTokenAssetId,
    user: voter,
    appId: mainAppId,
    suggestedParams: await testState.algodClient.getTransactionParams().do(),
    amount: 40_000_000_000
  });

  await depositTokenGroup.execute(testState.algodClient, 5);
}

export async function requesterSetup(requester: Account, mainAppId: number, tokenStakeAmount: number, algoDepositAmount: number, testState: VotingTestState) {
  await fundAccount(requester.addr, algoDepositAmount + 1_500_000);
  await optIn(testState.platformTokenAssetId, requester);
  await sendASA({
    from: testState.mainAccount,
    to: requester.addr,
    assetId: testState.platformTokenAssetId,
    amount: tokenStakeAmount
  });

  const stakingGroup = stake({
    platformTokenAssetId: testState.platformTokenAssetId,
    user: requester,
    appId: mainAppId,
    suggestedParams: await testState.algodClient.getTransactionParams().do(),
    amount: tokenStakeAmount
  });

  await stakingGroup.execute(testState.algodClient, 5);

  const depositAlgoGroup = depositAlgo({
    user: requester,
    appId: mainAppId,
    suggestedParams: await testState.algodClient.getTransactionParams().do(),
    amount: algoDepositAmount
  });

  await depositAlgoGroup.execute(testState.algodClient, 5);

  const depositTokenGroup = depositToken({
    platformTokenAssetId: testState.platformTokenAssetId,
    user: requester,
    appId: mainAppId,
    suggestedParams: await testState.algodClient.getTransactionParams().do(),
    amount: tokenStakeAmount
  });

  await depositTokenGroup.execute(testState.algodClient, 5);
}

export async function test_optin(voter: Account, mainAppId: number, testState: VotingTestState, accountGenerator: AccountGenerator, participationAccountOverride?: Account) {
  const suggestedParams = await testState.algodClient.getTransactionParams().do();
  await fundAccount(voter.addr, 1_500_000);
  await optIn(testState.platformTokenAssetId, voter);
  await sendASA({
    from: testState.mainAccount,
    to: voter.addr,
    assetId: testState.platformTokenAssetId,
    amount: 50_000_000_000
  });

  let participationAccount = accountGenerator.generateAccount();
  if (participationAccountOverride) {
    participationAccount = participationAccountOverride;
  }
  // create a new map to avoid mutating the original
  const ephemeral_map_new = new Map(testState.ephemeral_map);
  ephemeral_map_new.set(voter.addr, participationAccount);
  await fundAccount(participationAccount.addr, 1_500_000);
  await fundAccount(voter.addr, 1_500_000);

  //opt ephemeral account into staking contract
  let optInGroup = userOptIn({ user: participationAccount, appId: mainAppId, suggestedParams: suggestedParams });
  await optInGroup.execute(testState.algodClient, 5);

  //opt user primary account into staking contract
  optInGroup = userOptIn({ user: voter, appId: mainAppId, suggestedParams: suggestedParams });
  await optInGroup.execute(testState.algodClient, 5);

  return ephemeral_map_new;
}
