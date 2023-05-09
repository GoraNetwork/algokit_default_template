import path from "path";
import { sha512_256 } from "js-sha512";
import {
  loadABIContract,
} from "algoutils";
import {
  ABIAddressType,
  ABIMethodParams,
  ABIValue,
  bytesToBigInt,
  decodeAddress,
  encodeUint64,
  Algodv2,
  ABIMethod,
  encodeAddress
} from "algosdk";
import { 
  RequestInfoType,
  StakeArrayType,
  LocalHistoryType,
  ProposalsEntryType,
  ResponseBodyType,
  ResponseBodyBytesType
} from "./abi_types";

import errorCodes from "../assets/smart_assert_errors.json";

const NUM_GLOBAL_HISTORY_SLOTS = 10;
const NUM_GLOBAL_PROPOSAL_SLOTS = 16;

export async function testAssert(testFunction:Promise<any>,errorMessage:string)
{
  let errorIndex = 0;

  try {
    await testFunction;
  }
  catch (e) {
    const error = e as Error;
    const splitError = error.message.split(":")[4];
    if (splitError.includes("shr arg too big")) {
      errorIndex = Number(splitError.split("(")[1].split(")")[0].slice(0,-6));
      expect(errorCodes[errorIndex]).toEqual(errorMessage);
    } else {
      fail(e);
    }
  }
}

export async function getRequestInfo(main_app_id: number, request_box_key: Uint8Array, algodClient: any)
{
  const box = await algodClient.getApplicationBoxByName(main_app_id,request_box_key).do();
  const request_info = RequestInfoType.decode(Buffer.from(box.value, "base64"));
  return {
    request_id: request_info[0],
    voting_contract: request_info[1],
    request_round: parseInt(request_info[2].toString()),
    request_status: request_info[3],
    total_stake: request_info[4],
    key_hash: request_info[5]
  };
}

export async function getRequestInfoVote(votingAppId: number, algodClient: any)
{
  const appInfo = await algodClient.getApplicationByID(votingAppId).do();
  const request_info_bytes = extract_bytes_from_globalstate(appInfo.params["global-state"], "ri");
  const request_info = RequestInfoType.decode(Buffer.from(request_info_bytes, "base64"));
  return {
    request_id: request_info[0],
    voting_contract: request_info[1],
    request_round: parseInt(request_info[2].toString()),
    request_status: request_info[3],
    total_stake: request_info[4],
    key_hash: request_info[5]
  };
}

function extractVoteHistoryFromGlobalstate(globalState: any, index: number){
  let result = undefined;
  for(let i = 0; i < globalState.length; i++)
  {
    const field = globalState[i];
    const state_key = Buffer.from(field.key, "base64");
    if(state_key.toString().length === 9 && state_key.toString()[0] === "h")
    {
      const ind = Number(bytesToBigInt(state_key.slice(1)));
      if(ind == index)
      {
        result = field.value.bytes;
      }
    }
  }
  return result;
}

export async function getGlobalVoteHistory(votingAppId: number, algodClient: Algodv2)
{
  const appInfo = await algodClient.getApplicationByID(votingAppId).do();
  const outputList = [];
  for(let i = 0; i < NUM_GLOBAL_HISTORY_SLOTS; i++)
  {
    const global_history_bytes = extractVoteHistoryFromGlobalstate(appInfo.params["global-state"], i);
    const vote_history = ProposalsEntryType.decode(Buffer.from(global_history_bytes, "base64"));
    const proposal_tally : ArrayLike<bigint>= vote_history[0] as ArrayLike<bigint>;
    
    outputList.push(
      {
        proposalTally_vote_count: Number(proposal_tally[0]),
        proposalTally_stake_count: Number(proposal_tally[1]),
        round: Number(vote_history[4]),
        vote_hash: vote_history[1]
      }
    );
  }
  return outputList;
}

