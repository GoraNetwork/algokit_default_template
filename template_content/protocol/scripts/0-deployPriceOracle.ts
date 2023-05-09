import { readFileSync } from "fs";
import path from "path";
import { Deployer, RuntimeEnv } from "@algo-builder/algob/build/types";

export default async function run (runtimeEnv: RuntimeEnv, deployer: Deployer) {
  const mainAccount = deployer.accountsByName.get("main");

  const contractAccounts = [];

  for (let i = 0; i < 5; i++) {
    const contractAccount = deployer.accountsByName.get(`contracts${i+1}`);
    if (!contractAccount) {
      throw new Error(`Contract account ${i} must exist`);
    }
    contractAccounts.push(contractAccount);
  }

  const approvalProgram = "price_oracle_approval.py";
  const clearProgram = "oracle_clear.py";

  if (!mainAccount?.addr) {
    throw new Error("Main account must exist");
  }

  const oracleAppParams = {
    PLATFORM_ADDRESS: mainAccount?.addr,
    WHITELIST_APP: BigInt(53291468),
  };

  const priceListData = readFileSync(path.resolve(__dirname, "../../scripts/priceList.json"));
  const priceList = JSON.parse(priceListData.toString());

  const pricePairs: {[key: string]: number} = {};

  for (const [i, pricePair] of priceList.entries()) {
    const contractAccount = contractAccounts[Math.floor(i / 10)];

    const appInfo = await deployer.deployApp(
      approvalProgram,
      clearProgram,
      {
        sender: contractAccount,
        localBytes: 0,
        localInts: 0,
        globalBytes: 0,
        globalInts: 2
      },
      {
        flatFee: true,
        totalFee: 1000
      },
      oracleAppParams,
      `price-${i}`
    );

    pricePairs[pricePair] = appInfo.appID;
  }
}