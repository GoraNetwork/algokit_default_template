import { Deployer, RuntimeEnv } from "@algo-builder/algob/build/types";
import {
  TransactionType,
  AppCallsParam,
  SignType
} from "@algo-builder/web/build/types";
import {
  executeTransaction
} from "@algo-builder/algob";

export default async function run (runtimeEnv: RuntimeEnv, deployer: Deployer) {
  const mainAccount = deployer.accountsByName.get("main");

  const whitelistApprovalProgram = "whitelist_approval.py";
  const whitelistClearProgram = "whitelist_clear.py";

  const whitelistAppInfo = deployer.getApp(whitelistApprovalProgram, whitelistClearProgram);

  if (!mainAccount) {
    throw new Error("Main account must exist");
  }

  if (!whitelistAppInfo) {
    throw new Error("Whitelist app must exist");
  }

  const optInParams: AppCallsParam = {
    type: TransactionType.OptInToApp,
    fromAccount: mainAccount,
    appID: whitelistAppInfo?.appID,
    sign: SignType.SecretKey,
    payFlags: {}
  };

  const callAppParams: AppCallsParam = {
    type: TransactionType.CallApp,
    fromAccount: mainAccount,
    appID: whitelistAppInfo?.appID,
    payFlags: {},
    sign: SignType.SecretKey
  };

  await executeTransaction(deployer, [optInParams, callAppParams]);
}