from pyteal import *

def clear_state_program():
    program = Approve()
    return program

if __name__ == "__main__":
    print(compileTeal(clear_state_program(), Mode.Application, version = 7))