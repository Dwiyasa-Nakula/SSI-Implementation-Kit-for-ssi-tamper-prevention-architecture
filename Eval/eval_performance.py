"""
Performance Benchmarking Suite — Thesis §3.5.3
===============================================
Measures latency and throughput for all SSI operations.

Operations benchmarked:
  PERF-01  Credential ADD to accumulator
  PERF-02  Credential REVOKE from accumulator
  PERF-03  Membership witness computation
  PERF-04  Non-membership (Bezout) witness computation
  PERF-05  ZKP non-membership proof CREATE
  PERF-06  ZKP non-membership proof VERIFY
  PERF-07  Predicate proof CREATE (age >= 18)
  PERF-08  Predicate proof VERIFY
  PERF-09  Accumulator state fetch (VDR read)
  PERF-10  Full round-trip: challenge → ZKP → verify → token

Each operation runs N_WARMUP + N_MEASURE iterations.
Reports: min, avg, median, p95, p99, max, stddev — thesis table-ready.

Scaling test:
  Measures how ADD latency changes as accumulator grows:
  10, 50, 100, 200 members — detects O(n) growth in witness computation.

Usage:
  kubectl port-forward svc/accumulator-service 8080:8080 -n ssi-network
  python src/eval_performance.py
"""

import sys
import time
import json
import os
import math
import hashlib
import secrets
import statistics
import requests
from dataclasses import dataclass, asdict
from typing import List, Dict, Callable

# ── Config ────────────────────────────────────────────────────────────────────
ACC_URL   = "http://localhost:8080"
VG_URL    = "http://localhost:4000"
API_KEY   = "/zWgZdpBePIBiBbxVftRw6HjIyMFFb/u1tkpYqzxUiY="
HDR       = {"x-api-key": API_KEY, "Content-Type": "application/json"}
HDR_OPEN  = {"Content-Type": "application/json"}
N_WARMUP  = 50
N_MEASURE = 2000

# ── Dataclass ─────────────────────────────────────────────────────────────────
@dataclass
class PerfResult:
    id:          str
    operation:   str
    n:           int
    min_ms:      float
    avg_ms:      float
    median_ms:   float
    p95_ms:      float
    p99_ms:      float
    max_ms:      float
    stddev_ms:   float
    throughput:  float    # ops/sec

results: List[PerfResult] = []

def cred_hash(s): return hashlib.sha256(s.encode()).hexdigest()

def _post(url, payload, hdrs=HDR):
    r = requests.post(url, json=payload, headers=hdrs, timeout=30)
    try:    return r.status_code, r.json()
    except: return r.status_code, r.text

def _get(url, hdrs=HDR):
    r = requests.get(url, headers=hdrs, timeout=10)
    try:    return r.status_code, r.json()
    except: return r.status_code, r.text


# ── Benchmark engine ──────────────────────────────────────────────────────────

def bench(op_id: str, op_name: str, fn: Callable,
          n_warmup=N_WARMUP, n_measure=N_MEASURE) -> PerfResult:
    """
    Run fn() n_warmup times (discarded), then n_measure times (recorded).
    Returns a PerfResult with full statistical breakdown.
    """
    print(f"\n  [{op_id}] {op_name}")
    print(f"        Warmup ({n_warmup} runs)…", end=" ", flush=True)

    for _ in range(n_warmup):
        fn()
    print("done")
    print(f"        Measuring ({n_measure} runs)…", end=" ", flush=True)

    latencies = []
    for _ in range(n_measure):
        t0 = time.perf_counter()
        fn()
        latencies.append((time.perf_counter() - t0) * 1000)

    latencies.sort()
    avg    = statistics.mean(latencies)
    med    = statistics.median(latencies)
    p95    = latencies[max(0, int(0.95 * n_measure) - 1)]
    p99    = latencies[max(0, int(0.99 * n_measure) - 1)]
    stddev = statistics.stdev(latencies) if len(latencies) > 1 else 0.0
    tput   = round(1000 / avg, 2) if avg > 0 else 0

    r = PerfResult(
        id=op_id, operation=op_name, n=n_measure,
        min_ms=round(min(latencies), 2), avg_ms=round(avg, 2),
        median_ms=round(med, 2), p95_ms=round(p95, 2),
        p99_ms=round(p99, 2), max_ms=round(max(latencies), 2),
        stddev_ms=round(stddev, 2), throughput=tput,
    )
    results.append(r)
    print(f"avg={avg:.1f}ms  p95={p95:.1f}ms  p99={p99:.1f}ms  stddev={stddev:.1f}ms  tput={tput} ops/s")
    return r


