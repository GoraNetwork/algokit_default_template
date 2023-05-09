import * as fs from "fs";
import * as path from "path";
import {generateAccount, secretKeyToMnemonic} from "algosdk";

const outputPath = path.join(__dirname,"accounts.json");
const count = 50;
const accounts:any[] = [];

for (let i = 0; i <= count; i++) {
  const account = generateAccount();
  const address = account.addr;
  const mnemonic = secretKeyToMnemonic(account.sk);
  accounts.push({
    address: address,
    mnemonic: mnemonic
  });
}

fs.writeFile(outputPath, JSON.stringify(accounts, null, 2), err => {
  if (err) {
    console.log("Error writing file", err);
  } else {
    console.log("Successfully wrote file");
  }
});
