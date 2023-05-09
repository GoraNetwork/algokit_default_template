import path from "path";
import {
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  makeApplicationCreateTxnFromObject,
  OnApplicationComplete,
  SuggestedParams,
  BoxReference,
  decodeAddress,
  getApplicationAddress,
} from "algosdk";
import {
  algodClient,
  getMethodByName,
  loadABIContract,
  compilePyTeal,
  sendTxn
} from "algoutils";

import {
  getABIHash
} from "../../utils/gora_utils";
import { sha512_256 } from "js-sha512";

const ABI_PATH = "../test_fixtures/inner_test-contract.json";
const contractABI = loadABIContract(path.join(__dirname, ABI_PATH));
const abiHash = getABIHash(path.join( "../test/test", ABI_PATH));

type DeployParams = {
  deployer: Account,
  mainAppID: number
}


export async function deployContract(deployParams: DeployParams){
  
  const mainContractParams = {
    MAIN_APP : deployParams.mainAppID
  };

  const approvalCode = await compilePyTeal(path.join(__dirname, "../test_fixtures/inner_test_approval.py"), mainContractParams);
  const clearCode = await compilePyTeal(path.join(__dirname, "../test_fixtures/inner_test_clear.py"));

  const storageSchema = {
    numGlobalByteSlices: 1,
    numGlobalInts: 5,
    numLocalByteSlices: 3,
    numLocalInts: 7
  };
  const transactionParams = await algodClient().getTransactionParams().do();
  const createApplicationTransaction = makeApplicationCreateTxnFromObject({
    suggestedParams: transactionParams,
    from: deployParams.deployer.addr,
    onComplete: OnApplicationComplete.NoOpOC,
    approvalProgram: approvalCode,
    clearProgram: clearCode,
    ...storageSchema
  });

  const signedCreateTxn = createApplicationTransaction.signTxn(deployParams.deployer.sk);

  const txnResponse = await sendTxn(algodClient(), signedCreateTxn);

  const appId = txnResponse["application-index"];

  return appId;
}

type optIntoParams = {
  user: Account,
  suggestedParams: SuggestedParams,
  application_id: number,
  main_app_id: number,
  asset_id: number
}
export async function opt_into_gora(params: optIntoParams)
{
  const txnGroup = new AtomicTransactionComposer();
  txnGroup.addMethodCall({
    method: getMethodByName("opt_in_gora", contractABI),
    methodArgs:[
      params.asset_id,
      params.main_app_id
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.application_id,
    suggestedParams: params.suggestedParams
  });
  return txnGroup;
}

type innerRequestParams = {
  user: Account,
  suggestedParams: SuggestedParams,
  app_ids: number[],
  depth: number,
  requestArgs: Uint8Array,
  destination: Uint8Array,
  type: number,
  goracleMain: number,
  expectedRequestSender: number
}
export async function makeInnerRequest(params: innerRequestParams)
{
  const txnGroup = new AtomicTransactionComposer();
  if(params.app_ids.length < 7)
  {
    for(let i = params.app_ids.length; i < 7; i++)
    {
      params.app_ids.push(params.app_ids[0]);
    }
  }

  const boxes : BoxReference[] = [
    {
      name: new Uint8Array(sha512_256.arrayBuffer([...decodeAddress(getApplicationAddress(params.expectedRequestSender)).publicKey, ...Buffer.from("my_key")])),
      appIndex: params.goracleMain
    }
  ];
  
  txnGroup.addMethodCall({
    method: getMethodByName("make_inner_request", contractABI),
    boxes: boxes,
    methodArgs:[
      params.depth,
      params.requestArgs,
      params.destination,
      params.type,
      params.goracleMain,
      params.app_ids[1],
      params.app_ids[2],
      params.app_ids[3],
      params.app_ids[4],
      params.app_ids[5],
      params.app_ids[6],
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.app_ids[0],
    suggestedParams: params.suggestedParams
  });
  return txnGroup;
}

type setChildParams = {
  user: Account,
  suggestedParams: SuggestedParams
  application_id: number,
  child_id: number
}
export async function setChild(params: setChildParams)
{
  const txnGroup = new AtomicTransactionComposer();
  txnGroup.addMethodCall({
    method: getMethodByName("set_child", contractABI),
    methodArgs:[
      params.child_id
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.application_id,
    suggestedParams: params.suggestedParams
  });
  return txnGroup;
}