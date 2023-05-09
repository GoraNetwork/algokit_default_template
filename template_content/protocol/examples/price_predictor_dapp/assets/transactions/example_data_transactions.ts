import {
  Algodv2,
  Account,
  AtomicTransactionComposer,
  makeBasicAccountTransactionSigner,
  SuggestedParams,
  ABIContract,
} from "algosdk";
import {
  getMethodByName,
} from "algoutils";

import axios from "axios";

export async function inputData(
  account:Account,
  dataContract:ABIContract,
  dataContractAppId:number,
  mainAppId:number,
  suggestedParams:SuggestedParams,
  client:Algodv2
){
  const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1&page=1";
  const response = await axios.get(url);
  
  const data = response.data[0];
  const txnGroup = new AtomicTransactionComposer();
  txnGroup.addMethodCall({
    method: getMethodByName("input_data",dataContract),
    methodArgs:[
      data.id, // currency_id_key
      data.symbol, // currency_symbol_key
      data.name, // currency_name_key
      BigInt(Math.round(data.current_price)), // current_price_key
      BigInt(data.market_cap), // market_cap_key
      Math.round(data.high_24h), // high_24h_key
      Math.round(data.low_24h), // low_24h_key
      Math.round(Math.abs(data.price_change_24h)*100), // price_change_24h_key TODO: add marker for neg or pos
      data.last_updated, // last_updated_key
      mainAppId
    ],
    sender: account.addr,
    signer: makeBasicAccountTransactionSigner(account),
    appID: dataContractAppId,
    suggestedParams: suggestedParams
  });
  const result = await txnGroup.execute(client,8);
  if (result.methodResults[0].txInfo) {
    const logs = result.methodResults[0].txInfo.logs;
    for (const log of logs) {
      console.log(Buffer.from(log).toString());
    }
  }
}