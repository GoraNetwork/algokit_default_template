import {
  fundAccount
} from "algotest";

import {
  makeInnerRequest,
  opt_into_gora,
  deployContract,
  setChild
} from "../test_fixtures/inner_test_transactions";

import {
  AccountGenerator,
} from "./vote/voting.helpers";

import { commonTestSetup } from "./main_common";
import { Account, Algodv2, getApplicationAddress, SuggestedParams } from "algosdk";
import { depositAlgo, depositToken } from "../../assets/transactions/staking_transactions";
import { init } from "../../assets/transactions/main_transactions";
import { DestinationType, RequestArgsType, } from "../../utils/abi_types";
import accounts from "../test_fixtures/accounts.json";

const MAX_POSSIBLE_DEPTH = 6;
describe("inner_tests e2e", () => {
  let mainAppId: number;
  let innerTestId: number;
  let algodClient: Algodv2;
  let platformTokenAssetId: number;
  let mainAccount: Account;
  let user: Account;
  let suggestedParams: SuggestedParams;
  const app_IDs: any = [];
  let accountGenerator: AccountGenerator;

  async function setupApp(app_id: number)
  {
    await fundAccount(getApplicationAddress(app_id), 1e6);
    
    let group = await opt_into_gora(
      {
        user: mainAccount,
        suggestedParams: suggestedParams,
        application_id: app_id,
        main_app_id: mainAppId,
        asset_id: platformTokenAssetId
      }
    );
    const results = await group.execute(algodClient, 5);

    //need to deposit some funds into goracle main contract to cover requests
    //you're able to deposit funds into an account that is not yours, here we are depositing funds into the example dapps account
    //since it is the account that will be making the request.
    group = depositAlgo({
      user: mainAccount, 
      appId: mainAppId, 
      suggestedParams: suggestedParams, 
      amount: 800_000,
      account_to_deposit_to: getApplicationAddress(app_id)
    });
    await group.execute(algodClient, 5);

    group = depositToken(
      {
        platformTokenAssetId: platformTokenAssetId, 
        user: mainAccount, 
        appId: mainAppId, 
        suggestedParams: suggestedParams, 
        amount: 50_000_000_000,
        account_to_deposit_to: getApplicationAddress(app_id)
      }
    );
    await group.execute(algodClient, 5);
  }

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);

    const testParameters = await commonTestSetup(accountGenerator);
    mainAppId = testParameters.appId;
    algodClient = testParameters.algodClient;
    platformTokenAssetId = testParameters.platformTokenAssetId;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;
    mainAccount = testParameters.mainAccount;

    let group = init({
      platformTokenAssetId: platformTokenAssetId,
      user: user, 
      appId: mainAppId, 
      suggestedParams: suggestedParams,
      manager: mainAccount.addr
    });
    await group.execute(algodClient, 5);

    innerTestId = await deployContract(
      {
        deployer: mainAccount,
        mainAppID: mainAppId
      }
    );
    app_IDs.push(innerTestId);
    await fundAccount(getApplicationAddress(innerTestId), 700_000);
    await setupApp(innerTestId);
    
    let current_parent = innerTestId;
    for(let i = 0; i < MAX_POSSIBLE_DEPTH; i++)
    {
      let child_id = await deployContract(
        {
          deployer: mainAccount,
          mainAppID: mainAppId
        }
      );
      app_IDs.push(child_id);
      await fundAccount(getApplicationAddress(child_id), 700_000);
      await setupApp(child_id);
      group = await setChild(
        {
          user: mainAccount,
          suggestedParams: suggestedParams,
          application_id: current_parent,
          child_id: child_id
        }
      );
      await group.execute(algodClient, 5);
      current_parent = child_id;
      child_id = undefined;
    }

  });

  it("should send nested request", async () => {
    const fake_dest_method = Buffer.from("foobar");
    const fake_destination_id = 123456;

    const url = new Uint8Array(Buffer.from("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1"));
    const jsonPath = new Uint8Array(Buffer.from("market_cap"));
    //Note that the first argument in create_request_args must be an array of the source args array created in the line above
    //This example only uses a single source, but typically aggregation methods will take many sources.
    const userdata = new Uint8Array(Buffer.from("Hello world"));
    const source_id = 0;
    const requestArgs = RequestArgsType.encode([ [[source_id, [url, jsonPath], 60]], 0, userdata]);
    const destination = DestinationType.encode([fake_destination_id, fake_dest_method]);

    const group = await makeInnerRequest(
      {
        user: mainAccount,
        suggestedParams: suggestedParams,
        app_ids: app_IDs,
        depth: 5, // this depth number doesn't include the parent app that the call orignates on and the main app (3 is MAX, 0 is MIN)
        requestArgs: requestArgs,
        destination: destination,
        type: 1,
        goracleMain: mainAppId,
        expectedRequestSender: app_IDs[5]
      }
    );
    const result = await group.execute(algodClient, 5);
  });
});

/*
depth = 3
parent_app
child,
child,
child,
main
*/

/*
depth = 2
parent_app
child,
child,
main
*/

/*
depth = 1
parent_app
child,
main
*/

/*
depth = 0
parent_app
main
*/