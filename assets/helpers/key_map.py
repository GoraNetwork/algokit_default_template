from pyteal import *

key_map = {
    "main_global": {
        "contract_version": Bytes("cv"),
        "total_stake_array": Bytes("ts"),
        "algo_fee_sink": Bytes("af"),
        "token_fee_sink": Bytes("tf"),
        
        "manager_address": Bytes("m"),
        "refund_request_made_percentage": Bytes("rrmp"),
        "refund_processing_percentage": Bytes("rpp"),
        "algo_request_fee": Bytes("arf"),
        "gora_request_fee": Bytes("grf"),
        "voting_threshold": Bytes("vt"),
        "time_lock": Bytes("tl"),
        "vote_refill_threshold": Bytes("vrt"),
        "vote_refill_amount": Bytes("vra"),
        "subscription_token_lock": Bytes("stl")
    },
    "main_local": {
        "account_token_amount": Bytes("at"),
        "account_algo": Bytes("aa"),
        "local_stake_array": Bytes("ls"),
        "locked_tokens": Bytes("lt"),
        "local_public_key": Bytes("pk"),
        "local_public_key_timestamp": Bytes("psts"),
        "request_info": Bytes("ri"),
        "update_stake_timeout": Bytes("ust"),
    },
    "voting_global": {
        "creator": Bytes("c"),
        "round": Bytes("r"),
        "current_request_info": Bytes("ri"),
        "contract_version": Bytes("cv"),
        "main_app": Bytes("ma")
    },
    "request_status": {
        "request_made": Int(1),
        "refunded": Int(2),
        "processing": Int(3),
        "completed": Int(4),
        "refund_available": Int(5)
    },
}