from scipy.stats import binom
import math
import random
import json
import base64

uint512_max = (2 ** 512) - 1
uint64_max = (2 ** 64) - 1
THEORETICAL_MAX_STAKE = 10_000_000_000
DEFAULT_COMMITTEE_SIZE = 10_000

def make_table(table_size, max_z):
    z_table = []

    n = THEORETICAL_MAX_STAKE
    p = DEFAULT_COMMITTEE_SIZE/THEORETICAL_MAX_STAKE
    std = math.sqrt(n * (1 - p) * p)
    mean = p * n

    for i in range(0, table_size):
        # make sure first entry is uint64max / 2
        if (i == 0):
            z_table.append(int(uint64_max / 2).to_bytes(8, byteorder="big"))
        elif (i < table_size - 1):
            target_z = round(i / table_size * max_z, 2)
            k = (target_z * std) + mean
            value = min(1, binom.cdf(n=n, p=p, k=k))
            z_table.append(int(value * uint64_max).to_bytes(8, byteorder="big"))
        # make sure last entry is max value
        else:
            z_table.append(uint64_max.to_bytes(8, byteorder="big"))
    
    return z_table

def test(table_size, max_z, iterations):
    z_table = make_table(table_size, max_z)
    real_votes = 0
    approx_votes = 0
    for i in range(iterations):
        # set initial committee size and total stake
        committee_size = 0

        # adjust committee size according to total stake
        # when committee size is 0, p = 0.001
        # larger p gives more accurate results for lower stakes
        committee_size = ((committee_size * 0.90) + (THEORETICAL_MAX_STAKE * 0.001))
        p = committee_size / THEORETICAL_MAX_STAKE

        n = random.randint(10_000, 50_000)

        q_half = round(uint64_max / 2)

        q = int.from_bytes(random.randbytes(8), byteorder="big")

        mean = n * p
        std = round(math.sqrt(mean * (1-p)))

        q_ratio = q / uint64_max

        # find actual k
        actual_k = binom.ppf(q=q_ratio, n=n, p=p)

        actual_z = (actual_k - mean) / std

        # lookup z in table
        lookup_z = 0
        adjusted_q = q
        if (q < q_half):
            adjusted_q = q_half + (q_half - q)
        for entry in z_table:
            if adjusted_q < int.from_bytes(entry, byteorder="big"):
                lookup_z = round((z_table.index(entry) / table_size * max_z), 2)
                break

        if q < q_half:
            lookup_z *= -1

        # compute k from z-score
        float_lookup_k = (lookup_z * std) + mean

        lookup_k = max(0, round(float_lookup_k))

        # debugging output for when approximation doesn't match
        if lookup_k != actual_k:
            print("q", q)
            print("q ratio", q_ratio)
            print("lookup_z", lookup_z)
            print("actual_z", actual_z)
            print("mean", mean)
            print("std", std)
            print("committee size", committee_size)
            print("actual_k", actual_k)
            print("lookup_k", lookup_k)

        real_votes += actual_k
        approx_votes += lookup_k
    
    print("real votes", real_votes)
    print("approx votes", approx_votes)
    print("total vote deviation", abs(real_votes - approx_votes) / real_votes)

def write_table(table):
    with open("z_table.json", "w") as outfile:
        json_table = []
        for entry in table:
            json_table.append(base64.b64encode(entry).decode("utf8"))
        outfile.write(json.dumps(json_table))

table = make_table(50, 7)
write_table(table)
# test(50, 7, 10_000)