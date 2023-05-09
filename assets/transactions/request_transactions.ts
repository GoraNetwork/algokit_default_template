import path from "path";
import {
  Account,
  AtomicTransactionComposer,
  BoxReference,
  decodeAddress,
  makeBasicAccountTransactionSigner,
  SuggestedParams
} from "algosdk";
import {
  getMethodByName,
  loadABIContract
} from "algoutils";
import { sha512_256 } from "js-sha512";

const requestContract = loadABIContract(path.join(__dirname, "../../assets/abi/main-contract.json"));

type RequestParams = {
  user: Account, 
  appID: number,
  suggestedParams: SuggestedParams,
  request_args: Uint8Array,
  destination: Uint8Array,
  type: number,
  key: Uint8Array,
  appRefs: number[],
  assetRefs: number[],
  accountRefs: string[],
  boxRefs: any[]
}
                   
export function request(requestParams: RequestParams){
  const requestGroup = new AtomicTransactionComposer();
  
  const boxes: BoxReference[] = [
    {
      appIndex: requestParams.appID,
      name: new Uint8Array(sha512_256.arrayBuffer([ ...decodeAddress(requestParams.user.addr).publicKey, ...requestParams.key]))
    }
  ];
  requestGroup.addMethodCall({
    method: getMethodByName("request", requestContract),
    methodArgs: [
      requestParams.request_args,
      requestParams.destination,
      requestParams.type,
      requestParams.key,
      requestParams.appRefs,
      requestParams.assetRefs,
      requestParams.accountRefs,
      requestParams.boxRefs
    ],
    boxes: boxes,
    sender: requestParams.user.addr,
    signer: makeBasicAccountTransactionSigner(requestParams.user),
    appID: requestParams.appID,
    suggestedParams: requestParams.suggestedParams
  });
  return requestGroup;
}

type SubscriptionParams = {
  user: Account, 
  appID: number,
  suggestedParams: SuggestedParams,
  request_args: Uint8Array,
  destination: Uint8Array,
  subscription: Uint8Array,
  type: number
}
                   
export function subscribe(subscriptionParams: SubscriptionParams){
  const requestGroup = new AtomicTransactionComposer();

  requestGroup.addMethodCall({
    method: getMethodByName("subscribe", requestContract),
    methodArgs: [
      subscriptionParams.request_args,
      subscriptionParams.destination,
      subscriptionParams.subscription,
      subscriptionParams.type
    ],
    sender: subscriptionParams.user.addr,
    signer: makeBasicAccountTransactionSigner(subscriptionParams.user),
    appID: subscriptionParams.appID,
    suggestedParams: subscriptionParams.suggestedParams
  });
  return requestGroup;
}