import path from "path";
import {
  Account,
  Algodv2,
  getApplicationAddress,
  LogicSigAccount,
  SuggestedParams,
} from "algosdk";

import {
  deployMainContract
} from "../../assets/transactions/main_transactions";

import {
  deployGora
} from "../../assets/transactions/misc_transactions";

import {
  optIn,
  sendASA,
  compilePyTeal,
} from "algoutils";

import {
  fundAccount,
} from "algotest";

import {
  getABIHash
} from "../../utils/gora_utils";

import { AccountGenerator } from "./vote/voting.helpers";
import { getSandboxAccount } from "../util/utils";

export type testParams = {
  appId: number;
  alt_user: Account;
  algodClient: Algodv2;
  platformTokenAssetId: number;
  mainAccount: Account;
  user: Account;
  suggestedParams: SuggestedParams;
  voteVerifyLsig: LogicSigAccount
}

const cache: {[key: string]: Uint8Array} = {};

export async function commonTestSetup(accountGenerator:AccountGenerator) : Promise<testParams> {
  // TODO: parameterize the timeouts
  const registerKeyTimeLock = 10;
  const sandboxAccount = await getSandboxAccount();
  const mainAccount = accountGenerator.generateAccount();
  await fundAccount(mainAccount.addr,1e12);
  const algodClient = new Algodv2(process.env.ALGOD_TOKEN!, process.env.ALGOD_SERVER!, process.env.ALGOD_PORT);

  const platformTokenAssetId = await deployGora(mainAccount);

  if (!cache["voteVerifyLsig"]) {
    cache["voteVerifyLsig"] = await compilePyTeal(path.join(__dirname, "../../assets/vote_verify_lsig.py"));
  }
  const program = cache["voteVerifyLsig"];

  const voteVerifyLsig = new LogicSigAccount(program);

  const abiHash = getABIHash("../assets/abi/main-contract.json");
  const votingContractParams = {
    CONTRACT_VERSION: abiHash,
    VOTE_VERIFY_LSIG_ADDRESS: voteVerifyLsig.address(),
    DEV_MODE: 1
  };
  if (!cache["votingApproval"]) {
    cache["votingApproval"] = await compilePyTeal(path.join(__dirname, "../../assets/voting_approval.py"), votingContractParams);
  }
  if (!cache["votingClear"]) {
    cache["votingClear"] = await compilePyTeal(path.join(__dirname, "../../assets/voting_clear.py"));
  }
  const votingApprovalCode = cache["votingApproval"];
  const votingClearCode = cache["votingClear"];

  const appId = await deployMainContract({
    platformTokenAssetId: platformTokenAssetId,
    deployer: mainAccount,
    voteApprovalProgram: votingApprovalCode,
    voteClearProgram: votingClearCode,
    minimumStake: 500
  });

  const user = accountGenerator.generateAccount();
  const suggestedParams = await algodClient.getTransactionParams().do();

  await fundAccount(user.addr, 1e6);
  await optIn(platformTokenAssetId, user);
  await optIn(platformTokenAssetId, sandboxAccount);
  await sendASA({
    from: mainAccount,
    to: user.addr,
    assetId: platformTokenAssetId,
    amount: 50_000_000_000_000
  });
  await fundAccount(getApplicationAddress(appId), 100_000); // for the minimum balance requirement

  const alt_user = accountGenerator.generateAccount();

  await fundAccount(alt_user.addr, 1e6);
  await optIn(platformTokenAssetId, alt_user);
  await sendASA({
    from: mainAccount,
    to: alt_user.addr,
    assetId: platformTokenAssetId,
    amount: 50_000_000_000_000
  });

  return {
    appId,
    alt_user,
    algodClient,
    platformTokenAssetId,
    mainAccount,
    user,
    suggestedParams,
    voteVerifyLsig
  };
}