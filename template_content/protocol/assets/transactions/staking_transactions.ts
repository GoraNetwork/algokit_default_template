import path from "path";
import {
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
  getApplicationAddress,
  SuggestedParams,
  decodeAddress,
  Algodv2,
} from "algosdk";

import {
  getMethodByName,
  loadABIContract
} from "algoutils";
import { LocalHistoryType } from "../../utils/abi_types";
import { getGlobalStateVote } from "../../utils/gora_utils";

const stakingContract = loadABIContract(path.join(__dirname, "../../assets/abi/main-contract.json"));
const votingContract = loadABIContract(path.join(__dirname, "../../assets/abi/voting-contract.json"));

type UnstakeParams = {
  platformTokenAssetId: number, 
  user: Account, 
  appId: number, 
  suggestedParams: SuggestedParams, 
  amount: number
}

export function unstake(unstakeParams: UnstakeParams){
  const stakingGroup = new AtomicTransactionComposer();
  const suggestedParams = {
    ...unstakeParams.suggestedParams,
    flatFee: true,
    fee: 2000
  };
  stakingGroup.addMethodCall({
    method: getMethodByName("unstake", stakingContract),
    methodArgs: [
      unstakeParams.amount,
      unstakeParams.platformTokenAssetId
    ],
    sender: unstakeParams.user.addr,
    signer: makeBasicAccountTransactionSigner(unstakeParams.user),
    appID: unstakeParams.appId,
    suggestedParams: suggestedParams
  });

  return stakingGroup;
}

type StakeParams = {
  platformTokenAssetId: number, 
  user: Account, 
  appId: number, 
  suggestedParams: SuggestedParams,
  amount: number | bigint
}

export function stake(stakeParams: StakeParams){
  const stakingGroup = new AtomicTransactionComposer();

  const transferTxn = {
    txn: makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: stakeParams.user.addr,
      suggestedParams: stakeParams.suggestedParams,
      amount: stakeParams.amount,
      to: getApplicationAddress(stakeParams.appId),
      assetIndex: stakeParams.platformTokenAssetId
    }),
    signer: makeBasicAccountTransactionSigner(stakeParams.user)
  };

  stakingGroup.addMethodCall({
    method: getMethodByName("stake", stakingContract),
    methodArgs: [
      transferTxn
    ],
    sender: stakeParams.user.addr,
    signer: makeBasicAccountTransactionSigner(stakeParams.user),
    appID: stakeParams.appId,
    suggestedParams: stakeParams.suggestedParams
  });

  return stakingGroup;
}

type DepositTokenParams = {
  platformTokenAssetId: number, 
  user: Account, 
  appId: number, 
  suggestedParams: SuggestedParams, 
  amount: number,
  account_to_deposit_to?: string
}

export function depositToken(depositParams: DepositTokenParams){
  const depositGroup = new AtomicTransactionComposer();

  let account_to_deposit_to;
  if(depositParams.account_to_deposit_to === undefined){
    account_to_deposit_to = depositParams.user.addr;
  }
  else{
    account_to_deposit_to = depositParams.account_to_deposit_to;
  }

  const transferTxn = {
    txn: makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: depositParams.user.addr,
      suggestedParams: depositParams.suggestedParams,
      amount: depositParams.amount,
      to: getApplicationAddress(depositParams.appId),
      assetIndex: depositParams.platformTokenAssetId
    }),
    signer: makeBasicAccountTransactionSigner(depositParams.user)
  };

  depositGroup.addMethodCall({
    method: getMethodByName("deposit_token", stakingContract),
    methodArgs: [
      transferTxn,
      depositParams.platformTokenAssetId,
      account_to_deposit_to
    ],
    sender: depositParams.user.addr,
    signer: makeBasicAccountTransactionSigner(depositParams.user),
    appID: depositParams.appId,
    suggestedParams: depositParams.suggestedParams
  });

  return depositGroup;
}

type DepositAlgoParams = {
  user: Account, 
  appId: number, 
  suggestedParams: SuggestedParams, 
  amount: number,
  account_to_deposit_to?: string
}

export function depositAlgo(depositAlgoParams: DepositAlgoParams){
  const depositGroup = new AtomicTransactionComposer();

  let account_to_deposit_to;
  if(depositAlgoParams.account_to_deposit_to === undefined){
    account_to_deposit_to = depositAlgoParams.user.addr;
  }
  else{
    account_to_deposit_to = depositAlgoParams.account_to_deposit_to;
  }

  const transferTxn = {
    txn: makePaymentTxnWithSuggestedParamsFromObject({
      from: depositAlgoParams.user.addr,
      suggestedParams: depositAlgoParams.suggestedParams,
      amount: depositAlgoParams.amount,
      to: getApplicationAddress(depositAlgoParams.appId),
    }),
    signer: makeBasicAccountTransactionSigner(depositAlgoParams.user)
  };

  depositGroup.addMethodCall({
    method: getMethodByName("deposit_algo", stakingContract),
    methodArgs: [
      transferTxn,
      account_to_deposit_to,
    ],
    sender: depositAlgoParams.user.addr,
    signer: makeBasicAccountTransactionSigner(depositAlgoParams.user),
    appID: depositAlgoParams.appId,
    suggestedParams: depositAlgoParams.suggestedParams
  });

  return depositGroup;
}

