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
        "update_stake_timeout": Bytes("ust")
    },
    "voting_global": {
        "creator": Bytes("c"),
        "round": Bytes("r"),
        "current_request_info": Bytes("ri"),
        "contract_address": Bytes("ca"),
        "contract_version": Bytes("cv"),
        "main_app": Bytes("ma")
    },
    "voting_local": {
        "previous_vote": Bytes("pv"),
    },
    "request_status": {
        "request_made": Int(1),
        "processing": Int(2),
        "completed": Int(3),
        "refund_available": Int(4)
    },
    "example_global": {
        "creator": Bytes("c"),
        "currency_id": Bytes("ci"),
        "currency_symbol": Bytes("cs"),
        "currency_name": Bytes("cn"),
        "current_price": Bytes("cp"),
        "market_cap": Bytes("mc"),
        "high_24h": Bytes("h24"),
        "low_24h": Bytes("l24"),
        "price_change_24h": Bytes("pc24"),
        "last_updated": Bytes("lu"),
        "end_round_time": Bytes("ert"),
        "start_round_time": Bytes("srt"),
        "end_submission_round_time": Bytes("esrt"),
        "lock_in_price": Bytes("lp"),
        "submission_amount": Bytes("sa"),
        "round_status": Bytes("rs"),
        "outcome": Bytes("out"),
        "winnings": Bytes("w"),
        "up_tally": Bytes("ut"),
        "down_tally": Bytes("dt"),
        "same_tally": Bytes("st")
    },
    "example_local": {
        "outcome_choice": Bytes("oc"),
        "outcome_choice_time": Bytes("oct")
    }
}