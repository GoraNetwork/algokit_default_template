import path from "path";
import {
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  SuggestedParams,
  decodeAddress,
  LogicSigAccount,
  makeLogicSigAccountTransactionSigner,
  makeApplicationCallTxnFromObject,
  OnApplicationComplete,
  encodeUint64,
  ABIArrayStaticType,
  ABIByteType,
  makeApplicationUpdateTxnFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
  getApplicationAddress,
  BoxReference,
  Algodv2,
  ABIValue
} from "algosdk";

import {
  getABIHash,
  getVoteHash
} from "../../utils/gora_utils";

import {
  compilePyTeal,
  deployContract,
  getMethodByName,
  loadABIContract,
} from "algoutils";

import { 
  ResponseBodyType,
  ResponseBodyBytesType,
  LocalHistoryType
} from "../../utils/abi_types";

type DeployParams = {
  deployer: Account, 
  mainAppId: number,
  thresholdRatio: number,
}

const ALGODCLIENT = new Algodv2(process.env.ALGOD_TOKEN!, process.env.ALGOD_SERVER!, process.env.ALGOD_PORT);
export async function deployVoteContract(deployParams: DeployParams){
  const abiHash = getABIHash("../assets/abi/main-contract.json");
  const votingContractParams = {
    MAIN_APP: deployParams.mainAppId,
    CONTRACT_VERSION: abiHash
  };
  const votingApprovalCode = await compilePyTeal(path.join(__dirname, "../../assets/voting_approval.py"), votingContractParams);
  const votingClearCode = await compilePyTeal(path.join(__dirname, "../../assets/voting_clear.py"));

  const votingAppId = await deployContract(
    votingApprovalCode,
    votingClearCode,
    deployParams.deployer,
    {
      numGlobalByteSlices: 35,
      numGlobalInts: 29,
      numLocalByteSlices: 2,
      numLocalInts: 3
    }
  );

  return votingAppId;
}

type UpdateParams = {
  updater: Account, 
  mainAppId: number,
  appIdToUpdate: number,
  VOTE_VERIFY_LSIG_ADDRESS: string,
  CONTRACT_VERSION: string
}

export async function updateVoteContract(deployParams: UpdateParams){
  const abiHash = getABIHash("../assets/abi/main-contract.json");
  const votingContractParams = {
    CONTRACT_VERSION: abiHash,
    VOTE_VERIFY_LSIG_ADDRESS: deployParams.VOTE_VERIFY_LSIG_ADDRESS
  };
  const votingApprovalCode = await compilePyTeal(path.join(__dirname, "../../assets/voting_approval.py"), votingContractParams);
  const votingClearCode = await compilePyTeal(path.join(__dirname, "../../assets/voting_clear.py"));
  const transactionParams = await ALGODCLIENT.getTransactionParams().do();
  const storageSchema = {
    numGlobalByteSlices: 35,
    numGlobalInts: 29,
    numLocalByteSlices: 2,
    numLocalInts: 3
  };
  const updateApplicationTransaction = makeApplicationUpdateTxnFromObject({
    suggestedParams: transactionParams,
    appIndex: deployParams.appIdToUpdate,
    from: deployParams.updater.addr,
    approvalProgram: votingApprovalCode,
    clearProgram: votingClearCode,
    ...storageSchema
  });

  const signedUpdateTxn = updateApplicationTransaction.signTxn(deployParams.updater.sk);
  const txnResponse = await ALGODCLIENT.sendRawTransaction([signedUpdateTxn]);
  return txnResponse;
}

type RegisterParams = {
  user: Account,
  primaryAccount: string
  votingAppId: number,
  mainAppId: number,
  suggestedParams: SuggestedParams
}

const votingContract = loadABIContract(path.join(__dirname, "../../assets/abi/voting-contract.json"));
const MAIN_ABI_PATH = "../../assets/abi/main-contract.json";
const mainContract = loadABIContract(path.join(__dirname, MAIN_ABI_PATH));