# ═════════════════════════════════════════════════════════════════════════════
# Individual operation benchmarks
# ═════════════════════════════════════════════════════════════════════════════

# Shared state across benchmarks
_shared = {
    "member_hash": None,
    "non_member_hash": None,
    "last_nonce": None,
    "last_proof": None,
}

def setup_shared():
    """Pre-populate accumulator with one active member for read benchmarks."""
    h = cred_hash(f"shared-member-{time.time()}")
    _post(f"{ACC_URL}/accumulator/add", {"cred_hash": h, "issuer_id": "bench"})
    _shared["member_hash"]     = h
    _shared["non_member_hash"] = cred_hash("bench-outsider-fixed")


def perf_01_add():
    def _():
        h = cred_hash(f"bench-add-{time.time()}-{secrets.token_hex(4)}")
        _post(f"{ACC_URL}/accumulator/add", {"cred_hash": h, "issuer_id": "bench"})
    bench("PERF-01", "Credential ADD to accumulator", _)


def perf_02_revoke():
    added = []

    def _pre():
        h = cred_hash(f"bench-revoke-pre-{secrets.token_hex(8)}")
        _post(f"{ACC_URL}/accumulator/add", {"cred_hash": h, "issuer_id": "bench"})
        added.append(h)

    for _ in range(N_WARMUP + N_MEASURE):
        _pre()

    idx = [0]
    def _():
        if idx[0] < len(added):
            _post(f"{ACC_URL}/accumulator/revoke",
                  {"cred_hash": added[idx[0]], "issuer_id": "bench"})
            idx[0] += 1
    bench("PERF-02", "Credential REVOKE from accumulator", _)


def perf_03_membership_witness():
    h = _shared["member_hash"]
    if not h:
        print("  [PERF-03] SKIP — no active member")
        return
    bench("PERF-03", "Membership witness computation",
          lambda: _get(f"{ACC_URL}/accumulator/witness/{h}"))


def perf_04_non_membership_witness():
    h = _shared["non_member_hash"]
    bench("PERF-04", "Non-membership (Bezout) witness computation",
          lambda: _get(f"{ACC_URL}/accumulator/non-membership-witness/{h}", hdrs=HDR_OPEN))


def perf_05_zkp_create():
    h = _shared["non_member_hash"]

    def _():
        n = secrets.token_hex(16)
        _shared["last_nonce"] = n
        _, d = _post(f"{ACC_URL}/zkp/create-non-membership-proof",
                     {"cred_hash": h, "nonce": n}, hdrs=HDR_OPEN)
        _shared["last_proof"] = d.get("proof") if isinstance(d, dict) else None
    bench("PERF-05", "ZKP non-membership proof CREATE", _)


def perf_06_zkp_verify():
    h = _shared["non_member_hash"]

    def _():
        n = secrets.token_hex(16)
        _, d = _post(f"{ACC_URL}/zkp/create-non-membership-proof",
                     {"cred_hash": h, "nonce": n}, hdrs=HDR_OPEN)
        proof = d.get("proof") if isinstance(d, dict) else {}
        _post(f"{ACC_URL}/zkp/verify-non-membership-proof",
              {"proof": proof, "nonce": n,
               "presentation_id": f"bench-{secrets.token_hex(4)}"}, hdrs=HDR_OPEN)
    bench("PERF-06", "ZKP non-membership proof VERIFY (end-to-end)", _)


