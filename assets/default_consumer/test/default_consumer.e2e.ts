import path from "path";
import * as fs from "fs";
import * as bkr from "beaker-ts";
import { 
  Account, 
  makeBasicAccountTransactionSigner, 
  makePaymentTxnWithSuggestedParamsFromObject, 
  getApplicationAddress,
  Algodv2,
  LogicSigAccount,
  SuggestedParams,
  ABIArrayDynamicType,
  ABIByteType,
  AtomicTransactionComposer,
  decodeAddress,
  ABIUintType,
  ABIArrayStaticType,
  ABIAddressType,
  BoxReference,
  ABIValue,
} from "algosdk";
import { loadABIContract } from "algoutils";


import { SandboxAccount } from "beaker-ts/src/sandbox/accounts";
import { DefaultConsumerApp } from "../artifacts/defaultconsumerapp_client";
import { compileBeaker, sendGenericPayment } from "../../../utils/beaker_test_utils";
import { testVote, waitForRounds } from "../../../test/util/utils";
import { getRequestInfo, testAssert } from "../../../utils/gora_utils";
import { AccountGenerator, VotingTestState, beforeEachVotingTest, generateUsers, test_optin,voter_setup } from "../../../test/e2e/vote/voting.helpers";
import accounts from "../../../test/test_fixtures/accounts.json";
import { depositAlgo, depositToken } from "../../transactions/staking_transactions";
import { sha512_256 } from "js-sha512";
import errorCodes from "../../../assets/smart_assert_errors.json";
import { BoxType, PriceBoxTuple, userVoteType } from "../abi_structures";
import { fundAccount } from "algotest";

const ABI_PATH = "../artifacts/contract.json";
const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));
const consumerMethod = consumerContract.methods[2].getSelector();

