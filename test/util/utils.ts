import {
  Algodv2,
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makeApplicationOptInTxnFromObject,
  getApplicationAddress,
  SuggestedParams,
  decodeUint64,
  ABIContract,
  secretKeyToMnemonic,
  LogicSigAccount,
  generateAccount,
  BoxReference
} from "algosdk";
import {
  getMethodByName,
} from "algoutils";
import {
  getDefaultAccount,
  fundAccount
} from "algotest";

import {
  vote
} from "../../assets/transactions/vote_transactions";
import {
  approxCDF, getVoteHash
} from "../../utils/gora_utils";
import { getLocalStake, getRequestInfo } from "../../utils/gora_utils";

export async function getGlobalStateDict(votingAppId:number,algodClient:Algodv2) {
  const appStatePost = await algodClient.getApplicationByID(votingAppId).do();
  const dict = Object.create(null);
  for (let i = 0; i < appStatePost["params"]["global-state"].length;i++){
    const appGlobalState = appStatePost["params"]["global-state"][i];
    const keyBase64 = Buffer.from(appGlobalState["key"],"base64");
    const key = keyBase64.toString().replace(/[^a-zA-Z ]/g,"");
    if (key == "p"){
      try{
        const proposalIndex = decodeUint64(keyBase64.subarray(2),"safe");
        dict[`${key+proposalIndex}`] = appGlobalState;
      }catch(error){
        console.error(error);
      }
    } else if (key == "pt"){
      try{
        const proposalIndex = decodeUint64(keyBase64.subarray(3),"safe");
        dict[`${key+proposalIndex}`] = appGlobalState;
      }catch(error){
        console.error(error);
      }
    } else if (key == "c"){
      dict[`${key}`] = appGlobalState;
    } else{
      dict[i] = appGlobalState;
    }
  }
  return dict;
}

export async function optIntoContract (
  voter:Account,
  appId:number,
  suggestedParams:SuggestedParams,
  algodClient:Algodv2
) {
  //opt account into mainContract contract
  const optInGroup = new AtomicTransactionComposer();
  const optInTxn = makeApplicationOptInTxnFromObject({
    from: voter.addr,
    suggestedParams,
    appIndex: appId
  });
  optInGroup.addTransaction({
    txn: optInTxn,
    signer: makeBasicAccountTransactionSigner(voter)
  });
  await optInGroup.execute(algodClient, 5);
}

export async function stakeVoter(
  voter:Account,
  amount:number,
  tokenAssetId:number,
  mainContract:ABIContract,
  mainContractAppId:number,
  suggestedParams:SuggestedParams,
  algodClient:Algodv2
) {
  const mainContractGroup = new AtomicTransactionComposer();
  const tokenTransferTxn = {
    txn: makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: voter.addr,
      suggestedParams,
      amount: amount,
      to: getApplicationAddress(mainContractAppId),
      assetIndex: tokenAssetId
    }),
    signer: makeBasicAccountTransactionSigner(voter)
  };
  mainContractGroup.addMethodCall({
    method: getMethodByName("stake", mainContract),
    methodArgs: [
      tokenTransferTxn
    ],
    sender: voter.addr,
    signer: makeBasicAccountTransactionSigner(voter),
    appID: mainContractAppId,
    suggestedParams: suggestedParams
  });
  await mainContractGroup.execute(algodClient, 2);
}

export async function getSandboxAccount(): Promise<Account> {
  if (!process.env.ALGOD_SERVER || !process.env.KMD_PORT || !process.env.ALGOD_TOKEN) {
    throw new Error("Algod server, kmd port and algod token must be specified");
  }
  const sandboxAccount = await getDefaultAccount(process.env.ALGOD_SERVER, process.env.ALGOD_TOKEN, process.env.KMD_PORT);
  process.env.SANDBOX_MNEMONIC = secretKeyToMnemonic(sandboxAccount.sk);
  return sandboxAccount;
}

type TestVoteParams = {
  algodClient: Algodv2,
  voter: Account,
  userVote: string | Uint8Array,
  mainAppId: number,
  votingAppId: number,
  destinationAppId: number,
  requesterAddress: string,
  primaryAccount: string,
  methodSelector: any,
  network: number,
  request_key_hash: Uint8Array,
  requestRound?: any,
  vrfResult?: Uint8Array,
  vrfProof?: Uint8Array,
  voteVerifyLsig: LogicSigAccount,
  timelock: number,
  mockSeed?: Uint8Array,
  mockLease?: Uint8Array,
  mockParams?: SuggestedParams
  mockPreviousVote?: Uint8Array,
  appRefs?: number[],
  assetRefs?: number[],
  accountRefs?: string[],
  boxRefs?: BoxReference[]
}

