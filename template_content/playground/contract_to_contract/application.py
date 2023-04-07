import beaker
import pyteal as pt

app = beaker.Application("ContractToContractExample")


@app.external
def echo(v: pt.abi.String, *, output: pt.abi.String) -> pt.Expr:
    """echos the string back unchanged"""
    return output.set(v)


@app.external
def call_other_application(
    other_application: pt.abi.Application,
    string_to_echo: pt.abi.String,
    *,
    output: pt.abi.String,
) -> pt.Expr:
    """calls another contract and returns the result"""
    return pt.Seq(
        # Call the echo method on the other application
        pt.InnerTxnBuilder.ExecuteMethodCall(
            app_id=other_application.application_id(),
            method_signature=echo.method_signature(),
            args=[string_to_echo],
        ),
        # Set the output to whatever it sent us back
        output.set(pt.Suffix(pt.InnerTxn.last_log(), pt.Int(4))),
    )
