import { Deployer, RuntimeEnv } from "@algo-builder/algob/build/types";

export default async function run (runtimeEnv: RuntimeEnv, deployer: Deployer) {
  const mainAccount = deployer.accountsByName.get("main");

  const approvalProgram = "indexer_approval.py";
  const clearProgram = "indexer_clear.py";

  if (!mainAccount) {
    throw new Error("Main account must exist");
  }

  const indexerAppParams = {
    ADMIN_ADDRESS: mainAccount?.addr,
  };

  const appInfo = await deployer.deployApp(
    approvalProgram,
    clearProgram,
    {
      sender: mainAccount,
      localBytes: 0,
      localInts: 0,
      globalBytes: 0,
      globalInts: 64
    },
    {
      flatFee: true,
      totalFee: 1000
    },
    indexerAppParams
  );

  console.log(`Deployed index at ${appInfo.appID}`);
}