def perf_07_predicate_create():
    def _():
        n = secrets.token_hex(16)
        _post(f"{ACC_URL}/zkp/create-predicate-proof",
              {"attribute_name": "age", "attribute_value": 25,
               "predicate": ">=", "threshold": 18, "nonce": n}, hdrs=HDR_OPEN)
    bench("PERF-07", "Predicate ZKP CREATE (age >= 18)", _)


def perf_08_predicate_verify():
    def _():
        n = secrets.token_hex(16)
        _, proof = _post(f"{ACC_URL}/zkp/create-predicate-proof",
                         {"attribute_name": "age", "attribute_value": 25,
                          "predicate": ">=", "threshold": 18, "nonce": n}, hdrs=HDR_OPEN)
        if isinstance(proof, dict) and proof.get("valid"):
            _post(f"{ACC_URL}/zkp/verify-predicate-proof",
                  {"proof": proof}, hdrs=HDR_OPEN)
    bench("PERF-08", "Predicate ZKP VERIFY", _)


def perf_09_state_fetch():
    bench("PERF-09", "Accumulator state fetch (VDR read)",
          lambda: _get(f"{ACC_URL}/accumulator/state", hdrs=HDR_OPEN))


def perf_10_full_roundtrip():
    """
    Full round-trip matching the thesis architecture:
    challenge → ZKP proof create → ZKP proof verify → health check
    Simulates the minimal happy-path for one Holder presentation.
    """
    h = _shared["non_member_hash"]

    def _():
        nonce = secrets.token_hex(32)   # RP challenge
        _, d  = _post(f"{ACC_URL}/zkp/create-non-membership-proof",
                      {"cred_hash": h, "nonce": nonce}, hdrs=HDR_OPEN)
        proof = d.get("proof") if isinstance(d, dict) else {}
        _post(f"{ACC_URL}/zkp/verify-non-membership-proof",
              {"proof": proof, "nonce": nonce,
               "presentation_id": f"rt-{secrets.token_hex(4)}"}, hdrs=HDR_OPEN)
        _get(f"{ACC_URL}/accumulator/state", hdrs=HDR_OPEN)
    bench("PERF-10", "Full round-trip (challenge → proof → verify → state)", _,
          n_warmup=2, n_measure=10)


# ═════════════════════════════════════════════════════════════════════════════
# Scaling test: ADD latency vs accumulator size
# ═════════════════════════════════════════════════════════════════════════════

def scaling_test() -> List[Dict]:
    """
    Measure how ADD and non-membership witness latency grows with
    accumulator size.  Tests at sizes 10, 50, 100, 200.
    This directly tests the O(|members|) complexity of the Bezout witness.
    """
    print("\n" + "─" * 65)
    print("  Scaling Test: latency vs accumulator size")
    print("─" * 65)
    print(f"  {'Size':<8} {'ADD avg (ms)':<16} {'Witness avg (ms)':<20} {'ZKP Create avg (ms)'}")
    print(f"  {'-'*7} {'-'*15} {'-'*19} {'-'*19}")

    scaling_data = []
    SIZES        = [10, 50, 100, 200]
    outsider     = cred_hash("scaling-outsider-fixed")

    # Clear first (fresh accumulator by adding/tracking)
    current_size = 0

    for target_size in SIZES:
        # Add members until we reach target_size
        while current_size < target_size:
            h = cred_hash(f"scale-{current_size}-{secrets.token_hex(4)}")
            _post(f"{ACC_URL}/accumulator/add", {"cred_hash": h, "issuer_id": "bench"})
            current_size += 1

        # Benchmark ADD at this size
        add_lats = []
        for _ in range(5):
            h = cred_hash(f"scale-add-{current_size}-{secrets.token_hex(6)}")
            t0 = time.perf_counter()
            _post(f"{ACC_URL}/accumulator/add", {"cred_hash": h, "issuer_id": "bench"})
            add_lats.append((time.perf_counter() - t0) * 1000)
            current_size += 1

        # Benchmark non-membership witness at this size
        wit_lats = []
        for _ in range(5):
            t0 = time.perf_counter()
            _get(f"{ACC_URL}/accumulator/non-membership-witness/{outsider}", hdrs=HDR_OPEN)
            wit_lats.append((time.perf_counter() - t0) * 1000)

        # Benchmark ZKP create at this size
        zkp_lats = []
        for _ in range(5):
            n = secrets.token_hex(16)
            t0 = time.perf_counter()
            _post(f"{ACC_URL}/zkp/create-non-membership-proof",
                  {"cred_hash": outsider, "nonce": n}, hdrs=HDR_OPEN)
            zkp_lats.append((time.perf_counter() - t0) * 1000)

        add_avg = round(statistics.mean(add_lats), 2)
        wit_avg = round(statistics.mean(wit_lats), 2)
        zkp_avg = round(statistics.mean(zkp_lats), 2)

        print(f"  {current_size:<8} {add_avg:<16} {wit_avg:<20} {zkp_avg}")
        scaling_data.append({
            "accumulator_size": current_size,
            "add_avg_ms":     add_avg,
            "witness_avg_ms": wit_avg,
            "zkp_create_avg_ms": zkp_avg,
        })

    return scaling_data


