import path from "path";
import {
  Algodv2,
  SuggestedParams,
  getApplicationAddress,
  LogicSigAccount,
  bytesToBigInt,
  bigIntToBytes,
  Account,
  encodeAddress
} from "algosdk";
import {
  compilePyTeal,
  optIn,
  sendASA,
  deployContract,
  parseAppState
} from "algoutils";
import {
  fundAccount
} from "algotest";
import {
  init,
  deployVoteContract,
  userOptIn
} from "../../../assets/transactions/main_transactions";
import {
  registerVoter
} from "../../../assets/transactions/vote_transactions";
import {
  stake,
  depositToken,
  depositAlgo,
  registerKey
} from "../../../assets/transactions/staking_transactions";
import {
  opt_into_gora,
  start_round,
  end_round,
  submit_choice
} from "../assets/transactions/example_transactions";

import { commonTestSetup } from "../../../test/e2e/main_common";
import axios from "axios";
import { testVote, waitForRounds } from "../../../test/util/utils";
import { getRequestInfo } from "../../../utils/gora_utils";
import {
  DestinationType, ProposalsEntryType
} from "../../../utils/abi_types";
import { AccountGenerator, generateUsers } from "../../../test/e2e/vote/voting.helpers";
import  accounts from "../../../test/test_fixtures/accounts.json";

const REGISTER_KEY_TIME_LOCK = 10;
const SUBMISSION_AMOUNT = 5000;
jest.setTimeout(900000000);

