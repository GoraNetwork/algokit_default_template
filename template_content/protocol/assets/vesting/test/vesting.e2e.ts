import { ABIUintType, Account, decodeAddress, encodeUint64, generateAccount, makeAssetConfigTxnWithSuggestedParams, makeAssetCreateTxnWithSuggestedParamsFromObject, makeAssetTransferTxnWithSuggestedParamsFromObject, makeBasicAccountTransactionSigner, makePaymentTxnWithSuggestedParamsFromObject, waitForConfirmation } from "algosdk";
import * as bkr from "beaker-ts";

import { SandboxAccount } from "beaker-ts/lib/sandbox/accounts";
import { Vesting } from "../artifacts/vesting_client";
import { sendGenericAsset, sendGenericPayment } from "../../../utils/beaker_test_utils";
import { getAppBoxes, getGlobal, getVestings } from "../vestingUtils";
import { getGlobal as delegatorGetGlobal, getLocal as delegatorGetLocal } from "../../stake_delegator/delegatorUtils";
import {deploy_delegator_with_mock_main } from "../../stake_delegator/delegatorUtils";
import {VestingKey} from "../abi_structures";
import { sha512_256 } from "js-sha512";
import { StakeDelegator } from "../../stake_delegator/artifacts/stakedelegator_client";
import { MockMain } from "../../stake_delegator/artifacts/mock_main/mockmain_client";

async function sleep_rounds(rounds:number, acc:SandboxAccount){
  for(let i = 0; i < rounds; i++)
  {
    await sendGenericPayment(acc.signer, acc.addr, acc.addr, 0);
  }
}

