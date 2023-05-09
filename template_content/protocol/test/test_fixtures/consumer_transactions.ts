import path from "path";
import {
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  SuggestedParams
} from "algosdk";

import {
  getMethodByName,
  loadABIContract,
  compilePyTeal,
  deployContract
} from "algoutils";

const ABI_PATH = "../../test/test_fixtures/consumer-contract.json";
const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));

type DeployParams = {
  deployer: Account
}

export async function deployConsumerContract(deployParams: DeployParams){
  const consumerApprovalCode = await compilePyTeal(path.join(__dirname, "../../test/test_fixtures/consumer_approval.py"));
  const consumerClearCode = await compilePyTeal(path.join(__dirname, "../../test/test_fixtures/consumer_clear.py"));

  const consumerAppId = await deployContract(
    consumerApprovalCode,
    consumerClearCode,
    deployParams.deployer,
    {
      numGlobalByteSlices: 1,
      numGlobalInts: 1,
      numLocalByteSlices: 0,
      numLocalInts: 0
    }
  );
  
  return consumerAppId;
}

type TestEndpointParams = {
  user: Account, 
  appId: number,
  value: number,
  suggestedParams: SuggestedParams
}
                   
export function test_endpoint(params: TestEndpointParams){
  const test_endpointGroup = new AtomicTransactionComposer();
  test_endpointGroup.addMethodCall({
    method: getMethodByName("test_endpoint", consumerContract),
    methodArgs: [
      params.value
    ],
    sender: params.user.addr,
    signer: makeBasicAccountTransactionSigner(params.user),
    appID: params.appId,
    suggestedParams: params.suggestedParams
  });
  
  return test_endpointGroup;
}