export function generateVRFProof(seed: Uint8Array, secretKey: Uint8Array) {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const Vrf = require("@algoracle/vrf-algorand-sodium");

  const vrfProof = Vrf.prove(secretKey, seed);

  const vrfResult = Vrf.proofToHash(vrfProof);

  return {
    vrfProof,
    vrfResult
  };
}

export async function testVote({
  algodClient,
  voter,
  userVote,
  mainAppId,
  votingAppId,
  destinationAppId,
  requesterAddress,
  primaryAccount,
  methodSelector,
  network,
  requestRound,
  vrfResult,
  vrfProof,
  voteVerifyLsig,
  mockSeed,
  mockLease,
  mockParams,
  timelock,
  request_key_hash,
  mockPreviousVote,
  appRefs,
  assetRefs,
  accountRefs,
  boxRefs
}: TestVoteParams)
{
  let suggestedParams;
  if (mockParams){
    suggestedParams = mockParams;
  }
  else{
    suggestedParams = await algodClient.getTransactionParams().do();
    if(requestRound)
    {
      suggestedParams.firstRound = requestRound + 1;
      suggestedParams.lastRound = requestRound + timelock;
    }
  }

  let _requestRound = requestRound;
  if (!_requestRound) {
    _requestRound = suggestedParams!.firstRound - 1;
  }

  const blockInfo = await algodClient.block(_requestRound).do();

  let requestRoundSeed = blockInfo.block.seed;

  // if block seed is empty then use dev mode strategy
  let _mockSeed = mockSeed;
  if (!requestRoundSeed) {
    if (!_mockSeed) {
      requestRoundSeed = new Uint8Array([...Array(32).keys()]);
      _mockSeed = requestRoundSeed;
    } else {
      requestRoundSeed = _mockSeed;
    }
  }

  const _mockLease = mockLease;

  let _vrfResult, _vrfProof;
  if (!vrfResult && !vrfProof) {
    ({ vrfResult: _vrfResult, vrfProof: _vrfProof } = generateVRFProof(requestRoundSeed, voter.sk));
  } else {
    _vrfResult = vrfResult;
    _vrfProof = vrfProof;
  }

  if (!appRefs) {
    appRefs = [];
  }

  if (!assetRefs) {
    assetRefs = [];
  }

  if (!accountRefs) {
    accountRefs = [];
  }

  if (!boxRefs) {
    boxRefs = [];
  }

  // get local stake
  const localStake = await getLocalStake(primaryAccount,mainAppId,algodClient);
  const { voteCount, zIndex } = approxCDF(_vrfResult, localStake.currentLocalStake);
  // get request_id
  let request_id;
  try {
    const request_info = await getRequestInfo(mainAppId, request_key_hash, algodClient);
    request_id = request_info.request_id as Uint8Array;
    if (request_id.length === 1)
    {
      request_id = new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
    }
  } catch (error) {
    request_id = new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  }


  const voteGroup = await vote({
    user: voter,
    voteVerifyLsig: voteVerifyLsig,
    votingAppId: votingAppId,
    vrfResult: _vrfResult,
    vrfProof: _vrfProof,
    requestRoundSeed: new Uint8Array(requestRoundSeed),
    mainContractAppId: mainAppId,
    suggestedParams: suggestedParams,
    ip: Buffer.from([127,0,0,1]),
    port: 1234,
    network: network,
    destinationAppId: destinationAppId,
    destinationMethod: methodSelector,
    requesterAddress: requesterAddress,
    primaryAccount: primaryAccount,
    request_id: request_id, //this is the transaction ID of the original request, this example just has a static value
    return_value: userVote,
    user_data: "this_is_user_data",
    error_code: 0,
    bit_field: 10,
    request_key_hash: request_key_hash, 
    mockSeed: _mockSeed,
    mockLease: _mockLease,
    zIndex,
    voteCount,
    timelock,
    mockPreviousVote,
    appRefs: appRefs,
    assetRefs: assetRefs,
    accountRefs: accountRefs,
    boxRefs: boxRefs
  });

  const newVote = await getVoteHash(
    destinationAppId,
    methodSelector,
    requesterAddress,
    request_id as Uint8Array,
    userVote as string,
    "this_is_user_data",
    0,
    10,
  );

  return {
    voteCount,
    result: await voteGroup.execute(algodClient, 5),
    vote_hash: newVote
  };
}

export async function waitForRounds(rounds: number) {
  // need txns to advance rounds in dev mode
  for(let i = 0; i < rounds; i++)
  {
    await fundAccount(generateAccount().addr,100_000);
  }
}