function extractProposalTallyFromGlobalstate(globalState: any, index: number){
  let result = undefined;
  for(let i = 0; i < globalState.length; i++)
  {
    const field = globalState[i];
    const state_key = Buffer.from(field.key, "base64");
    if(state_key.toString().length === 10 && state_key.toString().slice(0,2) === "pt")
    {
      const ind = Number(bytesToBigInt(state_key.slice(2)));
      if(ind == index)
      {
        result = field.value.bytes;
      }
    }
  }
  return result;
}

export async function getGlobalProposalTallys(votingAppId: number, algodClient: Algodv2)
{
  const appInfo = await algodClient.getApplicationByID(votingAppId).do();
  const outputList = [];
  for(let i = 0; i < NUM_GLOBAL_PROPOSAL_SLOTS; i++)
  {
    const global_proposal_bytes = extractProposalTallyFromGlobalstate(appInfo.params["global-state"], i);
    if(global_proposal_bytes !== undefined)
    {
      const proposal_tally = ProposalsEntryType.decode(Buffer.from(global_proposal_bytes, "base64"));
      outputList.push(
        {
          vote_hash: Buffer.from(proposal_tally[0] as Uint8Array).toString("base64"),
          vote_count: Number(proposal_tally[1]),
          stake_count: Number(proposal_tally[2]),
        }
      );
    }
  }
  return outputList;
}

export async function getLocalVoteHistory(votingAppId: number, account: string, algodClient: Algodv2)
{
  
  const appInfo = await algodClient.accountApplicationInformation(account, votingAppId).do();
  const local_history_bytes = extract_bytes_from_localstate(appInfo, "pv").bytes;
  const vote_history = LocalHistoryType.decode(Buffer.from(local_history_bytes, "base64"));
  const proposal_entry = vote_history[1] as ABIValue[];

  return {
    buffer_position: Number(vote_history[0]),
    vote_hash: proposal_entry[0],
    vote_count: Number(proposal_entry[1]),
    stake_count: Number(proposal_entry[2]),
    vote_round: Number(proposal_entry[3])
  };
}

export async function getGlobalStake(mainAppId: number, algodClient: Algodv2)
{
  const appInfo = await algodClient.getApplicationByID(mainAppId).do();
  // const globalState = parseAppState2(appInfo.params["global-state"]);
  const globalTotalStakeBytes= extract_bytes_from_globalstate(appInfo.params["global-state"], "ts");
  const globalTotalStakeArray = StakeArrayType.decode(Buffer.from(globalTotalStakeBytes, "base64"));
  const historicalTotalStakeTuple = globalTotalStakeArray[0] as ABIValue[];
  const currentTotalStakeTuple = globalTotalStakeArray[1] as ABIValue[];

  return {
    historicalTotalStakeRound: Number(historicalTotalStakeTuple[0]),
    historicalTotalStake: Number(historicalTotalStakeTuple[1]),
    currentTotalStakeTupleRound: Number(currentTotalStakeTuple[0]),
    currentTotalStake: Number(currentTotalStakeTuple[1])
  };
}

export async function getLocalStake(primaryAccount: string, mainAppId: number, algodClient: Algodv2)
{
  const accountInfo = await algodClient.accountApplicationInformation(primaryAccount, mainAppId).do();
  const localStakeArrayBytes = extract_bytes_from_localstate(accountInfo,"ls").bytes;
  const localStakeArray = StakeArrayType.decode(Buffer.from(localStakeArrayBytes,"base64"));
  const historicalLocalStakeTuple = localStakeArray[0] as ABIValue[];
  const currentLocalStakeTuple = localStakeArray[1] as ABIValue[];

  return {
    historicalLocalStakeRound: Number(historicalLocalStakeTuple[0]),
    historicalLocalStake: Number(historicalLocalStakeTuple[1]),
    currentLocalStakeTupleRound: Number(currentLocalStakeTuple[0]),
    currentLocalStake: Number(currentLocalStakeTuple[1])
  };
}

