import { readFileSync, writeFileSync } from "fs";
import path from "path";

const priceData = readFileSync(path.resolve(__dirname, "./pricePairs.json"));
const priceDataObj = JSON.parse(priceData.toString());
const priceList = [];

for (const price of Object.keys(priceDataObj)) {
  priceList.push(price);
}

writeFileSync(path.resolve(__dirname, "./priceList.json"), JSON.stringify(priceList, null, 4));