describe("Example Dapp Test", () => {
  let exampleDappAppId: number;
  let mainAppId: number;
  let votingAppId: number;
  let algodClient: Algodv2;
  let platformTokenAssetId: number;
  let mainAccount: Account;
  let voters: Account[];
  let players: Account[];
  let voteVerifyLsig: LogicSigAccount;
  let user: Account;
  let suggestedParams: SuggestedParams;
  const ephemeral_map = new Map<string, Account>();
  let accountGenerator: AccountGenerator;

  async function sleep_rounds(rounds:number, addr:string){
    for(let i = 0; i < rounds; i++)
    {
      await fundAccount(addr,i);
    }
  }

  async function increment_round(voters: Account[], action: string)
  {
    let result;
    if(action === "start")
    {
      const group = await start_round(
        {
          user: mainAccount,
          suggestedParams: suggestedParams,
          application_id: exampleDappAppId,
          submission_amount: SUBMISSION_AMOUNT,
          goracle_main_app: mainAppId
        }
      );
      result = await group.execute(algodClient, 5);
    }
    else
    {
      const group = await end_round(
        {
          user: mainAccount,
          suggestedParams: suggestedParams,
          application_id: exampleDappAppId,
          goracle_main_app: mainAppId
        }
      );
      result = await group.execute(algodClient, 5);
    }

    //normally the node runner would grab the request from the transaction history of the main contract using an indexer
    //here we are only able to grab from transaction results because we run devnet in our tests
    const request_txn = result.methodResults[0].txInfo!["inner-txns"][0];
    
    const destination = DestinationType.decode(request_txn.txn.txn.apaa[2]);
    const requester = encodeAddress(request_txn.txn.txn.snd);

    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const request_info =  await getRequestInfo(mainAppId, key_hash, algodClient);
    const current_request_round = request_info.request_round;

    const destination_signature = destination[1];

    //since this is a dummy request and we don't have our source list built yet, I'm just going to assume that this is a coingecko btc price
    const coingecko_btc = await axios.get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1");

    //for simplicity of this test we're not going to worry about precision and just take the floor of the returned price
    const price = bigIntToBytes(Math.floor(coingecko_btc["data"][0].current_price), 8);
    
    //now we're going to emulate a voting round where all participants give the same response (we're not adversarial testing with this test.)
    fundAccount(user.addr, 0);

    for (const voter of voters) {
      const participationAccount = ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account does not exist for voter");
      }
      const results = await testVote({
        algodClient,
        voter: participationAccount,
        userVote: price,
        mainAppId,
        votingAppId,
        destinationAppId: exampleDappAppId,
        requesterAddress: requester,
        primaryAccount: voter.addr,
        requestRound: current_request_round,
        methodSelector: destination_signature,
        network: 100_001,
        timelock: REGISTER_KEY_TIME_LOCK,
        voteVerifyLsig,
        request_key_hash: key_hash
      });
      if(Object.prototype.hasOwnProperty.call(results.result.methodResults[0].txInfo!, "inner-txns"))
      {
        if(results.result.methodResults[0].txInfo!["inner-txns"].length == 2)
        {
          break;
        }
      }
    }
    return price;
  }

  async function test_optin(voter: Account, mainAppId: number, votingAppId: number)
  {
    const suggestedParams = await algodClient.getTransactionParams().do();
    await fundAccount(voter.addr, 3_000_000);
    await optIn(platformTokenAssetId, voter);
    await sendASA({
      from: mainAccount,
      to: voter.addr,
      assetId: platformTokenAssetId,
      amount: 100_000_000_000
    });

    const participationAccount = accountGenerator.generateAccount();
    ephemeral_map.set(voter.addr, participationAccount);
    await fundAccount(participationAccount.addr, 1_500_000);

    //opt ephemeral account into staking contract
    let optInGroup = userOptIn({user: participationAccount, appId: mainAppId, suggestedParams: suggestedParams});
    await optInGroup.execute(algodClient, 5);

    //opt user primary account into staking contract
    optInGroup = userOptIn({user: voter, appId: mainAppId, suggestedParams: suggestedParams});
    await optInGroup.execute(algodClient, 5);
    await sleep_rounds(11, user.addr);

    //register ephemeral account to allow voting on the users behalf
    const registerGroup = registerKey({
      user: voter,
      appId: mainAppId,
      publicKey: participationAccount.addr,
      suggestedParams: suggestedParams
    });
    await registerGroup.execute(algodClient, 5);

    //opt ephermeral account into voting contract
    const registerVoterGroup = registerVoter({
      user: participationAccount,
      primaryAccount:voter.addr, 
      votingAppId: votingAppId,
      mainAppId: mainAppId,
      suggestedParams: await algodClient.getTransactionParams().do() 
    });
    await registerVoterGroup.execute(algodClient, 5);

    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId,
      user: voter,
      appId: mainAppId,
      suggestedParams: suggestedParams,
      amount: 50_000_000_000
    });

    await stakingGroup.execute(algodClient, 5);

    const depositAlgoGroup = depositAlgo({
      user: voter, 
      appId: mainAppId, 
      suggestedParams: suggestedParams, 
      amount: 10_000
    });

    await depositAlgoGroup.execute(algodClient, 5);

    const depositTokenGroup = depositToken({
      platformTokenAssetId: platformTokenAssetId, 
      user: voter, 
      appId: mainAppId, 
      suggestedParams: suggestedParams, 
      amount: 10_000_000_000
    });

    await depositTokenGroup.execute(algodClient, 5);
  }

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);

    const testParameters = await commonTestSetup(accountGenerator);
    mainAppId = testParameters.appId;
    algodClient = testParameters.algodClient;
    platformTokenAssetId = testParameters.platformTokenAssetId;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;
    mainAccount = testParameters.mainAccount;
    voteVerifyLsig = testParameters.voteVerifyLsig;

    const optInRequesterGroup = userOptIn({user: mainAccount, appId: mainAppId, suggestedParams: suggestedParams});
    await optInRequesterGroup.execute(algodClient, 5);
    const optInUserGroup = userOptIn({user: user, appId: mainAppId, suggestedParams: suggestedParams});
    await optInUserGroup.execute(algodClient, 5);

    const userParticipationAccount = accountGenerator.generateAccount();
    ephemeral_map.set(user.addr, userParticipationAccount);
    await fundAccount(userParticipationAccount.addr, 1_500_000);
    await fundAccount(user.addr, 1_500_000);

    //register ephemeral account to allow voting on the users behalf
    const registerGroup = registerKey({
      user: user,
      appId: mainAppId,
      publicKey: userParticipationAccount.addr,
      suggestedParams: await algodClient.getTransactionParams().do()
    });
    await registerGroup.execute(algodClient, 5);

    // fund main contract
    await fundAccount(getApplicationAddress(mainAppId), 2955000);

    //initialize main contract
    const initGroup = init({
      platformTokenAssetId: platformTokenAssetId,
      user: mainAccount, 
      appId: mainAppId, 
      suggestedParams: suggestedParams,
      manager: user.addr
    });

    await initGroup.execute(algodClient, 5);

    suggestedParams = {
      ...suggestedParams,
      flatFee: true,
      fee: 3000
    };
    const deployVoteContractGroup = deployVoteContract({
      staker: user,
      appID: mainAppId,
      suggestedParams:suggestedParams
    });
    const voteContract = await deployVoteContractGroup.execute(algodClient, 5);
    let log: Uint8Array;
    if (voteContract.methodResults[0].txInfo) {
      log = voteContract.methodResults[0].txInfo.logs[0];
      votingAppId = Number(bytesToBigInt(log));
    }
    const historyPageNum = 1;
    const maxBoxSizeBytes = 5120;
    const proposalEntryBytes = ProposalsEntryType.byteLen();
    const historyBoxCost = historyPageNum*(2500 + 400*(16+proposalEntryBytes*Math.floor(maxBoxSizeBytes/proposalEntryBytes)));
    // fund user to be able to add a history box
    await fundAccount(user.addr, historyBoxCost+1e6);

    voters = generateUsers(accountGenerator,3);
    
    for (const voter of voters) {
      await test_optin(voter, mainAppId,votingAppId);
    }
    //wait for participation key lock to expire 
    await waitForRounds(REGISTER_KEY_TIME_LOCK);

    const exampleDappContractParams = {
      GORACLE_MAIN_ADDR: getApplicationAddress(mainAppId),
      SUBMISSION_TIME: 60,
      WAIT_TIME: 180
    };
    const exampleDappApprovalCode = await compilePyTeal(path.join(__dirname, "../assets/example_dapp_approval.py"), exampleDappContractParams);
    const exampleDappClearCode = await compilePyTeal(path.join(__dirname, "../assets/example_dapp_clear.py"));

    exampleDappAppId = await deployContract(
      exampleDappApprovalCode,
      exampleDappClearCode,
      mainAccount,
      {
        numGlobalByteSlices: 9,
        numGlobalInts: 9,
        numLocalByteSlices: 1,
        numLocalInts: 7
      }
    );
    
    await fundAccount(getApplicationAddress(exampleDappAppId), 700_000);

    let group = await opt_into_gora({
      user: mainAccount,
      suggestedParams: suggestedParams,
      application_id: exampleDappAppId,
      main_app_id: mainAppId,
      asset_id: platformTokenAssetId
    });
    await group.execute(algodClient, 5);

    //need to deposit some funds into goracle main contract to cover requests
    //you're able to deposit funds into an account that is not yours, here we are depositing funds into the example dapps account
    //since it is the account that will be making the request.
    group = depositAlgo({
      user: user, 
      appId: mainAppId, 
      suggestedParams: suggestedParams, 
      amount: 100_000,
      account_to_deposit_to: getApplicationAddress(exampleDappAppId)
    });
    await group.execute(algodClient, 5);

    group = depositToken(
      {
        platformTokenAssetId: platformTokenAssetId, 
        user: user, 
        appId: mainAppId, 
        suggestedParams: suggestedParams, 
        amount: 7_000_000_000,
        account_to_deposit_to: getApplicationAddress(exampleDappAppId)
      }
    );
    await group.execute(algodClient, 5);

    //get players to opt into example dapp
    players = generateUsers(accountGenerator,3);
    for (const player of players){
      await fundAccount(player.addr, 650_000);
      const optInGroup = userOptIn({user: player, appId: exampleDappAppId, suggestedParams: suggestedParams});
      await optInGroup.execute(algodClient, 5);
    }
  });

  it("should let owner start a round, makes request to start a round, and handles the network response", async () => {
    const price = await increment_round(voters, "start");
    
    //should call destination app with btc price
    const appInfo = await algodClient.getApplicationByID(exampleDappAppId).do();
    const globalState = parseAppState(appInfo.params["global-state"]);
    expect(globalState["lp"]).toEqual(Number(bytesToBigInt(price)));
  });

  it("should allow participants to place bets, after round is over, execute a request to get price to lock in price and finish of the round", async () => {
    // TODO need to solve the box size issue with requests
    const start_price = await increment_round(voters, "start");
    const choice_group = await submit_choice(
      {
        user: players[0],
        suggestedParams: suggestedParams,
        choice: "up",
        application_id: exampleDappAppId,
        amount: SUBMISSION_AMOUNT
      }
    );
    await choice_group.execute(algodClient, 5);
    //need to wait until the round is over (180 seconds)
    await new Promise(r => setTimeout(r, 180000));
    
    //since our test run on devnet this transaction exists to update the clock of the chain
    fundAccount(getApplicationAddress(exampleDappAppId), 0);

    const end_price = await increment_round(voters, "end");
    
    const appInfo = await algodClient.getApplicationByID(exampleDappAppId).do();
    const globalState = parseAppState(appInfo.params["global-state"]);
    expect(globalState["rs"]).toEqual("closed");
  });
});