/* eslint-disable @typescript-eslint/no-var-requires */
const zTable = require("../assets/helpers/z_table.json");
const uint64Max = (2n ** 64n) - 1n;
const uint64Half = uint64Max / 2n;

export function getMethodByName(methods: ABIMethod[], name: string){
  const filteredMethods = methods.filter((m) => m.name === name);
  if (filteredMethods.length > 1)
    throw new Error(`found ${filteredMethods.length} methods with the same name ${filteredMethods
      .map((m) => m.getSignature())
      .join(",")}`);
  if (filteredMethods.length === 0)
    throw new Error(`found 0 methods with the name ${name}`);
  return filteredMethods[0];
}

export function getABIHash(filePath: string){
  function organize(obj: ABIMethodParams[]){
    for(let i = 0; i < obj.length; i++){
      if (obj[i]["desc"]){
        delete obj[i]["desc"];
      }
    }
    obj = obj.sort( (a: ABIMethodParams, b: ABIMethodParams) => a.name.localeCompare(b.name));
    return obj;
  }

  const contract = loadABIContract(path.join(__dirname, filePath));
  const cleaned_contract = organize(contract.toJSON().methods);
  return sha512_256(JSON.stringify(cleaned_contract));
}

export function approxCDF(vrfResult: Uint8Array, localStake: number) {
  const hashBytes = vrfResult.subarray(0, 8);
  let zIndex = 0;
  const q = bytesToBigInt(hashBytes);

  let ajdustedQ = q;
  if (q < uint64Half) {
    ajdustedQ = uint64Half + (uint64Half - q);
  }

  if (q < uint64Half) {
    for (const entry of [].concat(zTable).reverse()) {
      const entryInt = bytesToBigInt(Buffer.from(entry, "base64"));
      if (BigInt(ajdustedQ) >= entryInt) {
        zIndex = zTable.indexOf(entry);
        break;
      }
    }
  } else {
    for (const entry of zTable) {
      const entryInt = bytesToBigInt(Buffer.from(entry, "base64"));
      if (BigInt(ajdustedQ) <= entryInt) {
        zIndex = zTable.indexOf(entry);
        break;
      }
    }
  }

  const z_100 = Math.floor(zIndex / zTable.length * 7 * 100);

  let voteCount = 0;

  const p = 1;
  const mean = Math.floor(localStake / 1000);

  const std = Math.floor(Math.sqrt(Math.floor(mean * 999 / 1000)));
  const deviation = Math.floor(z_100 * std / 100);
  if (q < uint64Half) {
    voteCount = Math.floor(mean - deviation);
  } else {
    voteCount = Math.floor(mean + deviation);
  }

  return {
    voteCount,
    zIndex
  };
}

export function extract_bytes_from_localstate(account_info: any, key: string){
  const local_state = account_info["app-local-state"]["key-value"];
  let result = undefined;
  for(let i = 0; i < local_state.length; i++)
  {
    const field = account_info["app-local-state"]["key-value"][i];
    const state_key = Buffer.from(field.key, "base64").toString();
    if(state_key === key)
    {
      result = field.value;
    }

  }
  return result;
}

export function extract_bytes_from_globalstate(globalState: any, key: string){
  let result = undefined;
  for(let i = 0; i < globalState.length; i++)
  {
    const field = globalState[i];
    const state_key = Buffer.from(field.key, "base64").toString();
    if(state_key === key)
    {
      result = field.value.bytes;
    }
  }
  return result;
}

type Dictionary = { [index:string | number]: any }

function getRequestInfoObj(requestInfoABI: ABIValue[]){
  const requestStatusDict: Dictionary = {
    1:"request_made",
    2:"refunded",
    3:"processing",
    4:"completed",
    5:"refund_available"
  };
  
  const requestInfoObj = {
    request_id: Buffer.from(requestInfoABI[0] as Uint8Array).toString("base64"),
    voting_contract: Number(requestInfoABI[1]),
    request_round: Number(requestInfoABI[2]),
    request_status: requestStatusDict[Number(requestInfoABI[3])],
    total_stake: Number(requestInfoABI[4]),
    key_hash: Buffer.from(requestInfoABI[5] as Uint8Array).toString("base64"),
    is_history: requestInfoABI[6],
    requester_algo_fee: Number(requestInfoABI[7]),
    total_votes: Number(requestInfoABI[8]),
    total_votes_refunded: Number(requestInfoABI[9])
  };
  return requestInfoObj;
}

