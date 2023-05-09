import {
  loadAccountsFromFileSync
} from "@algo-builder/algob";

const sandboxAccounts = loadAccountsFromFileSync("assets/accounts_sandbox.yaml");
const sandboxConfig = {
  host: "http://127.0.0.1",
  port: 4001,
  token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
};

const sandboxNetwork = {
  ...sandboxConfig,
  accounts: sandboxAccounts
};

const testnetAccounts = loadAccountsFromFileSync("assets/accounts_testnet.yaml");
const testnetConfig = {
  host: "https://testnet-algorand.api.purestake.io/ps2",
  port: "",
  token: {
    "X-API-Key": ""
  }
};

const testnetNetwork = {
  ...testnetConfig,
  accounts: testnetAccounts
};


export const networks = {
  sandbox: sandboxNetwork,
  testnet: testnetNetwork
};