from typing import Dict, Tuple
from pyteal import *

def use_oracle(oracle_id: int, data_fields: Dict[str, TealType]) -> Tuple[Dict[str, ScratchVar], Expr]:
    data = {}
    for data_field in data_fields:
        data[data_field] = ScratchVar(data_fields[data_field])

    get_data_seq = []
    for key in data_fields:
        oracle_value_state = App.globalGetEx(Int(oracle_id), Bytes(key))
        get_data_seq.append(Seq([
            oracle_value_state,
            data[key].store(oracle_value_state.value())
        ]))
    get_data = Seq(get_data_seq)

    return (data, get_data)