function getProposalObj(proposalABI: ABIValue[]){
  const proposalObj = {
    vote_hash: Buffer.from(proposalABI[0] as Uint8Array).toString("base64"),
    vote_count: Number(proposalABI[1]),
    stake_count: Number(proposalABI[2]),
    vote_round: Number(proposalABI[3]),
    rewards_payed_out: Number(proposalABI[4]),
    requester: Buffer.from(proposalABI[5] as Uint8Array).toString(),
    is_history: proposalABI[6]
  };
  return proposalObj;
}

function getStakeArrayObj(stakeArrayABI: ABIValue[]){
  const stakeArrayObj = {
    historical_stake: {
      stake_round:Number((stakeArrayABI[0] as ABIValue[])[0]),
      total_stake:Number((stakeArrayABI[0] as ABIValue[])[1])
    },
    current_stake: {
      stake_round:Number((stakeArrayABI[1] as ABIValue[])[0]),
      total_stake:Number((stakeArrayABI[1] as ABIValue[])[1])
    }
  };
  return stakeArrayObj;
}


export async function getGlobalStateMain(mainAppId:number,client:Algodv2){
  const appInfo = await client.getApplicationByID(mainAppId).do();
  const mainBoxes = (await client.getApplicationBoxes(mainAppId).do()).boxes;
  const requestsNotCompleted:any = {};
  const requestsCompleted:any = {};
  
  for (let i = 0; i < mainBoxes.length; i++){
    const box = await client.getApplicationBoxByName(mainAppId,mainBoxes[i].name).do();
    const boxName = Buffer.from(box.name).toString("base64");
    // if (box.value[ProposalsEntryType.byteLen() - 1] != 128){
    try{
      const requestInfoObj = getRequestInfoObj(RequestInfoType.decode(box.value));
      requestsNotCompleted[boxName] = requestInfoObj;
    } catch (e){
      const proposalObj = getProposalObj(ProposalsEntryType.decode(box.value));
      requestsCompleted[boxName] = proposalObj;
    }
  }
  const globalStateMainKeys:Dictionary = {
    cv:"contract_version",
    ts:"total_stake_array",
    af:"algo_fee_sink",
    tf:"token_fee_sink",
    m: "manager_address",
    rrmp: "refund_request_made_percentage",
    rpp: "refund_processing_percentage",
    arf: "algo_request_fee",
    grf: "gora_request_fee",
    vt: "voting_threshold",
    tl: "time_lock",
    vrt: "vote_refill_threshold",
    vra: "vote_refill_amount",
    stl: "subscription_token_lock"
  };

  const globalStateObject:any = {};
  const globalState = appInfo.params["global-state"];

  for (const state of globalState) {
    const key:string = Buffer.from(state.key, "base64").toString();
    const readable_key = globalStateMainKeys[key];
    globalStateObject[readable_key] = state.value;
  }

  const globalTotalStakeObj = getStakeArrayObj(StakeArrayType.decode(Buffer.from(globalStateObject.total_stake_array.bytes, "base64")));
  
  globalStateObject.contract_version = Buffer.from(globalStateObject.contract_version.bytes, "base64").toString();
  globalStateObject.total_stake_array = globalTotalStakeObj;
  globalStateObject.algo_fee_sink = globalStateObject.algo_fee_sink.uint;
  globalStateObject.token_fee_sink = globalStateObject.token_fee_sink.uint;

  globalStateObject.manager_address = encodeAddress(new Uint8Array(Buffer.from(globalStateObject.manager_address.bytes, "base64")));
  globalStateObject.refund_request_made_percentage = globalStateObject.refund_request_made_percentage.uint;
  globalStateObject.refund_processing_percentage = globalStateObject.refund_processing_percentage.uint;
  globalStateObject.algo_request_fee = globalStateObject.algo_request_fee.uint;
  globalStateObject.gora_request_fee = globalStateObject.gora_request_fee.uint;
  globalStateObject.voting_threshold = globalStateObject.voting_threshold.uint;
  globalStateObject.time_lock = globalStateObject.time_lock.uint;
  globalStateObject.vote_refill_threshold = globalStateObject.vote_refill_threshold.uint;
  globalStateObject.vote_refill_amount = globalStateObject.vote_refill_amount.uint;
  globalStateObject.subscription_token_lock = globalStateObject.subscription_token_lock.uint;
  globalStateObject.requests_completed = requestsCompleted;
  globalStateObject.requests_not_completed = requestsNotCompleted;
  
  return globalStateObject;
}

