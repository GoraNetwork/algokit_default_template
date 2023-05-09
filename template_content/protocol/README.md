# Goracle Contracts #

## Install ##
Requirements:

* Node 17.2.0 Current LTS >= 16.15.1
* Python 3.10 + pipenv
* Yarn 1.22.15
* Docker 20.10.17
* Docker-compose 1.29.2
* Algorand Sandbox
* libtool

Once these have been installed, clone the repo into the desired destination and `cd` into it.
Then simply run `yarn` to install node dependencies and `pipenv install` to install python dependencies.

## Environment Variables ##
Before running any scripts, you will need to create a .env file for the target environment:
* Example: `.env.local`

```
ALGOD_TOKEN=<auth token for algod node>
ALGOD_PORT=<port for algod node, ex: "4001">
ALGOD_SERVER=<algod server, ex: "http://127.0.0.1">
ALGOD_AUTH_HEADER=<request header for auth token, ex: "X-Algo-API-Token">
PYTHON_ALIAS=<command to invoke the desired python runtime, ex: "pipenv run python3">
```

## Available Scripts ##

`yarn build`
* This will compile typescript files that are configured to be compiled to javascript files.

`yarn test`
* Run all tests

`yarn test <test suite>`
* This will run the test suit based on the name of the test suite entered. Do not include .ts at the end of the name
* For example `yarn test vote` will run all associated tests for the vote contract 

`yarn deploy`
* Coming soon...

## Main Contract ##
#### This contract contains functions for staking, subscribing, and claiming rewards  ####
The main contract consists of the following files:

* [Main Approval](assets/main_approval.py)
* [Main Clear](assets/main_clear.py)
* [Main ABI](assets/abi/main-contract.json)

## Oracle Contract ##
#### This contract is a template for an oracle to hold values based on schema ####
The oracle contract consists of the following files:

* [Price Oracle Approval](assets/price_oracle_approval.py)
* [Oracle Approval](assets/oracle_approval.py)
* [Oracle Clear](assets/oracle_clear.py)
* [Oracle ABI](need to make this)

## Voting Contract ##
#### Template contract for defining a threshold ratio and associated staking app and handling vote logic ####
The voting contract consists of the following files:

* [Voting Approval](assets/voting_approval.py)
* [Voting Clear](assets/voting_clear.py)
* [Voting Base](assets/helpers/abi_base.py) This is where various helper functions specific to the voting contract are located.
* [Voting ABI](assets/abi/voting-contract.json)