export function registerVoter(params: RegisterParams)
{

  const transferTxn = {
    txn: makePaymentTxnWithSuggestedParamsFromObject({
      from: params.user.addr,
      suggestedParams: params.suggestedParams,
      to: getApplicationAddress(params.votingAppId),
      amount: 54100 + 66900,
    }),
    signer: makeBasicAccountTransactionSigner(params.user)
  };
  const registerGroup = new AtomicTransactionComposer();
  registerGroup.addMethodCall({
    method: getMethodByName("register_voter", votingContract),
    methodArgs: [
      transferTxn,
      decodeAddress(params.primaryAccount).publicKey,
      params.mainAppId,
    ],
    boxes:[
      {
        appIndex:params.votingAppId,
        name:decodeAddress(params.primaryAccount).publicKey
      }
    ],
    appID: params.votingAppId,
    suggestedParams: params.suggestedParams,
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user)
  });
  return registerGroup;
}

type DeregisterParams = {
  user: Account,
  primaryAccount: string
  votingAppId: number,
  mainAppId: number,
  suggestedParams: SuggestedParams
}

export async function deregisterVoter(params: DeregisterParams)
{
  const primaryAccountPK = decodeAddress(params.primaryAccount).publicKey;
  const previousVoteBox = await ALGODCLIENT.getApplicationBoxByName(params.votingAppId,primaryAccountPK).do();
  const previousVoteEntry : any = LocalHistoryType.decode(previousVoteBox.value);
  const deregisterGroup = new AtomicTransactionComposer();
  deregisterGroup.addMethodCall({
    method: getMethodByName("deregister_voter", votingContract),
    methodArgs: [
      decodeAddress(params.primaryAccount).publicKey,
      params.mainAppId,
    ],
    boxes:[
      {
        appIndex:params.votingAppId,
        name:decodeAddress(params.primaryAccount).publicKey
      },
      {
        appIndex:params.votingAppId,
        name:new Uint8Array(previousVoteEntry[1][0])
      }
    ],
    appID: params.votingAppId,
    suggestedParams: {
      ...params.suggestedParams,
      flatFee: true,
      fee: 2000
    },
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user)
  });
  return deregisterGroup;
}

type VotingParams = {
  user: Account,
  voteVerifyLsig: LogicSigAccount, 
  votingAppId: number,
  vrfResult: string,
  vrfProof: string,
  requestRoundSeed: Uint8Array,
  mainContractAppId: number,
  suggestedParams: SuggestedParams
  ip: Uint8Array,
  port: number,
  network: number
  destinationAppId: number,
  destinationMethod: Uint8Array,
  requesterAddress: string,
  primaryAccount: string,
  request_id: string | Uint8Array,
  return_value: string | Uint8Array,
  user_data: string,
  error_code: number,
  bit_field: number,
  voteCount: number,
  zIndex: number,
  timelock: number,
  request_key_hash: Uint8Array,
  mockSeed?: Uint8Array,
  mockLease?: Uint8Array,
  mockPreviousVote?: Uint8Array,
  appRefs: number[],
  assetRefs: number[],
  accountRefs: string[],
  boxRefs: BoxReference[]
}

