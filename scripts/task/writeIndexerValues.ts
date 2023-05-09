import { readFileSync } from "fs";
import path from "path";
import { Deployer, RuntimeEnv } from "@algo-builder/algob/build/types";
import {
  TransactionType,
  AppCallsParam,
  SignType
} from "@algo-builder/web/build/types";
import {
  encodeUint64
} from "algosdk";
import { executeTransaction } from "@algo-builder/algob";

export default async function run (runtimeEnv: RuntimeEnv, deployer: Deployer) {
  const mainAccount = deployer.accountsByName.get("main");

  const approvalProgram = "indexer_approval.py";
  const clearProgram = "indexer_clear.py";

  const indexerAppInfo = deployer.getApp(approvalProgram, clearProgram);

  const pricePairFile = readFileSync(path.resolve(__dirname, `../../scripts/pricePairs-${runtimeEnv.network.name}.json`));
  const pricePairs = JSON.parse(pricePairFile.toString());

  if (!mainAccount) {
    throw new Error("Main account must exist");
  }

  if (!indexerAppInfo) {
    throw new Error("Indexer app must exist");
  }

  for (const [priceKey, pricePair] of Object.entries<number>(pricePairs)) {
    const callAppParams: AppCallsParam = {
      type: TransactionType.CallApp,
      fromAccount: mainAccount,
      appID: indexerAppInfo?.appID,
      appArgs: [`str:${priceKey}`, encodeUint64(pricePair)],
      sign: SignType.SecretKey,
      payFlags: {
        flatFee: true,
        totalFee: 1000
      }
    };

    await executeTransaction(deployer, callAppParams);
  }
}