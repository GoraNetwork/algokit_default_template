import { Deployer, RuntimeEnv } from "@algo-builder/algob/build/types";
import {
  TransactionType,
  AppCallsParam,
  SignType
} from "@algo-builder/web/build/types";
import {
  executeTransaction
} from "@algo-builder/algob";
import {
  encodeUint64
} from "algosdk";

const PRICE = 4000000;
const DECIMALS = 3;

export default async function run (runtimeEnv: RuntimeEnv, deployer: Deployer) {
  const mainAccount = deployer.accountsByName.get("main");

  const approvalProgram = "price_oracle_approval.py";
  const clearProgram = "oracle_clear.py";

  const whitelistApprovalProgram = "whitelist_approval.py";
  const whitelistClearProgram = "whitelist_clear.py";

  const oracleAppInfo = deployer.getApp(approvalProgram, clearProgram);
  const whitelistAppInfo = deployer.getApp(whitelistApprovalProgram, whitelistClearProgram);

  if (!mainAccount) {
    throw new Error("Main account must exist");
  }

  if (!oracleAppInfo) {
    throw new Error("Oracle app must exist");
  }

  if (!whitelistAppInfo) {
    throw new Error("Whitelist app must exist");
  }

  const callAppParams: AppCallsParam = {
    type: TransactionType.CallApp,
    fromAccount: mainAccount,
    appID: oracleAppInfo?.appID,
    payFlags: {},
    sign: SignType.SecretKey,
    appArgs: [encodeUint64(PRICE), encodeUint64(DECIMALS)],
    foreignApps: [whitelistAppInfo?.appID]
  };

  await executeTransaction(deployer, callAppParams);
}