export async function getLocalStateMain(primaryAccount: string, mainAppId:number,client:Algodv2){
  const accountInfo = await client.accountApplicationInformation(primaryAccount, mainAppId).do();

  const localStateMainKeys:Dictionary = {
    at:"account_token_amount",
    aa:"account_algo",
    ls:"local_stake_array",
    lt:"locked_tokens",
    pk:"local_public_key",
    psts:"local_public_key_timestamp",
    ri:"request_info",
    ust:"update_stake_timeout"
  };

  const localStateObject:any = {};
  const local_state = accountInfo["app-local-state"]["key-value"];

  for (const state of local_state) {
    const key:string = Buffer.from(state.key, "base64").toString();
    const readable_key = localStateMainKeys[key];
    localStateObject[readable_key] = state.value;
  }

  const localTotalStakeArrayObj = getStakeArrayObj(StakeArrayType.decode(Buffer.from(localStateObject.local_stake_array.bytes, "base64")));

  localStateObject.account_token_amount = localStateObject.account_token_amount.uint;
  localStateObject.account_algo = localStateObject.account_algo.uint;
  localStateObject.local_stake_array = localTotalStakeArrayObj;
  localStateObject.locked_tokens = localStateObject.locked_tokens.uint;
  localStateObject.local_public_key = new ABIAddressType().decode((new ABIAddressType().encode(Buffer.from(localStateObject.local_public_key.bytes,"base64"))));
  localStateObject.local_public_key_timestamp = localStateObject.local_public_key_timestamp.uint;
  localStateObject.update_stake_timeout = localStateObject.update_stake_timeout.uint;
  
  return localStateObject;
}

export async function getGlobalStateVote(votingAppId:number,client:Algodv2){
  const appInfo = await client.getApplicationByID(votingAppId).do();
  const votingBoxes = (await client.getApplicationBoxes(votingAppId).do()).boxes;
  const proposalsDict:any = {};
  const previousVotes:any = {};
  
  for (let i = 0; i < votingBoxes.length; i++){
    const box = await client.getApplicationBoxByName(votingAppId,votingBoxes[i].name).do();
    
    if (box.value.length == LocalHistoryType.byteLen()){
      const previousVoteEntry = LocalHistoryType.decode(box.value);
      const keyHash = Buffer.from(previousVoteEntry[0] as Uint8Array).toString("base64");
      const proposalEntry = previousVoteEntry[1] as ABIValue[];
      const proposalObj = getProposalObj(proposalEntry);
      const finalPreviousVoteEntry = {
        key_hash:keyHash,
        proposal:proposalObj
      };
      const boxName = encodeAddress(box.name);
      previousVotes[boxName] = finalPreviousVoteEntry;
    } else{
      const proposalObj = getProposalObj(ProposalsEntryType.decode(box.value));
      const boxName = Buffer.from(box.name).toString("base64");

      proposalsDict[boxName] = proposalObj;
    }
  }
  
  const globalStateVoteKeys:Dictionary = {
    c:"creator",
    r:"round",
    ri:"current_request_info",
    cv:"contract_version",
    ma:"main_app",
  };

  const globalStateObject:any = {};
  const globalState = appInfo.params["global-state"];

  for (const state of globalState) {
    const key:string = Buffer.from(state.key, "base64").toString();
    const readable_key = globalStateVoteKeys[key];
    globalStateObject[readable_key] = state.value;
  }

  const requestInfoObj = getRequestInfoObj(RequestInfoType.decode(Buffer.from(globalStateObject.current_request_info.bytes, "base64")));

  globalStateObject.creator = new ABIAddressType().decode(Buffer.from(globalStateObject.creator.bytes, "base64"));
  globalStateObject.round = globalStateObject.round.uint;
  globalStateObject.current_request_info = requestInfoObj;
  globalStateObject.proposals = proposalsDict;
  globalStateObject.previous_vote = previousVotes;
  globalStateObject.contract_version = Buffer.from(globalStateObject.contract_version.bytes, "base64").toString();
  globalStateObject.main_app = globalStateObject.main_app.uint;
  
  return globalStateObject;
}

