from pyteal import *

key_map = {
    "main_global": {
        "contract_version_key": Bytes("cv"),
        "total_stake_key": Bytes("ts"),
        "total_algo_key": Bytes("ta"),

        "algo_fee_sink_key": Bytes("af"),
        "token_fee_sink_key": Bytes("tf"),

        "fee_pool_token_key": Bytes("fpt"),
        "fee_pool_algo_key": Bytes("fpa")
    },
    "main_local": {
        "account_token_key": Bytes("at"),
        "account_algo_key": Bytes("aa"),
        "local_stake_key": Bytes("ls"),
        "locked_token_key": Bytes("lt"),
        "subscription_map": Bytes("sm"), # used to track active/inactive subscriptions
        "local_public_key": Bytes("pk"),
        "local_public_key_timestamp_key": Bytes("psts")
    },
    "voting_global": {
        "creator_key": Bytes("c"),
        "round_key": Bytes("r"),
        "proposal_key_prefix": Bytes("p"),
        "proposal_tally_key_prefix": Bytes("pt"),
        "seed_key": Bytes("s"),
        "history_key_prefix": Bytes("h"),
        "history_buffer_pointer_key": Bytes('hp'),
        "unclaimed_rewards_key": Bytes("ur"),
        "contract_address_key": Bytes("ca"),
        "contract_version_key": Bytes("cv"),
        "main_app_key": Bytes("ma")
    },
    "voting_local": {
        "previous_vote_key": Bytes("pv"),
        "reward_points_key": Bytes("rp"),
        "user_vote_amount_key": Bytes("va"),
        "user_vote_index_key": Bytes("vi"),
        "vote_key": Bytes("v"),
        "vote_round_key": Bytes("vr")
    },
    "example_global": {
        "creator_key": Bytes("c"),
        "currency_id_key": Bytes("ci"),
        "currency_symbol_key": Bytes("cs"),
        "currency_name_key": Bytes("cn"),
        "current_price_key": Bytes("cp"),
        "market_cap_key": Bytes("mc"),
        "high_24h_key": Bytes("h24"),
        "low_24h_key": Bytes("l24"),
        "price_change_24h_key": Bytes("pc24"),
        "last_updated_key": Bytes("lu"),
        "end_round_time_key": Bytes("ert"),
        "end_submission_round_time_key": Bytes("esrt"),
        "lock_in_price_key": Bytes("lp"),
        "submission_amount_key": Bytes("sa"),
        "round_status_key": Bytes("rs"),
        "outcome_key": Bytes("out"),
        "winnings_key": Bytes("w"),
        "up_tally_key": Bytes("ut"),
        "down_tally_key": Bytes("dt"),
        "same_tally_key": Bytes("st")
    },
    "example_local": {
        "outcome_choice_key": Bytes("oc")
    }
}