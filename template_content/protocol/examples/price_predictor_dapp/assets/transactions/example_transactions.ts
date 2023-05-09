import {
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  SuggestedParams,
  makePaymentTxnWithSuggestedParamsFromObject,
  getApplicationAddress,
  BoxReference,
  decodeAddress,
} from "algosdk";
import {
  loadABIContract,
  compilePyTeal,
  deployContract,
  getMethodByName
} from "algoutils";
import { sha512_256 } from "js-sha512";
import path from "path";
import{
  ResponseBodyType
} from "../../../../utils/abi_types";

const ABI_PATH = "../abi/example-dapp.json";
const exampleContract = loadABIContract(path.join(__dirname, ABI_PATH));

type DeployParams = {
  user: Account
  goracle_creator: string,
  submission_time: number,
  wait_time: number
}

export async function deploy_example(params: DeployParams)
{
  const exampleDappContractParams = {
    GORACLE_CREATOR: params.goracle_creator,
    SUBMISSION_TIME: params.submission_time,
    WAIT_TIME: params.wait_time
  };
  const exampleDappApprovalCode = await compilePyTeal(path.join(__dirname, "../example_dapp_approval.py"), exampleDappContractParams);
  const exampleDappClearCode = await compilePyTeal(path.join(__dirname, "../example_dapp_clear.py"));

  const exampleDappAppId = await deployContract(
    exampleDappApprovalCode,
    exampleDappClearCode,
    params.user,
    {
      numGlobalByteSlices: 8,
      numGlobalInts: 9,
      numLocalByteSlices: 0,
      numLocalInts: 7
    }
  );
  return exampleDappAppId;
}

type updatePriceParams = {
  user: Account
  response_type: number,
  new_price: ArrayBuffer,
  bit_field: number,
  error_code: number,
  user_data: string,
  requester: string,
  request_id: string,
  example_contract_id: number,
  suggestedParams: SuggestedParams
}
export async function update_price(params: updatePriceParams)
{

  const response_type = 1;
  const response_body = ResponseBodyType.encode([
    Buffer.from(params.request_id),
    params.requester,
    Buffer.from(params.new_price),
    Buffer.from(params.user_data),
    params.error_code,
    params.bit_field
  ]);

  const updatePriceGroup = new AtomicTransactionComposer();
  updatePriceGroup.addMethodCall({
    method: getMethodByName("update_price", exampleContract),
    methodArgs: [
      response_type,
      response_body,
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.example_contract_id,
    suggestedParams: params.suggestedParams
  });
  return updatePriceGroup;
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
    method: getMethodByName("opt_in_gora", exampleContract),
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

type startRoundParams = {
  user: Account,
  suggestedParams: SuggestedParams,
  submission_amount: number,
  application_id: number,
  goracle_main_app: number
}
export async function start_round(params: startRoundParams) {
  const txnGroup = new AtomicTransactionComposer();
  const boxes : BoxReference[] = [
    {
      name: new Uint8Array(sha512_256.arrayBuffer([...decodeAddress(getApplicationAddress(params.application_id)).publicKey, ...Buffer.from("start")])),
      appIndex: params.goracle_main_app
    }
  ];
  txnGroup.addMethodCall({
    method: getMethodByName("start_round", exampleContract),
    boxes: boxes,
    methodArgs:[
      params.submission_amount,
      params.goracle_main_app
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.application_id,
    suggestedParams: params.suggestedParams
  });
  return txnGroup;
}

type endRoundParams = {
  user: Account,
  suggestedParams: SuggestedParams,
  application_id: number,
  goracle_main_app: number
}
export async function end_round(params: endRoundParams) {
  const txnGroup = new AtomicTransactionComposer();
  const boxes : BoxReference[] = [
    {
      name: new Uint8Array(sha512_256.arrayBuffer([...decodeAddress(getApplicationAddress(params.application_id)).publicKey, ...Buffer.from("end")])),
      appIndex: params.goracle_main_app
    }
  ];
  txnGroup.addMethodCall({
    method: getMethodByName("end_round", exampleContract),
    boxes: boxes,
    methodArgs:[
      params.goracle_main_app
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.application_id,
    suggestedParams: params.suggestedParams
  });
  return txnGroup;
}

type submitChoiceParams = {
  user: Account,
  suggestedParams: SuggestedParams,
  choice: string,
  application_id: number,
  amount: number
}
export async function submit_choice(params: submitChoiceParams) {
  const txnGroup = new AtomicTransactionComposer();
  const transferTxn = {
    txn: makePaymentTxnWithSuggestedParamsFromObject({
      from: params.user.addr,
      suggestedParams: params.suggestedParams,
      amount: params.amount,
      to: getApplicationAddress(params.application_id),
    }),
    signer: makeBasicAccountTransactionSigner(params.user)
  };
  
  txnGroup.addMethodCall({
    method: getMethodByName("submit_choice", exampleContract),
    methodArgs:[
      transferTxn,
      params.choice,
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.application_id,
    suggestedParams: params.suggestedParams
  });
  return txnGroup;
}