describe("Vesting Tests", () => {
  let sandboxAccount: SandboxAccount;
  let sandboxAppClient: Vesting;
  let appId: number;
  let testAsset: number;
  let appAddress: string;
  let users : Account[];
  let goracle_timelock: number;
  let delegator_app_id: number;
  let delegator_app_addr: string;
  let main_app_id: number;
  let main_app_addr: string;
  
  function sleep(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }

  beforeEach(async () => {
    sandboxAccount = (await bkr.sandbox.getAccounts()).pop()!;
    const NUM_USERS = 10;

    const tCreation = makeAssetCreateTxnWithSuggestedParamsFromObject(
      {
        from: sandboxAccount.addr, 
        suggestedParams: await bkr.clients.sandboxAlgod().getTransactionParams().do(),
        assetName: "bar",
        unitName: "foo",
        total: (NUM_USERS * 1e6) + 1e6,
        decimals: 0,
        defaultFrozen: false
      }
    );
    const tCreationSigned = tCreation.signTxn(sandboxAccount.privateKey);
    const {txId} = await bkr.clients.sandboxAlgod().sendRawTransaction(tCreationSigned).do();
    const create_info = await bkr.clients.sandboxAlgod().pendingTransactionInformation(txId).do();
    testAsset = create_info["asset-index"];

    const delegator_info = await deploy_delegator_with_mock_main(testAsset);
    delegator_app_id = delegator_info["delegator_app_id"];
    delegator_app_addr = delegator_info["delegator_app_addr"];
    testAsset = delegator_info["test_asset"];
    main_app_id = delegator_info["mockMain_app_id"];
    main_app_addr = delegator_info["mockMain_app_addr"];

    sandboxAppClient = new Vesting({
      client: bkr.clients.sandboxAlgod(),
      signer: sandboxAccount.signer,
      sender: sandboxAccount.addr,
    });
    const appCreateResults = await sandboxAppClient.create({extraPages: 1});
    appId  = appCreateResults.appId;
    appAddress = appCreateResults.appAddress;

    users = [];
    for(let i = 0; i < NUM_USERS; i++)
    {   
      const user = generateAccount();
      await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, user.addr, 1e6);
      await sendGenericAsset(makeBasicAccountTransactionSigner(user), testAsset, user.addr, user.addr, 0);
      await sendGenericAsset(sandboxAccount.signer, testAsset, sandboxAccount.addr, user.addr, 20_000);
      users.push(user);
    }
    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, appAddress, 100_000);
  });
  
  it("unable to delete the app", async () => {
    await sendGenericPayment(sandboxAccount.signer, sandboxAccount.addr, appAddress, 1e6);
    await expect(sandboxAppClient.delete()).rejects.toThrow("transaction rejected by ApprovalProgram");
  });

  it("able to vest tokens to user", async () => {
    const optin_algo_transferTxn = {
      txn: makePaymentTxnWithSuggestedParamsFromObject({
        from: users[0].addr,
        suggestedParams: await sandboxAppClient.client.getTransactionParams().do(),
        amount: 200_000,
        to: appAddress,
      }),
      signer: makeBasicAccountTransactionSigner(users[0])
    };

    await sandboxAppClient.optin_asset({
      algo_xfer: optin_algo_transferTxn,
      asset_id: BigInt(testAsset)
    });

    const algo_transferTxn = {
      txn: makePaymentTxnWithSuggestedParamsFromObject({
        from: users[0].addr,
        suggestedParams: await sandboxAppClient.client.getTransactionParams().do(),
        amount: 59_000,
        to: appAddress,
      }),
      signer: makeBasicAccountTransactionSigner(users[0])
    };

    const token_transferTxn = {
      txn: makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: users[0].addr,
        suggestedParams: await sandboxAppClient.client.getTransactionParams().do(),
        amount: 1000,
        to: appAddress,
        assetIndex: testAsset
      }),
      signer: makeBasicAccountTransactionSigner(users[0])
    };
    const asset_64 = new ABIUintType(64);
    const key = new Uint8Array(Buffer.from("goracle_vesting"));
    const key_hash = new Uint8Array(sha512_256.arrayBuffer([...asset_64.encode(testAsset), ...decodeAddress(sandboxAccount.addr).publicKey, ...key]));
    const vestingKey = VestingKey.encode([users[1].addr, key_hash]);

    await sandboxAppClient.vest_tokens(
      {
        algo_xfer: algo_transferTxn,
        token_xfer: token_transferTxn,
        vest_to: users[1].addr,
        vesting_key: key,
        time_to_vest: BigInt(100)
      },
      {
        boxes: [
          {
            name: vestingKey,
            appIndex: appId
          }
        ]
      }
    );
    let vestings = await getVestings(appId, users[1].addr);
    expect(vestings[0].token_id).toEqual(testAsset);
    expect(vestings[0].staked).toEqual(false);
    expect(vestings[0].amount).toEqual(1000);

    // Record the initial pre-balance to compare against final post-balance
    let asset_info_result = await sandboxAppClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    const initialAssetBalance_pre = asset_info_result["asset-holding"]["amount"];

    // Wait halfway through vesting period
    await sleep_rounds(1, sandboxAccount);

    // devnet iterates 25 seconds per transaction, should be able to get 50% here
    asset_info_result = await sandboxAppClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    let assetBalance_pre = asset_info_result["asset-holding"]["amount"];
    let result = await sandboxAppClient.claim_vesting({
      vestee: users[1].addr,
      key_hash: key_hash,
      asset_ref: BigInt(testAsset),
      receiver_ref: users[1].addr,
    },
    {
      boxes: [
        {
          name: vestingKey,
          appIndex: appId
        }
      ]
    }
    );
    vestings = await getVestings(appId, users[1].addr);
    // print bal post
    asset_info_result = await sandboxAppClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    let assetBalance_post = asset_info_result["asset-holding"]["amount"];
    expect(assetBalance_post - assetBalance_pre).toEqual(500);

    // wait another 25 seconds  
    asset_info_result = await sandboxAppClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    assetBalance_pre = asset_info_result["asset-holding"]["amount"];

    result = await sandboxAppClient.claim_vesting({
      vestee: users[1].addr,
      key_hash: key_hash,
      asset_ref: BigInt(testAsset),
      receiver_ref: users[1].addr
    },
    {
      boxes: [
        {
          name: vestingKey,
          appIndex: appId
        }
      ]
    }
    );
    asset_info_result = await sandboxAppClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    assetBalance_post = asset_info_result["asset-holding"]["amount"];
    expect(assetBalance_post - initialAssetBalance_pre).toEqual(750);

    vestings = await getVestings(appId, users[1].addr);
    //should be final claim
    result = await sandboxAppClient.claim_vesting({
      vestee: users[1].addr,
      key_hash: key_hash,
      asset_ref: BigInt(testAsset),
      receiver_ref: users[1].addr
    },
    {
      boxes: [
        {
          name: vestingKey,
          appIndex: appId
        }
      ]
    }
    );
    asset_info_result = await sandboxAppClient.client.accountAssetInformation(users[1].addr, testAsset).do();
    assetBalance_post = asset_info_result["asset-holding"]["amount"];
    expect(assetBalance_post - initialAssetBalance_pre).toEqual(1000);

    // this should crash
    await expect(sandboxAppClient.claim_vesting({
      vestee: users[1].addr,
      key_hash: key_hash,
      asset_ref: BigInt(testAsset),
      receiver_ref: users[1].addr
    },
    {
      boxes: [
        {
          name: vestingKey,
          appIndex: appId
        }
      ]
    }
    )).rejects.toThrow("assert failed");
  });

  it("able to stake tokens to delegation app", async () => {
    const optin_algo_transferTxn = {
      txn: makePaymentTxnWithSuggestedParamsFromObject({
        from: users[0].addr,
        suggestedParams: await sandboxAppClient.client.getTransactionParams().do(),
        amount: 200_000,
        to: appAddress,
      }),
      signer: makeBasicAccountTransactionSigner(users[0])
    };

    await sandboxAppClient.optin_asset({
      algo_xfer: optin_algo_transferTxn,
      asset_id: BigInt(testAsset)
    });

    const algo_transferTxn = {
      txn: makePaymentTxnWithSuggestedParamsFromObject({
        from: users[0].addr,
        suggestedParams: await sandboxAppClient.client.getTransactionParams().do(),
        amount: 59_000,
        to: appAddress,
      }),
      signer: makeBasicAccountTransactionSigner(users[0])
    };

    const token_transferTxn = {
      txn: makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: users[0].addr,
        suggestedParams: await sandboxAppClient.client.getTransactionParams().do(),
        amount: 1000,
        to: appAddress,
        assetIndex: testAsset
      }),
      signer: makeBasicAccountTransactionSigner(users[0])
    };
    const asset_64 = new ABIUintType(64);
    const key = new Uint8Array(Buffer.from("goracle_vesting"));
    const key_hash = new Uint8Array(sha512_256.arrayBuffer([...asset_64.encode(testAsset), ...decodeAddress(sandboxAccount.addr).publicKey, ...key]));
    const vestingKey = VestingKey.encode([users[1].addr, key_hash]);

    await sandboxAppClient.vest_tokens({
      algo_xfer: algo_transferTxn,
      token_xfer: token_transferTxn,
      vest_to: users[1].addr,
      vesting_key: key,
      time_to_vest: BigInt(30)
    },
    {
      boxes: [
        {
          name: vestingKey,
          appIndex: appId
        }
      ]
    }
    );
    
    const userClient = new Vesting({
      client: bkr.clients.sandboxAlgod(),
      signer: makeBasicAccountTransactionSigner(users[1]),
      sender: users[1].addr,
      appId: appId
    });

    const userDelegatorClient = new StakeDelegator({
      client: bkr.clients.sandboxAlgod(),
      signer: makeBasicAccountTransactionSigner(users[1]),
      sender: users[1].addr,
      appId: delegator_app_id
    });
    await userDelegatorClient.optIn();

    const delegator_global_state = await delegatorGetGlobal(delegator_app_id);
    const whitelist_name = new ABIUintType(64).encode(delegator_app_id);
    //attempt to stake when app hasn't been added to whitelist
    await expect(userClient.stake_to_delegator({
      delegator: BigInt(delegator_app_id),
      key_hash: key_hash,
      main_app_ref: BigInt(main_app_id),
      asset_reference: BigInt(testAsset),
      manager_reference: delegator_global_state["manager_address"]
    },
    {
      boxes: [
        {
          name: vestingKey,
          appIndex: appId
        },
        {
          name: whitelist_name,
          appIndex: appId
        }
      ]
    }
    )).rejects.toThrow("assert failed");

    //stake when app has been added to whitelist
    await sandboxAppClient.add_whitelisted_app({
      algo_xfer: makePaymentTxnWithSuggestedParamsFromObject({
        from: sandboxAccount.addr,
        suggestedParams: await sandboxAppClient.client.getTransactionParams().do(),
        amount: 7400,
        to: appAddress,
      }),
      app_id: BigInt(delegator_app_id)
    },
    {
      boxes: [
        {
          name: whitelist_name,
          appIndex: appId
        }
      ]
    }
    );
    let asset_info_result = await userClient.client.accountAssetInformation(main_app_addr, testAsset).do();
    const main_assetBalance_pre = asset_info_result["asset-holding"]["amount"];
    let sp = await userDelegatorClient.client.getTransactionParams().do();
    sp = {
      ...sp,
      flatFee: true,
      fee: 2000
    };
    
    const foo = await userClient.stake_to_delegator({
      delegator: BigInt(delegator_app_id),
      key_hash: key_hash,
      main_app_ref: BigInt(main_app_id),
      asset_reference: BigInt(testAsset),
      manager_reference: delegator_global_state["manager_address"]
    },
    {
      "suggestedParams": sp,
      boxes: [
        {
          name: vestingKey,
          appIndex: appId
        },
        {
          name: whitelist_name,
          appIndex: appId
        }
      ]
    }
    );
    // funds end up moving to main app right away
    asset_info_result = await userClient.client.accountAssetInformation(main_app_addr, testAsset).do();
    const main_assetBalance_post = asset_info_result["asset-holding"]["amount"];
    expect(main_assetBalance_post - main_assetBalance_pre).toEqual(1000);
    

    // wait out goracle timeout
    await sleep_rounds(10, sandboxAccount);

    await userDelegatorClient.manual_process_aggregation(
      {
        asset_reference: BigInt(testAsset),
        main_app_reference: BigInt(main_app_id),
        manager_reference: delegator_global_state["manager_address"], 
      },
      {
        "suggestedParams": sp
      }
    );

    const delegatorLocal = await delegatorGetLocal(delegator_app_id, users[1].addr);
    
    //can unstake directly from delegation app (this doesn't withdraw funds)
    await userDelegatorClient.unstake(
      {
        amount_to_withdraw: BigInt(500),
        vesting_on_behalf_of: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        main_app_ref: BigInt(main_app_id),
        asset_reference: BigInt(testAsset),
        manager_reference: delegator_global_state["manager_address"]
      },
      {
        "suggestedParams": sp
      }
    );

    //have to wait until next aggregation to actually get funds
    await sleep_rounds(10, sandboxAccount);
    sp = await userDelegatorClient.client.getTransactionParams().do();
    sp = {
      ...sp,
      flatFee: true,
      fee: 2000
    };
    await userDelegatorClient.manual_process_aggregation(
      {
        asset_reference: BigInt(testAsset),
        main_app_reference: BigInt(main_app_id),
        manager_reference: delegator_global_state["manager_address"], 
      },
      {
        "suggestedParams": sp
      }
    );

    //cannot withdraw vested funds from delegation app
    await expect(userDelegatorClient.withdraw_non_stake(
      {
        vesting_on_behalf_of: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        main_app_reference: BigInt(main_app_id),
        goracle_token_reference: BigInt(testAsset),
        manager_reference: delegator_global_state["manager_address"]
      }
    )).rejects.toThrow("would result negative");
    
    //since we're using mock main in these tests it doesnt actually withdraw from main app, we can simulate it though
    await sendGenericAsset(sandboxAccount.signer, testAsset, sandboxAccount.addr, delegator_app_addr, 1000);
    
    asset_info_result = await userClient.client.accountAssetInformation(appAddress, testAsset).do();
    const assetBalance_pre = asset_info_result["asset-holding"]["amount"];

    const result = await userClient.withdraw_from_delegator(
      {
        delegator: BigInt(delegator_app_id),
        key_hash: key_hash,
        main_app_ref: BigInt(main_app_id),
        asset_reference: BigInt(testAsset),
        manager_reference: delegator_global_state["manager_address"]
      },
      {
        "suggestedParams": sp,
        boxes: [
          {
            name: vestingKey,
            appIndex: appId
          },
          {
            name: whitelist_name,
            appIndex: appId
          }
        ]
      }
    );

    asset_info_result = await userClient.client.accountAssetInformation(appAddress, testAsset).do();
    const assetBalance_post = asset_info_result["asset-holding"]["amount"];
    expect(assetBalance_post - assetBalance_pre).toEqual(1000);

    const vestings = await getVestings(appId, users[1].addr);
    expect(vestings[0].staked).toEqual(false);
  });
});