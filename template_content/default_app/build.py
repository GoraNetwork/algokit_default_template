# Build the sample contract in this directory using Beaker and output to ./artifacts
from pathlib import Path
from beaker import *
import default_app
import algosdk
from pyteal import *


def build(MAIN_APP_ID) -> Path:
    """Build the beaker app, export it to disk, and return the Path to the app spec file"""
    app = default_app.app

    default_app.MAIN_APP_ID = Int(MAIN_APP_ID)
    default_app.MAIN_APP_ADDRESS = Bytes(algosdk.encoding.decode_address(algosdk.logic.get_application_address(MAIN_APP_ID)))

    output_dir = Path(__file__).parent / "artifacts"
    app.build(localnet.get_algod_client()).export(output_dir)

    print(f"Dumping {app.name} to {output_dir}")
    
    return output_dir / "application.json"

if __name__ == "__main__":
    build()
