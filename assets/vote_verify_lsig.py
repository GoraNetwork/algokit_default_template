import sys
import yaml
from pyteal import *

def approval_program():
    vrf_result = Txn.application_args[1]
    vrf_proof = Txn.application_args[2]
    block_seed = Txn.application_args[3]
    participation_account = Txn.accounts[Btoi(Txn.application_args[4])]

    vrf_verify_output = VrfVerify.algorand(block_seed, vrf_proof, participation_account)

    program = Seq(
        Assert(
            Txn.fee() == Int(0),
            Txn.close_remainder_to() == Global.zero_address(),
            Txn.rekey_to() == Global.zero_address()
        ),
        vrf_verify_output.outputReducer(
            lambda x,y: Assert(
                And(
                    x == vrf_result,
                    y
                )
            )
        ),
        Approve()
    )
    return program

if __name__ == "__main__":
    params = yaml.safe_load(sys.argv[1])
    print(compileTeal(approval_program(), Mode.Signature, version = 7))