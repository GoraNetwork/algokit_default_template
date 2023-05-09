import path from "path";
import {
  Algodv2,
  Account,
  SuggestedParams,
  getApplicationAddress,
} from "algosdk";
import {
  DestinationType,
  RequestArgsType,
} from "../../../utils/abi_types";

import { commonTestSetup } from "../../../test/e2e/main_common";
import { loadABIContract } from "algoutils";
import { AccountGenerator } from "../../../test/e2e/vote/voting.helpers";
import  accounts from "../../../test/test_fixtures/accounts.json";
import { depositAlgo, depositToken } from "../../../assets/transactions/staking_transactions";
import { init, userOptIn } from "../../../assets/transactions/main_transactions";
import { fundAccount } from "algotest";
import { request } from "../../../assets/transactions/request_transactions";
import { deployConsumerContract } from "../../../test/test_fixtures/consumer_transactions";

const ABI_PATH = "../../../test/test_fixtures/consumer-contract.json";
const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));

describe("Example Dapp Test", () => {
  let mainAppId: number;
  let algodClient: Algodv2;
  let mainAccount: Account;
  let user: Account;
  let staker: Account;
  let suggestedParams: SuggestedParams;
  let accountGenerator: AccountGenerator;
  let destinationAppId: number;

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);
    const testParameters = await commonTestSetup(accountGenerator);

    algodClient = testParameters.algodClient;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;
    mainAccount = testParameters.mainAccount;

    destinationAppId = await deployConsumerContract({
      deployer: mainAccount
    });

    staker = accountGenerator.generateAccount();

    mainAppId = testParameters.appId;
    const optInRequesterGroup = userOptIn({ user: mainAccount, appId: mainAppId, suggestedParams: suggestedParams });
    await optInRequesterGroup.execute(algodClient, 5);
    const optInUserGroup = userOptIn({ user: user, appId: mainAppId, suggestedParams: suggestedParams });
    await optInUserGroup.execute(algodClient, 5);

    // fund main contract
    await fundAccount(getApplicationAddress(mainAppId), 2955000);

    //initialize main contract
    const initGroup = init({
      platformTokenAssetId: testParameters.platformTokenAssetId,
      user: mainAccount,
      appId: mainAppId,
      suggestedParams,
      manager: user.addr
    });

    await initGroup.execute(algodClient, 5);

    const depositAlgoGroup = depositAlgo({
      user: mainAccount,
      appId: mainAppId,
      suggestedParams: suggestedParams,
      amount: 100_000
    });
  
    await depositAlgoGroup.execute(algodClient, 5);
    
    const depositTokenGroup = depositToken({
      platformTokenAssetId: testParameters.platformTokenAssetId,
      user: mainAccount,
      appId: mainAppId,
      suggestedParams: suggestedParams,
      amount: 40_000_000_000
    });
  
    await depositTokenGroup.execute(algodClient, 5);
  });

  it("should make request", async () => {
    //TODO: not sure what this test is for since it's already done in the normal tests?
    const app_id = 1234;
    //Note that the first argument in create_request_args must be an array of the source args array created in the line above
    //This example only uses a single source, but typically aggregation methods will take many sources.
    const suggestedParams = await algodClient.getTransactionParams().do();
    const url = new Uint8Array(Buffer.from("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1"));
    const jsonPath = new Uint8Array(Buffer.from("market_cap"));
    //Note that the first argument in create_request_args must be an array of the source args array created in the line above
    //This example only uses a single source, but typically aggregation methods will take many sources.
    const userdata = new Uint8Array(Buffer.from("Hello world"));
    const source_id = 0;
  
    const requestArgs = RequestArgsType.encode([[[source_id, [url, jsonPath], 60]], 0, userdata]);
    const destMethod = consumerContract.methods[0].getSelector();
    const destination = DestinationType.encode([destinationAppId, destMethod]);
  
    const request_group = request({
      user: mainAccount,
      appID: mainAppId,
      suggestedParams: suggestedParams,
      request_args: requestArgs,
      destination: destination,
      type: 0,
      key: Buffer.from("foo"),
      appRefs: [],
      assetRefs: [],
      accountRefs: [],
      boxRefs: []
    });
    const result = await request_group.execute(algodClient, 5);
  });
});