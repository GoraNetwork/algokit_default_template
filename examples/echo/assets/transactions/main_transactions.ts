import path from "path";
import {
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  makeApplicationCreateTxnFromObject,
  OnApplicationComplete,
  SuggestedParams,
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
} from "../../../../utils/gora_utils";

const ABI_PATH = "../../assets/abi/main-contract.json";
const mainContract = loadABIContract(path.join(__dirname, ABI_PATH));

type DeployParams = {
  deployer: Account
}

export async function deployMainContract(deployParams: DeployParams){
  const abiHash = getABIHash("../assets/abi/main-contract.json");
  const stakingContractParams = {
    CONTRACT_VERSION: abiHash
  };

  const stakingApprovalCode = await compilePyTeal(path.join(__dirname, "../../assets/main_approval.py"), stakingContractParams);
  const stakingClearCode = await compilePyTeal(path.join(__dirname, "../../assets/main_clear.py"));

  const storageSchema = {
    numGlobalByteSlices: 1,
    numGlobalInts: 5,
    numLocalByteSlices: 1,
    numLocalInts: 5
  };
  const transactionParams = await algodClient().getTransactionParams().do();
  const createApplicationTransaction = makeApplicationCreateTxnFromObject({
    suggestedParams: transactionParams,
    from: deployParams.deployer.addr,
    onComplete: OnApplicationComplete.NoOpOC,
    approvalProgram: stakingApprovalCode,
    clearProgram: stakingClearCode,
    extraPages: 3,
    ...storageSchema
  });

  const signedCreateTxn = createApplicationTransaction.signTxn(deployParams.deployer.sk);

  const txnResponse = await sendTxn(algodClient(), signedCreateTxn);

  const appId = txnResponse["application-index"];

  return appId;
}