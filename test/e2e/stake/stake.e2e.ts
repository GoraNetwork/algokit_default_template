import {
  Algodv2,
  Account,
  decodeAddress,
  SuggestedParams,
  modelsv2,
} from "algosdk";
import {
  fundAccount
} from "algotest";
import {
  registerKey,
  unRegisterKey,
  stake
} from "../../../assets/transactions/staking_transactions";
import {
  init,
  userOptIn
} from "../../../assets/transactions/main_transactions";
import {
  commonTestSetup
} from "../main_common";
import { AccountGenerator } from "../vote/voting.helpers";

import accounts from "../../test_fixtures/accounts.json";

async function sleep_rounds(rounds:number, addr:string){
  for(let i = 0; i < rounds; i++)
  {
    await fundAccount(addr,i);
  }
}

describe("Staking e2e", () => {
  let appId: number;
  let algodClient: Algodv2;
  let platformTokenAssetId: number;
  let user: Account;
  let suggestedParams: SuggestedParams;
  let accountGenerator: AccountGenerator;

  async function register_key(user: Account, appId: number, publicKey: string, suggestedParams: SuggestedParams)
  {
    const registerKeyGroup = registerKey({
      user: user,
      appId: appId,
      publicKey: user.addr,
      suggestedParams: suggestedParams
    });

    await registerKeyGroup.execute(algodClient, 5);
  }
   
  beforeEach(async () => {
    accountGenerator = new AccountGenerator(accounts);

    const testParameters = await commonTestSetup(accountGenerator);
    appId = testParameters.appId;
    algodClient = testParameters.algodClient;
    platformTokenAssetId = testParameters.platformTokenAssetId;
    user = testParameters.user;
    suggestedParams = testParameters.suggestedParams;

    const initGroup = init({
      platformTokenAssetId: platformTokenAssetId,
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams,
      manager: user.addr
    });

    await initGroup.execute(algodClient, 5);

    const optInGroup = userOptIn({
      user, 
      appId, 
      suggestedParams
    });
    await optInGroup.execute(algodClient, 5);

    const stakingGroup = stake({
      platformTokenAssetId: platformTokenAssetId, 
      user: user, 
      appId: appId, 
      suggestedParams: suggestedParams, 
      amount: 500_000_000
    });
    await stakingGroup.execute(algodClient, 5);
    await sleep_rounds(11, user.addr);
  });

  it("should allow a user to register a key", async () => {
    await register_key(user, appId, user.addr, suggestedParams);
    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const storedPublicKeyString = new Uint8Array(Buffer.from(accountAppInfo["app-local-state"]["key-value"].filter((x: modelsv2.TealKeyValue) => x.key === "cGs=")[0].value.bytes, "base64"));
    const userPk = decodeAddress(user.addr).publicKey;
    expect(storedPublicKeyString).toEqual(userPk);
  });

  it("should allow a user to unregister a key", async () => {
    await register_key(user, appId, user.addr, suggestedParams);
    const group = unRegisterKey({
      user,
      appId: appId,
      suggestedParams
    });
    await group.execute(algodClient, 5);

    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const storedPublicKeyString = new Uint8Array(Buffer.from(accountAppInfo["app-local-state"]["key-value"].filter((x: modelsv2.TealKeyValue) => x.key === "cGs=")[0].value.bytes, "base64"));
    const expected = new Uint8Array(32).fill(0);
    expect(storedPublicKeyString).toEqual(expected);
  });

  it("should fail when overwriting key too soon", async () => {
    const registerKeyGroup = registerKey({
      user: user,
      appId: appId,
      publicKey: user.addr,
      suggestedParams: suggestedParams
    });
  
    await registerKeyGroup.execute(algodClient, 5);
    const accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    const storedPublicKeyString = new Uint8Array(Buffer.from(accountAppInfo["app-local-state"]["key-value"].filter((x: modelsv2.TealKeyValue) => x.key === "cGs=")[0].value.bytes, "base64"));
    const userPk = decodeAddress(user.addr).publicKey;
    expect(storedPublicKeyString).toEqual(userPk);
    const new_account = accountGenerator.generateAccount().addr;

    const newRegisterKeyGroup = registerKey({
      user: user,
      appId: appId,
      publicKey: new_account,
      suggestedParams: suggestedParams
    });

    await expect( newRegisterKeyGroup.execute(algodClient, 5)).rejects.toThrow();
  });

  
  it("should allow a staker to overwrite a registered key after specified time lock", async () => {
    const registerKeyGroup = registerKey({
      user: user,
      appId: appId,
      publicKey: user.addr,
      suggestedParams: suggestedParams
    });

    await registerKeyGroup.execute(algodClient, 5);

    let accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    let storedPublicKeyString = new Uint8Array(Buffer.from(accountAppInfo["app-local-state"]["key-value"].filter((x: modelsv2.TealKeyValue) => x.key === "cGs=")[0].value.bytes, "base64"));
    let userPk = decodeAddress(user.addr).publicKey;

    expect(storedPublicKeyString).toEqual(userPk);

    const new_account = accountGenerator.generateAccount().addr;

    await sleep_rounds(11, user.addr);

    await fundAccount(user.addr,1e6); // extra transaction to force new block in dev mode to get more recent timestamp.

    const newRegisterKeyGroup = registerKey({
      user: user,
      appId: appId,
      publicKey: new_account,
      suggestedParams: suggestedParams
    });
    await newRegisterKeyGroup.execute(algodClient, 5);

    accountAppInfo = await algodClient.accountApplicationInformation(user.addr, appId).do();
    storedPublicKeyString = new Uint8Array(Buffer.from(accountAppInfo["app-local-state"]["key-value"].filter((x: modelsv2.TealKeyValue) => x.key === "cGs=")[0].value.bytes, "base64"));
    userPk = decodeAddress(new_account).publicKey;
    expect(storedPublicKeyString).toEqual(userPk);
  });
});