To build the stake the delegator app for production use

python stakedelegator.py {GORA_TOKEN_ID: <GORATOKENID>, MAIN_APP_ID: <MAIN_APP_ID>}

followed by using beaker-ts to generate a client that's useful for webapp

npx tsx ./node_modules/beaker-ts/src/beaker.ts generate ./assets/stake_delegator/artifacts/application.json ./assets/stake_delegator/artifacts/
