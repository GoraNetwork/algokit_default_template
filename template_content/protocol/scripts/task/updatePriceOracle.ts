import { Deployer, RuntimeEnv } from "@algo-builder/algob/build/types";

export default async function run (runtimeEnv: RuntimeEnv, deployer: Deployer) {
  const mainAccount = deployer.accountsByName.get("main");

  const approvalProgram = "price_oracle_approval.py";
  const clearProgram = "oracle_clear.py";

  if (!mainAccount) {
    throw new Error("Main account must exist");
  }

  const oracleAppInfo = deployer.getApp(approvalProgram, clearProgram);

  if (!oracleAppInfo) {
    throw new Error("Oracle app must exist");
  }

  await deployer.updateApp(
    mainAccount,
    {},
    oracleAppInfo?.appID,
    "updated_oracle.teal",
    "updated_clear.teal",
    {}
  );
}