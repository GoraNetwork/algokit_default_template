from pyteal import *

key_map = {
    "stakeDelegator": {
        "global": {
            "manager": Bytes("m"),
            "manager_algo_share": Bytes("mas"),
            "manager_gora_share": Bytes("mgs"),
            "stake_time": Bytes("gst"),
            "stake": Bytes("gs"),
            "last_update_time": Bytes("glut"),
            "aggregation_round": Bytes("ar"),
            "global_most_recent_aggregation": Bytes("gmra"),
            "timeout": Bytes("to"),
            "main_app_address": Bytes("maa"),
            "global_unlocked_rewards": Bytes("gur"),
            "fulfilled_withdrawals": Bytes("fw"),
            "pending_withdrawals": Bytes("pw"),
            "pending_deposits": Bytes("pd")
        },
        "local": {
            "stake_time": Bytes("lst"),
            "stake": Bytes("ls"),
            "last_update_time": Bytes("lut"),
            "local_aggregation_tracker": Bytes("lat"), 
            "local_non_stake": Bytes("lns"),
            "vesting_tracker": Bytes("vt") 
        },
        "boxes": {
            "aggregation_box": Bytes("agb"),
        }
    },
    "mockMain": {
        "global": {

        },
        "local": {
            "account_algo": Bytes("aa"),
            "account_token_amount": Bytes("at"),
            "local_stake_array": Bytes("ls")
        }
    }
}