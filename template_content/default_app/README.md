# Goracle Template Description

An app calling Goracle feeds generally is compromised of 2 key methods:

1. Request Method
2. Destination Callback

## Making Requests

The Goracle template defines a `send_request` method that encodes a standard Goracle API request. The Key components of the request include:

- The parameters of the API call
- The GORA asset and main contract references

The template sets the above up for you. If you would like to call a specific feed, take a look at the [Feed Examples](https://github.com/GoracleNetwork/algokit_default_template/blob/main/template_content/default_app/feed_examples.json) which will show you examples of the type of data returned by each feed. You may modify this file to receive the type of specific data you would like. To explore the types of data available on testnet and mainnet, you may use the (Goracle Data Explorer)[https://testnet-app.goracle.io/feeds] to browse feeds and returned values.

### Note: For a full understanding of making requests, please visit the [API Documentation](https://github.com/GoracleNetwork/algokit_default_template/blob/main/template_content/default_app/Smart%20Contract%20API.md).

## Receiving Responses

When making a call to the Goracle network, a smart contract must specify the callback method (and any option user data that will be passed back). 

In the Goracle template, the `write_to_data_box` defines the callback method, and does some basic checks (e.g. verifying it is being called by the Goracle voting contracts). The call back method allows you to write trigger any logic you want to do with the returned data.

## Localnet vs Testnet

In localnet, a dummy node network is provided that will always reach consensus, and always return the data in the (Feed Examples)[https://github.com/GoracleNetwork/algokit_default_template/blob/main/template_content/default_app/feed_examples.json] file. 

In testnet and beyond, smart contract will make calls to a network of nodes, and Gas will be required to be paid.

For any questions on implementing the Goracle data feeds, reach out in the (discord developer channel)[https://discord.gg/4TukwqVh]
