# Sample Hello World Beaker smart contract - the most basic starting point for an Algorand smart contract
import beaker
import pyteal as pt

app = beaker.Application("HelloWorldApp")


@app.external
def hello(name: pt.abi.String, *, output: pt.abi.String) -> pt.Expr:
    return output.set(pt.Concat(pt.Bytes("Hello, "), name.get()))
