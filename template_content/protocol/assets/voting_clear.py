from pyteal import *
from helpers.voting_base import *

def clear_state_program():
    program = on_clear_logic()
    return program

if __name__ == "__main__":
    print(compileTeal(clear_state_program(), Mode.Application, version = 8))