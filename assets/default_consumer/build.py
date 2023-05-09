from default_consumer import app
# from algosdk import *
from beaker import *
import argparse

app_client = client.ApplicationClient(
    client=sandbox.get_algod_client(),
    app=app,
    signer=sandbox.get_accounts().pop().signer
)
app.build(sandbox.get_algod_client()).export("./assets/default_consumer/artifacts")