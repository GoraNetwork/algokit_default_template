from pyteal import *

def clear_state_program():
    return Approve()

if __name__ == "__main__":
    print(compileTeal(clear_state_program(), Mode.Application, version = 8))