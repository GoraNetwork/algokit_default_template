# Goracle smart contract call API

This document describes the API for making Goracle oracle requests and receiving
responses.

## Requesting oracle data

Oracle requests are made by calling `request` method of the main Goracle smart
contract. This contract's application ID is a part of Goracle network
configuration and can be found using `info` command of the Goracle CLI tool.

The `request` method accepts the following arguments:

 * `spec` - request specification; serialized data structure, describing the
    request. Its format depends on the request type and is explained in the next
    section.
 * `type` - integer ID of the request type; the type determines encoding of the
   `spec` field.
 * `dest_app` - Algorand application ID of the smart contract that will be
   called to return oracle response.
 * `dest_method` - Name of the method to call in the smart contract specified
   by `dest_id`.

### Encoding the request spec

*Currently there is only one request type with the ID of 1, so the following
will all apply to this type.*

Request spec is defined and encoded as an [Algorand ABI type](https://arc.algorand.foundation/ARCs/arc-0004 "Algorand ABI specification").
It is a structured type, because it needs to hold data for multiple properties of
the request and allow querying and aggregating multiple customer-specified
sources.

To make sense of the oracle request ABI type, let us start by describing the
simplest ABI types that comprise it:

 * `sourceArg: byte[]` - an argument for a parametrized Oracle source
 * `sourceArgList: SourceArg[]` - a list of the above
 * `sourceId: uint32` - numeric ID of an oracle source
 * `maxAge: uint32` - maximum age of source data, in seconds, to be considered valid
 * `userData: byte[]` - any data to attach to request and its response
 * `aggregation: uint32` - numeric ID of the aggegation method used for the request

Having defined these basic types, we can now complete the definition of the oracle
request type:

 * `sourceSpec: tuple(sourceId, sourceArgList, maxAge)`
 * `oracleRequest: tuple(sourceSpec[], aggregation, userData)`

#### Parametrized oracle sources

It is often useful to define properties of an oracle source on per-request basis.
For example, if a source provides many pieces of data in a single response
object, it is more convenient to let the requester specify which one do they
want than to define a separate source for each one. This is achieved by
*parametrizing* `valuePath` property. Setting it to `##0` in the oracle source
definition will make Goracle nodes take its value from 0'th argument of the
request being served. Parameter placeholders can just as well be placed inside
strings where they will be substituted, e.g. `http://example.com/##2&a=123`.
The following oracle source definition properties can be parametrized: `url`,
`valuePath`, `timestampPath`, `valueType`, `value`, `roundTo`, `gateway`.  The
substituted values are always treated as strings. For example, when supplying a
parameter to set `roundTo` field to `5`, string `"5"` must be used rather than
the number.

#### Multi-value requests and responses

This is another feature designed for sources that return multiple pieces of data
in the same response. Normally, `valuePath` property contains a single
expression, so just one value is returned by an oracle request. To return
multiple values, it is now possible to specify multiple expressions separated by
tab character, for example: `$.date\t$.time\t$.details.name`. Since an oracle
return value must be a single byte string for the consensus to work, returned
pieces of data are packed into an Algorand ABI array of strings:
```
const multiResponse = new Algosdk.ABIArrayDynamicType(Algosdk.ABIType.from("byte[]"));
```
To access individual results, smart contract handling the oracle response must
unpack this ABI type. *N*th string in the array will correspond to the *n*th
expression in the `valuePath` field. **Important:** all returned pieces of data
in such responses are stringified, including numbers. For example, number
`9183` will be returned as ASCII string `"9183"`. Smart contract code handling
the response must make the necessary conversions.

#### Rounding numeric response values

Certain kinds of data, such as cryptocurrency exchange rates, are so volatile
that different Goracle nodes are likely to get slightly different results
despite querying them at almost the same time. To achieve consensus between
nodes when using such sources, Goracle can round queried values. A source that
supports rounding will have "Round to digits" field when shown with `goracle
sources --list` command. Usually, the rounding setting will be parametrized, for
example: "Round to digits: ##3". This means that the number of significant
digits to round to is supplied in parameter with index 3.  The *number must be
provided in string representation*, like all parameters. Rounding will only
affect the fractional part of the rounded number, all integer digits are always
preserved. For example, if rounding parameter is set to "7", the number 123890.7251
will be rounded to 123890.7, but the number 98765430 will remain unaffected.

#### Example: generating an oracle request spec in Javascript

We start by building the request spec ABI type to encode our request. It can
be accomplished in a single call, but will be done in steps here for clarity:

```javascript
const Algosdk = require("algosdk");

const basicTypes = {
  sourceArgList: new Algosdk.ABIArrayDynamicType(Algosdk.ABIType.from("byte[]")),
  sourceId: Algosdk.ABIType.from("uint32"),
  maxAge: Algosdk.ABIType.from("uint32"),
  userData: Algosdk.ABIType.from("byte[]"),
  aggregation: Algosdk.ABIType.from("uint32"),
};

const sourceSpecType = new Algosdk.ABITupleType([
  basicTypes.sourceId,
  basicTypes.sourceArgList,
  basicTypes.maxAge
]);

const requestSpecType = new Algosdk.ABITupleType([
  new Algosdk.ABIArrayDynamicType(sourceSpecType),
  basicTypes.aggregation,
  basicTypes.userData
]);

```

Now we will use `requestSpecType` ABI type that we just created to encode a
hypothetical Oracle request. We will query two sources for USD/EUR price pair
and receive their average value. The data must be no more than an hour old in
both cases. The sources are predefined in Goracle with IDs 2 and 5, but one
specifies currencies mnemonically while the other does it numerically:

```javascript
const requestSpec = requestSpecType.encode([
  [
    [ 2, [ Buffer.from("usd"), Buffer.from("eur") ], 3600 ],
    [ 5, [ Buffer.from([ 12 ]), Buffer.from([ 44 ]) ], 3600 ],
  ],
  3, // average it
  Buffer.from("test") // let the receiving smart contract know it's a test
]);

```

Done. The `requestSpec` variable can now be used for `spec` argument when calling
the `request` method for Goracle main smart contract.

### Decoding request responses

Results of an oracle request are returned by calling `dest_method` method of the
smart contract specified in `dest_id`. The method gets passed the following two
arguments:

 * `type: uint32` - response type; currently is always `1`.
 * `body: byte[]` - encoded body of the response (details below).

The `body` argument contains an ABI-encoded tuple of the following structure:

 * `byte[]` - request ID. Currently the same as Algorand transaction ID of
   the `request` smart contract call that initiated the request.
 * `address` - address of the account making the request
 * `byte[]` - oracle return value, more details below
 * `byte[]` - data specified in `userData` field of the request
 * `uint32` - result error code, see below
 * `uint64` - bit field with bits corresponding to the request sources;
   if n'th bit is set, the n'th source has failed to yield a valid value.

#### Result error codes

 * `0` - normal result.
 * `1` - result was truncated because it was over the allowed size. Result
         size limit is configured in Node Runner software and depends on
         maximum smart contract arguments size supported by Algorand.

#### Numeric oracle return values

When returned oracle value is a number, it is encoded into a 17-byte array.
`0`'s byte encodes value type:
 * `0` - empty value (not-a-number, NaN)
 * `1` - positive number
 * `2` - negative number

Bytes `1 - 8` contain the integer part, `9 - 17` - the decimal fraction part,
as big endian uint64's.

For example, `0x021000000000000000ff00000000000000` in memory order (first byte
has 0 offset) decodes as `-16.255`