export async function getVoteHash(
  destinationAppId:number,
  destinationSig:Uint8Array,
  requesterAddress:string,
  requestId:Uint8Array,
  userVote:string | Uint8Array,
  userData:string,
  errorCode:number,
  bitField:number,
){
  const response_body = ResponseBodyType.encode([
    Buffer.from(requestId),
    requesterAddress,
    Buffer.from(userVote),
    Buffer.from(userData),
    errorCode,
    bitField
  ]);
  const response_body_bytes = ResponseBodyBytesType.encode(response_body);
  const destinationAppIdEncoded = encodeUint64(destinationAppId);
  const requesterAddressPublicKey = decodeAddress(requesterAddress).publicKey;
  const voteArray = new Uint8Array(
    response_body_bytes.length + 
    destinationAppIdEncoded.length + 
    destinationSig.length + 
    requesterAddressPublicKey.length
  );
  voteArray.set(response_body_bytes);
  voteArray.set(destinationAppIdEncoded,response_body_bytes.length);
  voteArray.set(destinationSig,response_body_bytes.length + destinationAppIdEncoded.length);
  voteArray.set(requesterAddressPublicKey, response_body_bytes.length + destinationAppIdEncoded.length + destinationSig.length);
  const newVote = new Uint8Array(sha512_256.arrayBuffer(voteArray));
  return newVote;
}

