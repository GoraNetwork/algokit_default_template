import beaker
import pyteal as pt


from named_tuple_blueprint import named_tuple_blueprint
from array_blueprint import array_blueprint

app = beaker.Application("ABIExample")
app.apply(named_tuple_blueprint)
app.apply(array_blueprint)


@app.external
def echo(v: pt.abi.String, *, output: pt.abi.String) -> pt.Expr:
    """echos the string back unchanged"""
    return output.set(v)
