import * as bkr from "beaker-ts";
import algosdk, {
  makePaymentTxnWithSuggestedParams, 
  makeAssetTransferTxnWithSuggestedParams,
  TransactionSigner,
  waitForConfirmation,
} from "algosdk";
import { exec } from "child_process";
import util from "util";
const execAsync = util.promisify(exec);

export async function compileBeaker(filename: string, params?: {[key: string]: string | number}) {
  const pythonAlias = process.env.PYTHON_ALIAS || "python3";
  const contractOutput = await execAsync(`${pythonAlias} ${filename} '${JSON.stringify(params)}'`);
  return contractOutput;
}

export async function sendGenericPayment( signer: TransactionSigner, from: string, to:string, amount:number, algodClient?: algosdk.Algodv2) {

  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const paymentTxn = await signer(
    [
      makePaymentTxnWithSuggestedParams(
        from,
        to,
        amount,
        undefined,
        undefined,
        await algodClient.getTransactionParams().do()
      )
    ], 
    [0]
  );

  const { txId } = await algodClient.sendRawTransaction(paymentTxn).do();
  const result = await waitForConfirmation(algodClient, txId, 3);
  return txId;
}

export async function sendGenericAsset( signer: TransactionSigner, asset_id: number, from: string, to:string, amount:number, algodClient?: algosdk.Algodv2) {

  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const paymentTxn = await signer(
    [
      makeAssetTransferTxnWithSuggestedParams(
        from,
        to,
        undefined,
        undefined,
        amount,
        undefined,
        asset_id,
        await algodClient.getTransactionParams().do(),
        undefined
      )
    ], 
    [0]
  );

  const { txId } = await algodClient.sendRawTransaction(paymentTxn).do();
  const result = await waitForConfirmation(algodClient, txId, 3);
  return txId;
}

export async function getAlgoBalance( address : string, algodClient? : algosdk.Algodv2) {
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const account_info = await algodClient.accountInformation(address).do();
  return account_info.amount;
}

export async function getAssetBalance( address : string, asset_id: number, algodClient? : algosdk.Algodv2) {
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const account_info = await algodClient.accountAssetInformation(address, asset_id).do();
  return account_info["asset-holding"].amount;
}