# ═════════════════════════════════════════════════════════════════════════════
# Print thesis-ready table
# ═════════════════════════════════════════════════════════════════════════════

def print_thesis_table():
    print("\n" + "═" * 95)
    print("  Performance Results — Thesis §3.5.3")
    print("═" * 95)
    print(f"  {'ID':<9} {'Operation':<44} {'avg':>7} {'med':>7} {'p95':>7} {'p99':>7} {'stddev':>8} {'ops/s':>7}")
    print(f"  {'-'*8} {'-'*43} {'-'*7} {'-'*7} {'-'*7} {'-'*7} {'-'*8} {'-'*7}")
    for r in results:
        print(
            f"  {r.id:<9} {r.operation[:43]:<44} "
            f"{r.avg_ms:>6.1f}ms {r.median_ms:>6.1f}ms "
            f"{r.p95_ms:>6.1f}ms {r.p99_ms:>6.1f}ms "
            f"{r.stddev_ms:>7.1f}ms {r.throughput:>6.1f}"
        )
    print("═" * 95)


# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═" * 65)
    print("  Performance Benchmarking Suite — §3.5.3")
    print(f"  Config: {N_MEASURE} measurements per operation ({N_WARMUP} warmup)")
    print("═" * 65)

    # Check accumulator is reachable
    s, _, _ = (lambda: (lambda r: (r.status_code, r.json() if r.content else {}, 0))(
        requests.get(f"{ACC_URL}/health", timeout=5)))()
    if s != 200:
        print(f"\n  ✗ Accumulator service unreachable (HTTP {s})")
        print("  Run: kubectl port-forward svc/accumulator-service 8080:8080 -n ssi-network")
        sys.exit(1)

    setup_shared()

    BENCHMARKS = [
        perf_01_add, perf_02_revoke, perf_03_membership_witness,
        perf_04_non_membership_witness, perf_05_zkp_create,
        perf_06_zkp_verify, perf_07_predicate_create, perf_08_predicate_verify,
        perf_09_state_fetch, perf_10_full_roundtrip,
    ]

    for fn in BENCHMARKS:
        try:
            fn()
        except Exception as exc:
            print(f"  [ERROR] {fn.__name__}: {exc}")

    print_thesis_table()

    print("\n  Running scaling test…")
    scaling_data = scaling_test()

    os.makedirs("eval_results", exist_ok=True)
    out = {
        "config": {"n_measure": N_MEASURE, "n_warmup": N_WARMUP},
        "benchmarks": [asdict(r) for r in results],
        "scaling": scaling_data,
    }
    with open("eval_results/performance_eval.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\n  Results saved → eval_results/performance_eval.json")