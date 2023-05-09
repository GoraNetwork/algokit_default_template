import { Account } from "algosdk";
import { deployASA } from "algoutils";

export async function deployGora(deployer: Account){
  const tokenAssetId = await deployASA(deployer, {
    assetName: "GORA",
    unitName: "GORA",
    assetURL: "goracle.io",
    decimals: 6,
    total: BigInt(1e16),
    assetMetadataHash: "",
    defaultFrozen: false
  });

  return tokenAssetId;
}