type source_entry = {
  source_id: number,
  source_args: Uint8Array[],
  max_age: number,
}
export function generate_request_ts_code(
  goracle_main_app_id: number,
  destination_method_selector: Uint8Array, 
  destination_method_app_id: number,
  user_data: Uint8Array,
  source_array : source_entry[],
  aggregation_type: number,
  request_sender: string,
  request_type: number
){
  const import_code = "import {\n" +
    " makeApplicationNoOpTxnFromObject, \n" +
  "} from \"algosdk\"; \n\n";

  let source_arg_code = " const SourceSpecType = new ABITupleType([ \n" +
    "new ABIUintType(32), //source_id \n" +
    "new ABIArrayDynamicType(new ABIArrayDynamicType(new ABIByteType())), // source args \n" +
    "new ABIUintType(64) //max age of the data in seconds \n" +
    "]) \n\n" +
    "const source_spec_arr = [] \n";
  for(let i = 0; i < source_array.length; i++)
  {
    source_arg_code += "source_spec_arr.push( SourceSpecType.encode(" + source_array[i]["source_id"] + ", " + source_array[i]["source_args"] + ", " + source_array[i]["max_age"] + ")); \n"; 
  }

  const request_arg_code = "const request_args_type = new ABITupleType([ \n" +
    "new ABIArrayDynamicType(SourceSpecType), //an array of sources (assuming more than 1 if aggregating)\n" +
    "new ABIUintType(32), //aggregation type\n" + 
    "new ABIArrayDynamicType(new ABIByteType())] ); //user data that the user wishes to include with the result\n\n" +
    "const request_args = request_args_type.encode([source_spec_arr, " + aggregation_type + ", " + "new Uint8Array([" + user_data.toString() + "]]); \n";

  const destination_arg_code = "const destination_type = new ABITupleType([ \n" +
    "new ABIUintType(64),  //app id of the destination \n" +
    "new ABIArrayDynamicType(new ABIByteType())]); //method signature of the method in the destination app \n\n" +
    "const destination_args = destination_type.encode([ " + destination_method_app_id.toString() + ", " + "new Uint8Array([" + destination_method_selector.toString() + "]) ]);";
  
  const make_request_code = "let txn = makeApplicationNoOpTxnFromObject({\n" +
    " from:" + request_sender + ",\n"+
    " appIndex: " + goracle_main_app_id + ",\n" +
    " suggestedParams: await algodClient.getTransactionParams().do(), \n " +
    " appArgs: [ \n" +
    "  new Uint8Array([2,16,66,88]), //this is the abi method signature for making a request in the main contract\n" +
    "  request_args, \n" +
    "  destination_args, \n" +
    "  type \n" +
    "  key \n" +
    "  app_refs \n" +
    "  asset_refs \n" +
    "  account_refs \n" +
    "  box_refs \n" +
    "  ";
  " ]\n" +
    "})\n";
  
  const templated_ts =
    "//creates a goracle transaction without using the goracle SDK references.\n" +
    import_code + "\n" +
    "const algodClient = new algosdk.Algodv2(token, server, port);\n" + 
    source_arg_code + "\n" +
    request_arg_code + "\n" +
    destination_arg_code + "\n" +
    "const type = " + request_type + "\n" +
    "const key = " + Buffer.from("my_custom_key") + "\n" +
    "const app_refs = []" + "\n" +
    "const asset_refs = []" + "\n" +
    "const account_refs = []" + "\n" +
    "const box_refs = []" + "\n" +
    make_request_code;
  
  return templated_ts;
}

export function generate_request_pt_code(
  goracle_main_app_id: number,
  destination_method_selector: Uint8Array, 
  destination_method_app_id: number,
  user_data: Uint8Array,
  source_array : source_entry[],
  aggregation_type: number,
  request_type: number
){

  let source_tuple_declarations = "";
  for(let i = 0; i < source_array.length; i++)
  {
    source_tuple_declarations +=
      `
      source_tuple_` + i + ` = abi.make(SourceSpec)
      `;
  }

  let source_tuples_code = "";
  for(let i = 0; i < source_array.length; i++)
  {
    source_tuples_code +=
      `
      create_source_tuple( 
          Int(` + source_array[i]["source_id"] +`), #source ID
          Bytes(bytearray(` + source_array[i]["source_args"] + `)), #source Args
          Int(` + source_array[i]["max_age"] + ")).store_into(source_tuple_" + i + `)
      `;
  }

  let source_tuple_array = "[";
  for(let i = 0; i < source_array.length - 1; i++)
  {
    source_tuple_array += "source_tuple_" + i + ", ";
  }
  if(source_array.length > 0)
  {
    source_tuple_array += "source_tuple_" + (source_array.length - 1) + "]";
  }

  const make_request_code =
      `
      my_request = Seq([
          ` + source_tuples_code + `
              
          #make_request expects a dynamic array of source_tuples (so that the user may request data from multiple sources)
          #in this example we are only using a single source, but note you can input an array of multiple soruces here.
          source_arr.set(` + source_tuple_array + `),
          make_request(
              source_arr,
              Int(` + aggregation_type + `), # aggregation method
              Bytes(bytearray(` + user_data + `)), #user data
              Int(` + destination_method_app_id +`), #destination application id
              Bytes(bytearray(` + destination_method_selector + `)), #the method signature for goracle network to call
              ` + goracle_main_app_id + `, #goracle main app id
              Int(` + request_type + `)
          ),
      ])
      `;
  
  const templated_ts =
    "//creates a goracle transaction without using the goracle SDK references.\n" +
    source_tuple_declarations + "\n" +
    make_request_code;
  
  return templated_ts;
}

