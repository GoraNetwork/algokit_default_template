import path from "path";
import {
  Algodv2,
  Account,
  SuggestedParams,
  getApplicationAddress,
} from "algosdk";
import {
  loadABIContract,
} from "algoutils";
import {
  fundAccount
} from "algotest";
import {
  deployConsumerContract
} from "../../../test/test_fixtures/consumer_transactions";
import {
  vote,
  deployVoteContract
} from "../assets/transactions/vote_passthrough_transactions";

import { commonTestSetup } from "../../../test/e2e/main_common";
import { AccountGenerator } from "../../../test/e2e/vote/voting.helpers";
import  accounts from "../../../test/test_fixtures/accounts.json";

const ABI_PATH = "../../../test/test_fixtures/consumer-contract.json";
const consumerContract = loadABIContract(path.join(__dirname, ABI_PATH));

describe("Example Dapp Test", () => {
  let voteAppId: number;
  let destinationAppId: number;
  let algodClient: Algodv2;
  let mainAccount: Account;
  let user: Account;
  let staker: Account;
  let suggestedParams: SuggestedParams;
  let accountGenerator: AccountGenerator;

  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);
    const testParameters = await commonTestSetup(accountGenerator);
    
    algodClient = testParameters.algodClient;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;
    mainAccount = testParameters.mainAccount;
    staker = accountGenerator.generateAccount();

    destinationAppId = await deployConsumerContract({
      deployer: mainAccount
    });

    voteAppId = await deployVoteContract(
      {
        deployer: mainAccount,
      }
    );
    await fundAccount(getApplicationAddress(voteAppId), 103000);
  });

  it("should forward response", async () => {
    const vote_group = vote(
      {
        user: mainAccount,
        votingAppId: voteAppId,
        suggestedParams: suggestedParams,
        destinationAppId: destinationAppId,
        destinationMethod: consumerContract.methods[0].getSelector(),
        requesterAddress: user.addr,
        request_id: "00000000000000000000000000000000",
        return_value: "abcd",
        user_data: "this_is_user_id",
        error_code: 0,
        bit_field: 10,
      }
    );

    await vote_group.execute(algodClient, 5);
  });

  it("should fail forward response", async () => {
    const vote_group = vote(
      {
        user: user,
        votingAppId: voteAppId,
        suggestedParams: suggestedParams,
        destinationAppId: destinationAppId,
        destinationMethod: consumerContract.methods[0].getSelector(),
        requesterAddress: user.addr,
        request_id: "00000000000000000000000000000000",
        return_value: "abcd",
        user_data: "this_is_user_id",
        error_code: 0,
        bit_field: 10,
      }
    );

    await expect(vote_group.execute(algodClient, 5)).rejects.toThrowError("assert failed");
  });
});