export async function vote(params: VotingParams){
  const voteGroup = new AtomicTransactionComposer();

  const byte64Type = new ABIArrayStaticType(new ABIByteType(), 64);
  const byte80Type = new ABIArrayStaticType(new ABIByteType(), 80);

  const lease = (params.mockLease ? params.mockLease : new Uint8Array(Buffer.from(params.request_id)));
  
  const response_type = 1;
  const response_body = ResponseBodyType.encode([
    Buffer.from(params.request_id),
    params.requesterAddress,
    Buffer.from(params.return_value),
    Buffer.from(params.user_data),
    params.error_code,
    params.bit_field
  ]);

  const primaryAccountPK = decodeAddress(params.primaryAccount).publicKey;
  const previousVoteBox = await ALGODCLIENT.getApplicationBoxByName(params.votingAppId,primaryAccountPK).do();
  const previousVoteEntry : any = LocalHistoryType.decode(previousVoteBox.value);
  const keyHash = new Uint8Array(Buffer.from(previousVoteEntry[0] as Uint8Array));
  const previous_requester = previousVoteEntry[1][5];
  ResponseBodyBytesType.encode(response_body);

  let previousVoteBytes = previousVoteBox.value;
  if(params.mockPreviousVote)
  {
    previousVoteBytes = params.mockPreviousVote;
  }

  const newVote = await getVoteHash(
    params.destinationAppId,
    params.destinationMethod,
    params.requesterAddress,
    params.request_id as Uint8Array,
    params.return_value as string,
    params.user_data,
    params.error_code,
    params.bit_field,
  );

  const voteVerifyBoxArray: BoxReference[] = [
    {
      appIndex:params.votingAppId,
      name:new Uint8Array(previousVoteEntry[1][0]) // previous_vote proposal
    },
    {
      appIndex: params.mainContractAppId,
      name: params.request_key_hash // request box
    },
    {
      appIndex:params.mainContractAppId,
      name:keyHash // previous vote before update
    }
  ];

  const vote_verify_params = params.suggestedParams;
  vote_verify_params.flatFee = true;
  vote_verify_params.fee = 0;

  const voteVerifyTxn = {
    txn: makeApplicationCallTxnFromObject({
      from: params.voteVerifyLsig.address(),
      appIndex: params.mainContractAppId,
      suggestedParams: vote_verify_params,
      appArgs: [
        getMethodByName("claim_rewards_vote_verify", mainContract).getSelector(),
        byte64Type.encode(new Uint8Array(Buffer.from(params.vrfResult))),
        byte80Type.encode(new Uint8Array(Buffer.from(params.vrfProof))),
        params.requestRoundSeed,
        encodeUint64(1),
        encodeUint64(2),
        encodeUint64(3),
        encodeUint64(1),
        params.request_key_hash,
        previousVoteBytes!,
        encodeUint64(4)
      ],
      accounts: [
        params.user.addr,
        params.primaryAccount,
        getApplicationAddress(params.votingAppId),
        previous_requester
      ],
      foreignApps: [
        params.votingAppId,
      ],
      boxes: voteVerifyBoxArray,
      onComplete: OnApplicationComplete.NoOpOC,
    }),
    signer: makeLogicSigAccountTransactionSigner(params.voteVerifyLsig)
  };

  const voteBoxArray: BoxReference[] = [
    {
      appIndex:params.votingAppId,
      name:newVote // proposalbox
    },
    {
      appIndex:params.votingAppId,
      name:primaryAccountPK // local state box
    },
  ];

  const vote_params = params.suggestedParams;
  vote_params.flatFee = true;
  vote_params.fee = 2000; //for now if the vote transaction fails due to this error "account Y2UCEIGG5URU5JKX575FN3LW3HUSCWZTQJBKM74EIOBTF55WW6W6AR7DCA balance 99000 below min 100000 (0 assets)"
  //then up this to 3000 and try again.

  voteGroup.addMethodCall({
    method: getMethodByName("vote", votingContract),
    lease: lease,
    methodArgs: [
      Buffer.from(params.vrfResult),
      Buffer.from(params.vrfProof),
      params.mainContractAppId,
      params.destinationAppId,
      Buffer.from(params.destinationMethod),
      params.requesterAddress,
      params.ip,
      params.port,
      params.network,
      primaryAccountPK,
      response_type,
      response_body,
      params.voteCount,
      params.zIndex,
      voteVerifyTxn
    ],
    boxes: [
      ...voteBoxArray,
      ...params.boxRefs
    ],
    appForeignApps: params.appRefs,
    appAccounts: params.accountRefs,
    appForeignAssets: params.assetRefs,
    appID: params.votingAppId,
    suggestedParams: vote_params,
    sender: params.user.addr,
    note: (params.mockSeed ? params.mockSeed : undefined),
    signer: makeBasicAccountTransactionSigner(params.user)
  });
  return voteGroup;
}

export async function deleteBox(user:Account,voteHash:string,votingAppId:number,suggestedParams:SuggestedParams,client:Algodv2){
  const deleteBoxTxn = new AtomicTransactionComposer();
  const voteHashBytes = new Uint8Array(Buffer.from(voteHash,"base64"));
  deleteBoxTxn.addMethodCall({
    method: getMethodByName("delete_box", votingContract),
    methodArgs: [
      voteHashBytes
    ],
    boxes:[
      {
        appIndex:votingAppId,
        name:voteHashBytes
      }
    ],
    appID: votingAppId,
    suggestedParams: suggestedParams,
    sender: user.addr,
    signer: makeBasicAccountTransactionSigner(user)
  });
  return await deleteBoxTxn.execute(client, 5);
}