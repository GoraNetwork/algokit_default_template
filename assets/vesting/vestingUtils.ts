import * as bkr from "beaker-ts";
import {
  decodeUint64, encodeAddress,
} from "algosdk";
import AlgodClient from "algosdk/dist/types/client/v2/algod/algod";
import { VestingEntry } from "./abi_structures";

export const getAppBoxes = async (app_id: number, algodClient? : AlgodClient) =>
{
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const boxesResponse = await algodClient.getApplicationBoxes(app_id).do();
  const boxNames = boxesResponse.boxes.map(box => box.name);

  const boxes: any = [];
  for(let i = 0; i < boxNames.length; i++)
  {   
    const name = boxNames[i];
    const box = await algodClient.getApplicationBoxByName(app_id, name).do();
    const boxName = box.name;
    const boxValue = box.value;
    boxes.push({boxName: boxName, boxValue: boxValue});
  }
  return boxes;
};

export async function getGlobal( app_id: number, algodClient? : AlgodClient) {
  const output: any = {};
  const output_step: any = {};
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const app_info = await algodClient.getApplicationByID(app_id).do();
  const state = app_info.params["global-state"];
  for(let i = 0; i < state.length; i++)
  {
    output_step[Buffer.from(state[i].key, "base64").toString()] = state[i].value;
  }

  return output;
}

export async function getVestings( app_id: number, address: string, algodClient? : AlgodClient) {
  const output: any = [];
  algodClient = (algodClient === undefined ? bkr.clients.sandboxAlgod() : algodClient);
  const app_boxes = await getAppBoxes(app_id, algodClient);
  for(let i = 0; i < app_boxes.length; i++)
  {
    const box = app_boxes[i];
    const addr = encodeAddress(box.boxName.slice(0,32));
    if(addr === address)
    {
      const entry = VestingEntry.decode(box.boxValue);
      output.push(
        {
          box_name: box.boxName,
          start_time: entry[0],
          unlock_time: entry[1],
          token_id: Number(entry[2]),
          amount: Number(entry[3]),
          amount_claimed: Number(entry[4]),
          vester: entry[5],
          staked: entry[6]
        });
    }
  }
    
  return output;
}


