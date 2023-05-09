import path from "path";
import {
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  makeApplicationOptInTxnFromObject,
  SuggestedParams,
  decodeAddress
} from "algosdk";
import {
  getABIHash
} from "../../../../utils/gora_utils";
import {
  ResponseBodyType
} from "../../../../utils/abi_types";
import {
  compilePyTeal,
  deployContract,
  getMethodByName,
  loadABIContract,
} from "algoutils";


type DeployParams = {
  deployer: Account,
}

export async function deployVoteContract(deployParams: DeployParams){
  const abiHash = getABIHash("../examples/mock_vote/assets/abi/voting-passthrough-contract.json");
  const votingContractParams = {
    CONTRACT_VERSION: abiHash
  };
  const votingApprovalCode = await compilePyTeal(path.join(__dirname, "../voting_passthrough_mock.py"), votingContractParams);
  const votingClearCode = await compilePyTeal(path.join(__dirname, "../voting_clear.py"));

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

type OptinParams = {
  user: Account, 
  appId: number, 
  suggestedParams: SuggestedParams
}

const votingContract = loadABIContract(path.join(__dirname, "../abi/voting-passthrough-contract.json"));

export function vote_optin(params: OptinParams)
{
  const optInGroup = new AtomicTransactionComposer();
  const optInTxn = makeApplicationOptInTxnFromObject({
    from: params.user.addr,
    suggestedParams: params.suggestedParams,
    appIndex: params.appId
  });
  optInGroup.addTransaction({
    txn: optInTxn,
    signer: makeBasicAccountTransactionSigner(params.user)
  });

  return optInGroup;
}

type VotingParams = {
  user: Account,
  votingAppId: number,
  suggestedParams: SuggestedParams
  destinationAppId: number,
  destinationMethod: Uint8Array,
  requesterAddress: string,
  request_id: string,
  return_value: string,
  user_data: string,
  error_code: number,
  bit_field: number,
}

export function vote(params: VotingParams){
  const voteGroup = new AtomicTransactionComposer();

  // need to shrink valid round window to allow for accessing some block seeds in the past
  params.suggestedParams.lastRound = params.suggestedParams.lastRound - 100;

  const response_type = 1;
  const response_body = ResponseBodyType.encode([
    Buffer.from(params.request_id),
    params.user.addr,
    Buffer.from(params.return_value),
    Buffer.from(params.user_data),
    params.error_code,
    params.bit_field
  ]);

  voteGroup.addMethodCall({
    method: getMethodByName("vote", votingContract),
    methodArgs: [
      params.destinationAppId,
      Buffer.from(params.destinationMethod),
      decodeAddress(params.requesterAddress).publicKey,
      response_type,
      response_body
    ],
    appID: params.votingAppId,
    suggestedParams: params.suggestedParams,
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user)
  });
  return voteGroup;
}