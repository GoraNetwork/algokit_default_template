import { Account } from "algosdk";
import { deployASA } from "algoutils";

export async function deployGora(deployer: Account){
  const tokenAssetId = await deployASA(deployer, {
    assetName: "GORA",
    unitName: "GORA",
    assetURL: "goracle.io",
    decimals: 9,
    total: BigInt(1e17), // 1e8 * 1e9
    assetMetadataHash: "",
    defaultFrozen: false
  });

  return tokenAssetId;
}