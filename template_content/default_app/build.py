# Build the sample contract in this directory using Beaker and output to ./artifacts
from pathlib import Path

import default_app

def build(MAIN_APP_ADDRESS, MAIN_APP_ID) -> Path:
    default_app.MAIN_APP_ADDRESS = MAIN_APP_ADDRESS
    default_app.MAIN_APP_ID = MAIN_APP_ID
    """Build the beaker app, export it to disk, and return the Path to the app spec file"""
    app_spec = default_app.app.build()
    output_dir = Path(__file__).parent / "artifacts"
    print(f"Dumping {app_spec.contract.name} to {output_dir}")
    app_spec.export(output_dir)
    return output_dir / "application.json"


if __name__ == "__main__":
    build()