export function generate_request_pt_base_code(){
  const import_code = `
    from pyteal import *
  `;

  const base_code = `  
    class SourceSpec(abi.NamedTuple):
        source_id: abi.Field[abi.Uint32]
        source_arg_list: abi.Field[abi.DynamicBytes]
        max_age: abi.Field[abi.Uint64]

    class RequestSpec(abi.NamedTuple):
        source_specs: abi.Field[abi.DynamicArray[SourceSpec]]
        aggregation: abi.Field[abi.Uint32]
        user_data: abi.Field[abi.DynamicBytes]

    class DestinationSpec(abi.NamedTuple):
        destination_id: abi.Field[abi.Uint64]
        destination_method: abi.Field[abi.DynamicBytes]

    class ResponseBody(abi.NamedTuple):
        request_id: abi.Field[abi.StaticBytes[L[32]]]
        requester_address: abi.Field[abi.Address]
        oracle_return_value: abi.Field[abi.DynamicArray[abi.Byte]]
        user_data: abi.Field[abi.DynamicArray[abi.Byte]]
        error_code: abi.Field[abi.Uint32]
        source_failures: abi.Field[abi.Uint64]

    @ABIReturnSubroutine
    def create_source_tuple(
        source_id: Expr, #Int
        source_arg_list: Expr, #Bytes
        max_age: Expr,
        *,
        output: SourceSpec
    ) -> Expr: #Int
        return Seq([
            (source_id_param := abi.Uint32()).set(source_id),
            (source_arg_list_param := abi.DynamicBytes()).set(source_arg_list),
            (max_age_param := abi.Uint64()).set(max_age),
            output.set(
                source_id_param,
                source_arg_list_param,
                max_age_param
            ),
        ])

    '''
    SourceSpec: SourceSpec that is already encoded
    aggregation: pyteal.Int
    user_data: pyteal.Bytes
    method_signature: pyteal.Bytes
    app_id: pyteal.Int
    goracle_main_app_id: pyteal.Int
    request_types: pyteal.Int
    '''

    @Subroutine(TealType.none)
    def make_request(
        source_specs: abi.DynamicArray[SourceSpec],
        aggregation: Expr, #Int
        user_data: Expr, #Bytes
        app_id: Expr, #Int
        method_signature: Expr, #Bytes
        goracle_main_app_id: Expr,  #Int
        request_type: Expr
    ): # Int

        request_tuple = abi.make(RequestSpec)
        destination_tuple = abi.make(DestinationSpec)
        request_type_arg = abi.make(abi.Uint64)
        source_arr = abi.make(abi.DynamicArray[SourceSpec])

        return Seq([
            (user_data_param := abi.DynamicBytes()).set(user_data),
            (agg_param := abi.Uint32()).set(aggregation),
            (app_id_param := abi.Uint64()).set(app_id),
            (request_type_param := abi.Uint64()).set(request_type),
            (method_sig_param := abi.DynamicBytes()).set(method_signature),

            request_tuple.set(
                source_specs,
                agg_param,
                user_data_param
            ),

            destination_tuple.set(
                app_id_param,
                method_sig_param
            ),

            request_type_arg.set(request_type),
            InnerTxnBuilder.Begin(),
            InnerTxnBuilder.MethodCall(
                app_id=goracle_main_app_id,
                method_signature=bytearray([2,16,66,88]),
                args=[
                    request_tuple.encode(),
                    destination_tuple.encode(),
                    request_type_param.encode()
                ]
            ),
            InnerTxnBuilder.Submit(),
        ])
    `;
  
  const templated_ts =
    import_code + "\n" +
    base_code + "\n";
  
  return templated_ts;
}