type WithdrawParams = {
  platformTokenAssetId: number, 
  user: Account, 
  appId: number, 
  suggestedParams: SuggestedParams, 
  amount: number
}

export function withdrawToken(withdrawParams: WithdrawParams){
  const withdrawGroup = new AtomicTransactionComposer();
  const suggestedParams = {
    ...withdrawParams.suggestedParams,
    flatFee: true,
    fee: 2000
  };

  withdrawGroup.addMethodCall({
    method: getMethodByName("withdraw_token", stakingContract),
    methodArgs: [
      withdrawParams.amount,
      withdrawParams.platformTokenAssetId
    ],
    sender: withdrawParams.user.addr,
    signer: makeBasicAccountTransactionSigner(withdrawParams.user),
    appID: withdrawParams.appId,
    suggestedParams: suggestedParams
  });

  return withdrawGroup;
}

type WithdrawAlgoParams = {
  user: Account, 
  appId: number, 
  suggestedParams: SuggestedParams, 
  amount: number
}

export function withdrawAlgo(withdrawParams: WithdrawAlgoParams){
  const withdrawGroup = new AtomicTransactionComposer();
  const suggestedParams = {
    ...withdrawParams.suggestedParams,
    flatFee: true,
    fee: 2000
  };
  withdrawGroup.addMethodCall({
    method: getMethodByName("withdraw_algo", stakingContract),
    methodArgs: [
      withdrawParams.amount
    ],
    sender: withdrawParams.user.addr,
    signer: makeBasicAccountTransactionSigner(withdrawParams.user),
    appID: withdrawParams.appId,
    suggestedParams: suggestedParams
  });

  return withdrawGroup;
}

type RegisterKeyParams = {
  user: Account,
  appId: number,
  publicKey: string,
  suggestedParams: SuggestedParams
}

export function registerKey(registerKeyParams: RegisterKeyParams){
  const registerKeyGroup = new AtomicTransactionComposer();

  registerKeyGroup.addMethodCall({
    method: getMethodByName("register_participation_account", stakingContract),
    methodArgs: [
      decodeAddress(registerKeyParams.publicKey).publicKey
    ],
    sender: registerKeyParams.user.addr,
    signer: makeBasicAccountTransactionSigner(registerKeyParams.user),
    appID: registerKeyParams.appId,
    suggestedParams: registerKeyParams.suggestedParams
  });

  return registerKeyGroup;
}

type UnRegisterKeyParams = {
  user: Account,
  appId: number,
  suggestedParams: SuggestedParams
}

export function unRegisterKey(registerKeyParams: UnRegisterKeyParams){
  const unRegisterKeyGroup = new AtomicTransactionComposer();

  unRegisterKeyGroup.addMethodCall({
    method: getMethodByName("unregister_participation_account", stakingContract),
    methodArgs: [
    ],
    sender: registerKeyParams.user.addr,
    signer: makeBasicAccountTransactionSigner(registerKeyParams.user),
    appID: registerKeyParams.appId,
    suggestedParams: registerKeyParams.suggestedParams
  });

  return unRegisterKeyGroup;
}

type ClaimRewardsParams = {
  primaryAccount: Account,
  rewardsAddress: string,
  appId: number,
  votingAppId: number,
  suggestedParams: SuggestedParams,
  client: Algodv2
}

export async function claimRewards(params: ClaimRewardsParams){
  const primaryAccountPK = decodeAddress(params.rewardsAddress).publicKey;
  const globalStateVote = await getGlobalStateVote(params.votingAppId,params.client);
  const previousVote = globalStateVote.previous_vote[params.rewardsAddress];
  const previousVoteRequester = previousVote.proposal.requester;
  const previousVoteBox = await params.client.getApplicationBoxByName(params.votingAppId,primaryAccountPK).do();
  const keyHash = new Uint8Array(Buffer.from(previousVote.key_hash,"base64"));
  
  const claimRewardsGroup = new AtomicTransactionComposer();

  claimRewardsGroup.addMethodCall({
    method: getMethodByName("claim_rewards", stakingContract),
    methodArgs: [
      params.rewardsAddress,
      previousVoteBox.value,
      previousVoteRequester,
      params.votingAppId
    ],
    boxes:[
      {
        appIndex:params.appId,
        name:keyHash
      }
    ],
    sender: params.primaryAccount.addr,
    signer: makeBasicAccountTransactionSigner(params.primaryAccount),
    appID: params.appId,
    suggestedParams: params.suggestedParams
  });

  claimRewardsGroup.addMethodCall({
    method: getMethodByName("reset_previous_vote",votingContract),
    methodArgs: [
      params.primaryAccount.addr,
      params.rewardsAddress,
      params.appId
    ],
    boxes:[
      {
        appIndex:params.votingAppId,
        name:decodeAddress(params.rewardsAddress).publicKey
      }
    ],
    sender: params.primaryAccount.addr,
    signer: makeBasicAccountTransactionSigner(params.primaryAccount),
    appID: params.votingAppId,
    suggestedParams: params.suggestedParams
  });
  return claimRewardsGroup;
}