
from test.MockMain import MockMain
from algosdk import *
from beaker import *
from pyteal import Int
import json
import os

from stake_delegator import StakeDelegator

TEAL_VERSION = 8
StakeDelegator(version=TEAL_VERSION).dump("./assets/stake_delegator/artifacts", client=sandbox.get_algod_client())
MockMain(TEAL_VERSION).dump("./assets/stake_delegator/artifacts/mock_main", client=sandbox.get_algod_client())