describe("Stake Delegator Tests", () => {
  let sandboxAccount: SandboxAccount;
  let DefaultConsumerClient: DefaultConsumerApp;
  let appId: number;
  let MainAddress: string;
  let testAsset: number;
  let appAddress: string;
  let goracle_timelock: number;
  let accountGenerator: AccountGenerator;
  let algodClient: Algodv2;
  let suggestedParams: SuggestedParams;
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
  let preparedRequest: AtomicTransactionComposer;
  let priceBoxName: Uint8Array;

  let approvalProgram: any;
  let clearProgram: any;

  function getDefaultConsumerClient(user: Account){
    const client = new DefaultConsumerApp(
      {
        client: bkr.clients.sandboxAlgod(),
        signer: makeBasicAccountTransactionSigner(user),
        sender: user.addr
      }
    );
    return client;
  }

  beforeEach(async () => {
    goracle_timelock = 10;
    accountGenerator = new AccountGenerator(accounts);
    testState = await beforeEachVotingTest(accountGenerator);
    // flatten the testState object
    ({ current_request_round, votingAppId, mainAppId, destinationAppId, algodClient, voteVerifyLsig, user, network, TIME_LOCK, goraRequestFee, algoRequestFee, requestBoxCost, VOTE_REFILL_THRESHOLD, VOTE_REFILL_AMOUNT } = testState);

    MainAddress = getApplicationAddress(mainAppId);
    testAsset = testState.platformTokenAssetId;
    
    // Grab an account
    sandboxAccount = (await bkr.sandbox.getAccounts()).pop()!;
    if (sandboxAccount === undefined) return;

    await compileBeaker("assets/default_consumer/default_consumer.py", {MAIN_APP_ADDRESS: MainAddress, MAIN_APP_ID: mainAppId});
    const program = JSON.parse(fs.readFileSync("./assets/default_consumer/artifacts/application.json", "utf-8"));
    approvalProgram = program.source.approval;
    clearProgram = program.source.clear;
    // Create a new client that will talk to our app
    // Including a signer lets it worry about signing
    // the app call transactions 
    DefaultConsumerClient = getDefaultConsumerClient({addr: sandboxAccount.addr, sk: sandboxAccount.privateKey});
    suggestedParams = await DefaultConsumerClient.getSuggestedParams();

    const appCreateResult = await DefaultConsumerClient.createApplication({appApprovalProgram: approvalProgram, appClearProgram: clearProgram});
    appAddress = appCreateResult.appAddress;
    appId = appCreateResult.appId;

    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, appAddress, 1e6);
    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, MainAddress, 1e6);

    // Create a price box
    priceBoxName = new Uint8Array(Buffer.from("eth/usd"));
    const priceBoxCost = (priceBoxName.length + 8) * 400 + 2500;

    const algoXferTxn = makePaymentTxnWithSuggestedParamsFromObject({
      from: sandboxAccount.addr,
      to: appAddress,
      amount: priceBoxCost,
      suggestedParams: suggestedParams
    });

    const createPriceBoxTxn = await DefaultConsumerClient.compose.create_price_box(
      {
        algo_xfer: algoXferTxn,
        box_name: priceBoxName
      },
      {
        boxes:[
          {
            appIndex: appId,
            name: priceBoxName
          }
        ]
      }
    );
    await createPriceBoxTxn.execute(algodClient,5);

    // Set up consumer app to make requests
    await DefaultConsumerClient.opt_in_gora({
      asset_reference: BigInt(testAsset),
      main_app_reference: BigInt(mainAppId)
    });

    let group = depositAlgo({
      user: user,
      appId: mainAppId,
      suggestedParams: suggestedParams,
      amount: 100_000,
      account_to_deposit_to: appAddress
    });
    await group.execute(algodClient,5);

    group = depositToken({
      platformTokenAssetId: testAsset,
      user: user,
      appId: mainAppId,
      suggestedParams: suggestedParams,
      amount: 7_000_000_000,
      account_to_deposit_to: appAddress
    });
    await group.execute(algodClient,5);

    // Form inputs to make request
    const key = new Uint8Array(Buffer.from("foo"));
    const formValues:any = {
      assets:"eth",
      curr:"usd",
      destinationAppId:appId,
      destMethod: "TODO"
    };
    const urlParams = new URLSearchParams(formValues).toString();

    const sourceArgsArr = [
      new Uint8Array(Buffer.from("v2/crypto/prices")),
      new Uint8Array(Buffer.from("TODO api key needed?")),
      new Uint8Array(Buffer.from(urlParams)),
      new Uint8Array(Buffer.from("number")),
      new Uint8Array(Buffer.from("$.price"))
    ];
    const sourceArgListType =  new ABIArrayDynamicType(new ABIArrayDynamicType(new ABIByteType()));
    const sourceArgs = sourceArgListType.encode(sourceArgsArr);

    preparedRequest = await DefaultConsumerClient.compose.send_request(
      {
        box_name: priceBoxName,
        key: key,
        token_asset_id: BigInt(testAsset),
        source_arr: [[BigInt(6), sourceArgs, BigInt(60)]],
        agg_method: BigInt(3),
        user_data: Buffer.from("test"),
        main_app_reference: BigInt(mainAppId)
      },
      {
        boxes:[
          {
            appIndex: mainAppId,
            name: new Uint8Array(sha512_256.arrayBuffer([ ...decodeAddress(appAddress).publicKey, ...key]))
          }
        ]
      }
    );
  });

  it("Should make a request, get voted on, and update price box", async () => {
    const voters = generateUsers(accountGenerator,5);

    for (const voter of voters) {
      testState.ephemeral_map = await test_optin(voter, mainAppId, testState, accountGenerator);
      await voter_setup(voter, mainAppId, votingAppId, testState);
    }
    await waitForRounds(TIME_LOCK + 1);

    const result = await preparedRequest.execute(algodClient,5);
    const key_hash = result.methodResults[0].txInfo!.txn.txn.apbx[0].n;
    const refs = result.methodResults[0].txInfo!["inner-txns"][0].txn.txn.apaa;
    
    // const requestTuple = RequestArgsType.decode(refs[1]);
    // const destinationTuple = DestinationType.decode(refs[2]);
    // const requestTypeParam = (new ABIUintType(64)).decode(refs[3]);
    // const keyArg = (new ABIArrayDynamicType(new ABIByteType())).decode(refs[4]);
    const appRefsABI = (new ABIArrayStaticType(new ABIUintType(64),1)).decode(refs[5]);
    const assetRefsABI = (new ABIArrayStaticType(new ABIUintType(64),1)).decode(refs[6]);
    const accountRefs = (new ABIArrayStaticType(new ABIAddressType(),1)).decode(refs[7]);
    const boxRefsABI = (new ABIArrayDynamicType(BoxType)).decode(refs[8]);
    
    const appRefs: number[] = [];
    for (const appRef of appRefsABI){
      appRefs.push(Number(appRef as number));
    }
    const assetRefs: number[] = [];
    for (const assetRef of assetRefsABI){
      assetRefs.push(Number(assetRef as number));
    }
    const boxRefs: BoxReference[] = [];
    for (const boxRef of boxRefsABI){
      const boxTypeABI = boxRef as ABIValue[];
      const box: BoxReference = {
        appIndex:Number(boxTypeABI[1] as number),
        name: new Uint8Array(boxTypeABI[0] as Uint8Array)
      };
      boxRefs.push(box);
    }
    // const priceBoxTuple = PriceBoxTuple.encode([1,1]);
    
    const userVote = userVoteType.encode([
      [1,1],
      priceBoxName
    ]);
    const request_info = await getRequestInfo(mainAppId, key_hash, algodClient);

    for (const voter of voters) {
      const participationAccount = testState.ephemeral_map.get(voter.addr);
      if (!participationAccount) {
        throw new Error("Participation account not found");
      }
      const vote = testVote({
        algodClient,
        voter: participationAccount,
        userVote: userVote,
        mainAppId,
        votingAppId,
        destinationAppId:appId,
        requesterAddress: appAddress,
        primaryAccount: voter.addr,
        methodSelector: consumerMethod,
        requestRound: request_info.request_round,
        network: network,
        voteVerifyLsig,
        timelock: TIME_LOCK,
        request_key_hash: key_hash,
        appRefs: appRefs as number[],
        assetRefs: assetRefs as number[],
        accountRefs: accountRefs as string[],
        boxRefs: boxRefs as BoxReference[]
      });
      try {
        await vote;
      } catch (e) {
        // case where voter votes on an already completed request due to randomness in number of votes assigned to each voter
        await testAssert(vote,errorCodes[2]);
        break;
      }      
    }
    await fundAccount(appAddress,1e6);
    const defualtConsumerBoxes = (await algodClient.getApplicationBoxes(appId).do()).boxes;
    const box = await algodClient.getApplicationBoxByName(appId,defualtConsumerBoxes[0].name).do();
    const priceBox = PriceBoxTuple.decode(box.value);
    expect(priceBox[0]).toEqual(BigInt(1));
  });
});