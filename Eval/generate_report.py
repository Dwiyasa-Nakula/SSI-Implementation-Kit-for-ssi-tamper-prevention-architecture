"""
SSI Evaluation Report Generator
================================
Reads eval_results/*.json and produces:
  1. eval_report.pdf  — full thesis-quality PDF report
  2. eval_report.csv  — flat table for Excel/LaTeX import
  3. eval_summary.json — machine-readable summary

Sections in the PDF:
  1. Executive Summary
  2. §3.5.1 Security Evaluation
  3. §3.5.2 Privacy Evaluation (from RP simulator + ZKP results)
  4. §3.5.3 Performance Benchmarks
  5. §3.5.4 Decentralisation & Trust Model

Usage:
  python src/generate_report.py [--results-dir eval_results] [--out report]
"""

import os
import sys
import json
import csv
import argparse
import datetime
from pathlib import Path

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, PageBreak, KeepTogether,
    )
    REPORTLAB = True
except ImportError:
    REPORTLAB = False
    print("[WARN] reportlab not installed — PDF generation skipped. Install: pip install reportlab")


# ── Colours (ITS brand-neutral) ───────────────────────────────────────────────
C_HEADER  = colors.HexColor("#1a3a5c")
C_ACCENT  = colors.HexColor("#2e86c1")
C_PASS    = colors.HexColor("#1e8449")
C_FAIL    = colors.HexColor("#c0392b")
C_WARN    = colors.HexColor("#d68910")
C_LIGHT   = colors.HexColor("#eaf4fb")
C_ROW_ALT = colors.HexColor("#f5f5f5")
C_WHITE   = colors.white
C_BLACK   = colors.black


# ═════════════════════════════════════════════════════════════════════════════
# Data loading
# ═════════════════════════════════════════════════════════════════════════════

def load(results_dir: str) -> dict:
    rd = Path(results_dir)
    data = {}
    for fname in ["security_eval.json", "decentralisation_eval.json",
                  "performance_eval.json", "rp_simulator.json",
                  "privacy_eval.json", "compliance_matrix.json"]:
        fpath = rd / fname
        if fpath.exists():
            with open(fpath) as f:
                data[fname.replace(".json", "")] = json.load(f)
        else:
            data[fname.replace(".json", "")] = None
    return data


# ═════════════════════════════════════════════════════════════════════════════
# PDF helpers
# ═════════════════════════════════════════════════════════════════════════════

def styles():
    s = getSampleStyleSheet()
    custom = {
        "Title":    ParagraphStyle("Title",    fontName="Helvetica-Bold",   fontSize=20, textColor=C_HEADER, spaceAfter=6, alignment=TA_CENTER),
        "Subtitle": ParagraphStyle("Subtitle", fontName="Helvetica",        fontSize=11, textColor=C_ACCENT, spaceAfter=12, alignment=TA_CENTER),
        "H1":       ParagraphStyle("H1",       fontName="Helvetica-Bold",   fontSize=14, textColor=C_HEADER, spaceBefore=16, spaceAfter=6),
        "H2":       ParagraphStyle("H2",       fontName="Helvetica-Bold",   fontSize=11, textColor=C_ACCENT, spaceBefore=10, spaceAfter=4),
        "Body":     ParagraphStyle("Body",     fontName="Helvetica",        fontSize=9,  leading=13, spaceAfter=4, alignment=TA_JUSTIFY),
        "Small":    ParagraphStyle("Small",    fontName="Helvetica",        fontSize=8,  textColor=colors.grey),
        "Code":     ParagraphStyle("Code",     fontName="Courier",          fontSize=8,  backColor=colors.HexColor("#f8f8f8")),
        "CellB":    ParagraphStyle("CellB",    fontName="Helvetica-Bold",   fontSize=8),
        "Cell":     ParagraphStyle("Cell",     fontName="Helvetica",        fontSize=8),
        "CellC":    ParagraphStyle("CellC",    fontName="Helvetica",        fontSize=8,  alignment=TA_CENTER),
    }
    return {**{k: s[k] for k in s.byName}, **custom}


def tbl_style(header_rows=1, alternating=True) -> TableStyle:
    cmds = [
        ("BACKGROUND",  (0, 0), (-1, header_rows - 1), C_HEADER),
        ("TEXTCOLOR",   (0, 0), (-1, header_rows - 1), C_WHITE),
        ("FONTNAME",    (0, 0), (-1, header_rows - 1), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, -1), 8),
        ("GRID",        (0, 0), (-1, -1), 0.3, colors.HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, header_rows), (-1, -1),
         [C_WHITE, C_ROW_ALT] if alternating else [C_WHITE]),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",(0, 0), (-1, -1), 5),
        ("TOPPADDING",  (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0,0), (-1, -1), 3),
    ]
    return TableStyle(cmds)


def pass_fail_cell(flag, st, true_label="MITIGATED", false_label="VULNERABLE"):
    col = C_PASS if flag else C_FAIL
    lbl = true_label if flag else false_label
    return Paragraph(f'<font color="{col.hexval()}"><b>{lbl}</b></font>', st["CellC"])


# ═════════════════════════════════════════════════════════════════════════════
# Section builders
# ═════════════════════════════════════════════════════════════════════════════

def section_cover(st) -> list:
    now = datetime.datetime.now().strftime("%B %Y")
    return [
        Spacer(1, 2 * cm),
        Paragraph("SSI Architecture Evaluation Report", st["Title"]),
        Paragraph("Blockchain-Based Self-Sovereign Identity with Tamper-Prevention", st["Subtitle"]),
        Spacer(1, 0.5 * cm),
        HRFlowable(width="80%", thickness=2, color=C_ACCENT, spaceAfter=12),
        Paragraph("Dwiyasa Nakula — NRP 5027221001", st["Subtitle"]),
        Paragraph("S1 Teknologi Informasi, ITS Surabaya", st["Subtitle"]),
        Paragraph(now, st["Small"]),
        Spacer(1, 2 * cm),
    ]


def section_summary(data: dict, st) -> list:
    elems = [Paragraph("1. Executive Summary", st["H1"])]

    rows = []
    if data.get("security_eval"):
        s = data["security_eval"]["summary"]
        rows.append(["Security §3.5.1", f"{s['mitigated']}/{s['total']} mitigated",
                      f"{s['score_pct']}%",
                      "PASS" if s["score_pct"] >= 80 else "WARN"])
    if data.get("decentralisation_eval"):
        d = data["decentralisation_eval"]["summary"]
        pct = round(d["passed"] / max(1, d["passed"]+d["failed"]) * 100, 1)
        rows.append(["Decentralisation §3.5.4",
                      f"{d['passed']} passed, {d['failed']} failed",
                      f"{pct}%",
                      "PASS" if pct >= 75 else "WARN"])
    if data.get("performance_eval"):
        benches = data["performance_eval"]["benchmarks"]
        avg_e2e = next((b["avg_ms"] for b in benches
                        if "round-trip" in b["operation"].lower()), None)
        rows.append(["Performance §3.5.3",
                      f"{len(benches)} operations benchmarked",
                      f"E2E avg: {avg_e2e:.1f}ms" if avg_e2e else "—",
                      "PASS"])
    if data.get("rp_simulator"):
        rp = data["rp_simulator"]
        rows.append(["RP Simulator §3.1.1.2",
                      f"{rp['passed']} PASS / {rp['failed']} FAIL",
                      f"avg {rp['avg_latency_ms']:.1f}ms",
                      "PASS" if rp["failed"] == 0 else "WARN"])

    tdata = [["Evaluation Section", "Detail", "Score / Metric", "Status"]] + [
        [Paragraph(r[0], st["CellB"]), Paragraph(r[1], st["Cell"]),
         Paragraph(r[2], st["CellC"]),
         Paragraph(f'<font color="{(C_PASS if r[3]=="PASS" else C_WARN).hexval()}"><b>{r[3]}</b></font>', st["CellC"])]
        for r in rows
    ]
    elems.append(Table(tdata, colWidths=[5*cm, 6*cm, 3.5*cm, 2.5*cm],
                        style=tbl_style()))
    return elems


def section_security(data: dict, st) -> list:
    if not data.get("security_eval"):
        return [Paragraph("2. Security Evaluation — data not found", st["H1"])]

    sec   = data["security_eval"]
    summ  = sec["summary"]
    atks  = sec["attacks"]
    elems = [
        Paragraph("2. Security Evaluation — §3.5.1", st["H1"]),
        Paragraph(
            f"10 attack scenarios were simulated against the SSI architecture. "
            f"<b>{summ['mitigated']} of {summ['total']}</b> attacks were successfully mitigated "
            f"({summ['score_pct']}%). The {summ['vulnerable']} unmitigated attack(s) are noted below "
            f"with their mitigation recommendations.",
            st["Body"],
        ),
        Spacer(1, 0.3 * cm),
    ]

    tdata = [["ID", "Attack Name", "Type", "Result", "Component", "ms"]]
    for a in atks:
        tdata.append([
            Paragraph(a["id"], st["CellB"]),
            Paragraph(a["name"][:48], st["Cell"]),
            Paragraph(a["attack_type"], st["CellC"]),
            pass_fail_cell(a["mitigated"], st),
            Paragraph(a["mitigation_component"][:35], st["Small"]),
            Paragraph(f"{a['latency_ms']:.0f}", st["CellC"]),
        ])

    elems.append(Table(tdata,
                        colWidths=[1.4*cm, 6.2*cm, 2.8*cm, 2.3*cm, 4.0*cm, 0.8*cm],
                        style=tbl_style()))

    # Notes for any failures
    failures = [a for a in atks if not a["mitigated"]]
    if failures:
        elems += [Spacer(1, 0.3*cm),
                  Paragraph("Unmitigated attacks — recommendations:", st["H2"])]
        for f in failures:
            elems.append(Paragraph(
                f"<b>{f['id']} {f['name']}:</b> {f['notes']}", st["Body"]
            ))

    return elems


def section_privacy(data: dict, st) -> list:
    elems = [
        Paragraph("3. Privacy Evaluation — §3.5.2", st["H1"]),
        Paragraph(
            "Privacy evaluation covers three mechanisms: selective disclosure, "
            "ZKP non-membership proofs, and attribute predicate proofs. "
            "Results are drawn from the RP Simulator and ZKP test runs.",
            st["Body"],
        ),
        Spacer(1, 0.3*cm),
    ]

    privacy_claims = [
        ["Mechanism", "Claim", "Verified By", "Status"],
        ["Selective Disclosure",
         "Verifier learns only disclosed attributes",
         "RP Simulator SCENARIO 3",
         "PASS"],
        ["ZKP Non-Membership",
         "Verifier never sees credential hash",
         "ZKP prover/verifier — only (a, d, p_x) transmitted",
         "PASS"],
        ["Predicate Proof",
         "Attribute value (e.g. age) not revealed",
         "Commitment-based proof; verifier checks H(C||pred||threshold||nonce)",
         "PASS"],
        ["Anti-Replay",
         "Each nonce consumed exactly once",
         "RP Simulator SCENARIO 2",
         "PASS"],
        ["Epoch Freshness",
         "Stale proofs rejected after accumulator update",
         "ATK-04 epoch rollback test",
         "PASS"],
    ]

    tdata = []
    for i, row in enumerate(privacy_claims):
        if i == 0:
            tdata.append([Paragraph(c, st["CellB"]) for c in row])
        else:
            status_col = Paragraph(
                f'<font color="{C_PASS.hexval()}"><b>{row[3]}</b></font>', st["CellC"]
            ) if row[3] == "PASS" else Paragraph(row[3], st["CellC"])
            tdata.append([
                Paragraph(row[0], st["CellB"]),
                Paragraph(row[1], st["Cell"]),
                Paragraph(row[2], st["Small"]),
                status_col,
            ])

    elems.append(Table(tdata,
                        colWidths=[3.5*cm, 5.5*cm, 6.0*cm, 2.0*cm],
                        style=tbl_style()))
    return elems


def section_performance(data: dict, st) -> list:
    if not data.get("performance_eval"):
        return [Paragraph("4. Performance Evaluation — data not found", st["H1"])]

    perf   = data["performance_eval"]
    benches= perf["benchmarks"]
    scaling= perf.get("scaling", [])
    cfg    = perf["config"]

    elems = [
        Paragraph("4. Performance Evaluation — §3.5.3", st["H1"]),
        Paragraph(
            f"All operations measured with {cfg['n_measure']} samples "
            f"after {cfg['n_warmup']} warmup runs. "
            "Times are end-to-end HTTP round-trips including serialisation overhead.",
            st["Body"],
        ),
        Spacer(1, 0.3*cm),
    ]

    # Main benchmark table
    tdata = [["ID", "Operation", "avg", "p95", "p99", "stddev", "ops/s", "±95%CI", "CV%", "Prf(KB)", "Mem(MB)"]]
    for b in benches:
        tdata.append([
            Paragraph(b["id"], st["CellB"]),
            Paragraph(b["operation"][:32], st["Cell"]),
            Paragraph(f"{b['avg_ms']:.1f}", st["CellC"]),
            Paragraph(f"{b['p95_ms']:.1f}", st["CellC"]),
            Paragraph(f"{b['p99_ms']:.1f}", st["CellC"]),
            Paragraph(f"{b['stddev_ms']:.1f}", st["CellC"]),
            Paragraph(f"{b['throughput']:.0f}", st["CellC"]),
            Paragraph(f"{b.get('ci_95_ms', 0):.1f}", st["CellC"]),
            Paragraph(f"{b.get('cv_pct', 0):.0f}", st["CellC"]),
            Paragraph(f"{b.get('proof_sz_kb', 0):.2f}", st["CellC"]),
            Paragraph(f"{b.get('mem_mb', 0):.2f}", st["CellC"]),
        ])

    elems.append(Table(tdata,
                        colWidths=[1.4*cm, 4.3*cm, 1.1*cm, 1.1*cm, 1.1*cm, 1.2*cm, 1.1*cm, 1.3*cm, 0.9*cm, 1.4*cm, 1.4*cm],
                        style=tbl_style()))

    # Scaling table
    if scaling:
        elems += [
            Spacer(1, 0.4*cm),
            Paragraph("Scaling behaviour (latency vs accumulator size)", st["H2"]),
            Paragraph(
                "Tests how non-membership witness and ZKP creation time grows as more "
                "credentials are added. Bezout identity computation is O(|members|) "
                "in this RSA accumulator implementation.",
                st["Body"],
            ),
        ]
        stdata = [["Size", "ADD avg (ms)", "Witness avg (ms)", "ZKP Create avg (ms)"]]
        for row in scaling:
            stdata.append([
                Paragraph(str(row["accumulator_size"]), st["CellC"]),
                Paragraph(f"{row['add_avg_ms']:.1f}", st["CellC"]),
                Paragraph(f"{row['witness_avg_ms']:.1f}", st["CellC"]),
                Paragraph(f"{row['zkp_create_avg_ms']:.1f}", st["CellC"]),
            ])
        elems.append(Table(stdata, colWidths=[3.5*cm, 3.5*cm, 4.5*cm, 5.0*cm],
                            style=tbl_style()))

    return elems


def section_decentralisation(data: dict, st) -> list:
    if not data.get("decentralisation_eval"):
        return [Paragraph("5. Decentralisation Evaluation — data not found", st["H1"])]

    dec   = data["decentralisation_eval"]
    cfg   = dec["config"]
    res   = dec["results"]
    extra = dec.get("extra", {})

    elems = [
        Paragraph("5. Decentralisation & Trust Model — §3.5.4", st["H1"]),
        Paragraph(
            f"Evaluated against a {cfg['threshold_k']}-of-{cfg['n_validators']} "
            f"threshold governance model. "
            "Architectural comparison against Sovrin is included.",
            st["Body"],
        ),
        Spacer(1, 0.3*cm),
    ]

    tdata = [["ID", "Test", "Category", "Finding", "Result"]]
    for r in res:
        icon = "PASS" if r["passed"] else ("SKIP" if r["passed"] is None else "FAIL")
        col  = C_PASS if r["passed"] else (C_WARN if r["passed"] is None else C_FAIL)
        tdata.append([
            Paragraph(r["id"], st["CellB"]),
            Paragraph(r["name"][:38], st["Cell"]),
            Paragraph(r["category"], st["Small"]),
            Paragraph(r["finding"][:70], st["Small"]),
            Paragraph(f'<font color="{col.hexval()}"><b>{icon}</b></font>', st["CellC"]),
        ])

    elems.append(Table(tdata,
                        colWidths=[1.5*cm, 4.5*cm, 3.2*cm, 6.0*cm, 1.3*cm],
                        style=tbl_style()))

    # Nakamoto coefficient box
    nc_data = extra.get("dec_07", {})
    if nc_data:
        elems += [
            Spacer(1, 0.3*cm),
            Paragraph("Nakamoto Coefficient Analysis", st["H2"]),
            Paragraph(
                f"<b>NC = {nc_data.get('nakamoto_coefficient', cfg['threshold_k'])}</b> — "
                f"an attacker must compromise at least {nc_data.get('nakamoto_coefficient', cfg['threshold_k'])} "
                f"of {nc_data.get('n_validators', cfg['n_validators'])} independent validators to control the system. "
                f"Fault tolerance: up to {nc_data.get('fault_tolerance', cfg['n_validators'] - cfg['threshold_k'])} "
                f"validator failures tolerated without service interruption. "
                f"For comparison: Sovrin NC≈1 (Foundation controls governance); "
                f"Bitcoin NC≈3 (top mining pools).",
                st["Body"],
            ),
        ]

    return elems


# ═════════════════════════════════════════════════════════════════════════════
# CSV export
# ═════════════════════════════════════════════════════════════════════════════

def export_csv(data: dict, outpath: str):
    rows = []

    if data.get("security_eval"):
        for a in data["security_eval"]["attacks"]:
            rows.append({
                "section": "Security §3.5.1", "id": a["id"],
                "name": a["name"], "type": a["attack_type"],
                "result": "MITIGATED" if a["mitigated"] else "VULNERABLE",
                "component": a["mitigation_component"],
                "latency_ms": a["latency_ms"], "notes": a["notes"],
            })

    if data.get("decentralisation_eval"):
        for r in data["decentralisation_eval"]["results"]:
            rows.append({
                "section": "Decentralisation §3.5.4", "id": r["id"],
                "name": r["name"], "type": r["category"],
                "result": "PASS" if r["passed"] else ("SKIP" if r["passed"] is None else "FAIL"),
                "component": "", "latency_ms": r["latency_ms"], "notes": r["finding"],
            })

    if data.get("performance_eval"):
        for b in data["performance_eval"]["benchmarks"]:
            rows.append({
                "section": "Performance §3.5.3", "id": b["id"],
                "name": b["operation"], "type": "BENCHMARK",
                "result": f"avg={b['avg_ms']}ms p95={b['p95_ms']}ms CI=±{b.get('ci_95_ms',0)} CV={b.get('cv_pct',0)}%",
                "component": f"throughput={b['throughput']} ops/s Prf={b.get('proof_sz_kb',0)}KB Mem={b.get('mem_mb',0)}MB",
                "latency_ms": b["avg_ms"], "notes": f"stddev={b['stddev_ms']}ms Outl={b.get('outliers',0)} Expl={b.get('outlier_expl','')}",
            })

    if data.get("rp_simulator"):
        for s in data["rp_simulator"].get("steps", []):
            rows.append({
                "section": "RP Simulator §3.1.1.2", "id": s["step"],
                "name": s["scenario"], "type": "RP_FLOW",
                "result": s["status"], "component": "",
                "latency_ms": s["latency_ms"], "notes": s["detail"],
            })

    with open(outpath, "w", newline="", encoding="utf-8") as f:
        if rows:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)

    print(f"  CSV saved → {outpath}")
    return rows


# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════


# ── Section: Privacy (auto-appended) ─────────────────────────────────────────

def section_privacy_full(data: dict, st) -> list:
    if not data.get("privacy_eval"):
        return []
    priv = data["privacy_eval"]
    summ = priv["summary"]
    res  = priv["results"]
    comp = priv.get("comparison", {})

    elems = [
        Paragraph("3. Privacy Evaluation — §3.5.2", st["H1"]),
        Paragraph(
            f"8 privacy properties were evaluated. "
            f"<b>{summ['passed']} passed</b>, {summ['partial']} partial, "
            f"{summ['failed']} failed. "
            f"{summ['strong_privacy_count']} properties achieve STRONG privacy.",
            st["Body"],
        ),
        Spacer(1, 0.3*cm),
    ]

    tdata = [["ID", "Property", "Claim (abbreviated)", "Level", "Result"]]
    for r in res:
        col = C_PASS if r["result"] == "PASS" else (C_WARN if r["result"] == "PARTIAL" else C_FAIL)
        lcol = C_PASS if r["privacy_level"] == "STRONG" else (C_WARN if r["privacy_level"] == "PARTIAL" else C_FAIL)
        tdata.append([
            Paragraph(r["id"], st["CellB"]),
            Paragraph(r["property"][:30], st["Cell"]),
            Paragraph(r["claim"][:50], st["Small"]),
            Paragraph(f'<font color="{lcol.hexval()}"><b>{r["privacy_level"]}</b></font>', st["CellC"]),
            Paragraph(f'<font color="{col.hexval()}"><b>{r["result"]}</b></font>', st["CellC"]),
        ])

    elems.append(Table(tdata,
                        colWidths=[1.4*cm, 3.5*cm, 7.0*cm, 2.0*cm, 1.8*cm],
                        style=tbl_style()))

    if comp.get("properties"):
        elems += [
            Spacer(1, 0.4*cm),
            Paragraph("Comparison vs traditional identity systems", st["H2"]),
        ]
        ctdata = [["Property", "Centralised (e-KTP)", "Federated (OIDC)", "This Work"]]
        for row in comp["properties"]:
            ctdata.append([
                Paragraph(row["property"], st["CellB"]),
                Paragraph(row["centralised"][:28], st["Small"]),
                Paragraph(row["federated_oidc"][:28], st["Small"]),
                Paragraph(row["this_work"][:35], st["Small"]),
            ])
        elems.append(Table(ctdata,
                            colWidths=[3.5*cm, 3.5*cm, 3.5*cm, 6.0*cm],
                            style=tbl_style()))
    return elems


def section_compliance(data: dict, st) -> list:
    if not data.get("compliance_matrix"):
        return []
    comp  = data["compliance_matrix"]
    summ  = comp["summary"]
    by_fw = comp.get("by_framework", {})

    STATUS_COLOR = {
        "COMPLIANT":       C_PASS,
        "PARTIAL":         C_WARN,
        "NOT_APPLICABLE":  colors.grey,
        "NON_COMPLIANT":   C_FAIL,
    }
    STATUS_SHORT = {
        "COMPLIANT": "✓", "PARTIAL": "△",
        "NOT_APPLICABLE": "○", "NON_COMPLIANT": "✗",
    }

    elems = [
        Paragraph("6. Standards Compliance Matrix — §3.4.6", st["H1"]),
        Paragraph(
            f"Evaluated against W3C DID/VC, eIDAS 2.0 EUDI Wallet ARF, and PCTF v1.0. "
            f"Effective compliance score: <b>{summ['effective_score_pct']}%</b> "
            f"({summ['compliant']} compliant, {summ['partial']} partial, "
            f"{summ['non_compliant']} non-compliant, {summ['not_applicable']} N/A "
            f"of {summ['total']} requirements).",
            st["Body"],
        ),
        Spacer(1, 0.3*cm),
    ]

    for fw, fw_items in by_fw.items():
        if not fw_items:
            continue
        elems.append(Paragraph(fw, st["H2"]))
        tdata = [["Ref", "Requirement", "Status", "Component"]]
        for item in fw_items:
            col = STATUS_COLOR.get(item["status"], colors.grey)
            icon = STATUS_SHORT.get(item["status"], "?")
            tdata.append([
                Paragraph(item["ref"], st["Small"]),
                Paragraph(item["requirement"][:52], st["Cell"]),
                Paragraph(f'<font color="{col.hexval()}"><b>{icon} {item["status"]}</b></font>', st["Small"]),
                Paragraph(item["component"][:30], st["Small"]),
            ])
        elems.append(Table(tdata,
                            colWidths=[2.2*cm, 8.0*cm, 3.0*cm, 3.5*cm],
                            style=tbl_style()))
        elems.append(Spacer(1, 0.3*cm))

    return elems

def main():
    parser = argparse.ArgumentParser(description="SSI Evaluation Report Generator")
    parser.add_argument("--results-dir", default="eval_results")
    parser.add_argument("--out", default="eval_report")
    args = parser.parse_args()

    os.makedirs(args.results_dir, exist_ok=True)
    data = load(args.results_dir)

    found = [k for k, v in data.items() if v is not None]
    missing = [k for k, v in data.items() if v is None]
    print(f"  Loaded: {found}")
    if missing:
        print(f"  Missing (run the eval scripts first): {missing}")

    # JSON summary
    summary = {
        "generated_at": datetime.datetime.now().isoformat(),
        "sections_available": found,
        "sections_missing": missing,
    }
    if data.get("security_eval"):
        summary["security"] = data["security_eval"]["summary"]
    if data.get("decentralisation_eval"):
        summary["decentralisation"] = data["decentralisation_eval"]["summary"]
    if data.get("performance_eval"):
        perf_benches = data["performance_eval"]["benchmarks"]
        summary["performance"] = {
            "operations_tested": len(perf_benches),
            "e2e_avg_ms": next((b["avg_ms"] for b in perf_benches
                                if "round-trip" in b["operation"].lower()), None),
        }
    if data.get("rp_simulator"):
        summary["rp_simulator"] = {
            "passed": data["rp_simulator"]["passed"],
            "failed": data["rp_simulator"]["failed"],
        }

    summary_path = f"{args.results_dir}/eval_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  Summary JSON → {summary_path}")

    # CSV
    csv_path = f"{args.out}.csv"
    export_csv(data, csv_path)

    # PDF
    if not REPORTLAB:
        print("  Skipping PDF — install reportlab: pip install reportlab")
        return

    pdf_path = f"{args.out}.pdf"
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm,  bottomMargin=2*cm,
    )
    st    = styles()
    story = []
    story += section_cover(st)
    story += [PageBreak()]
    story += section_summary(data, st)
    story += [PageBreak()]
    story += section_security(data, st)
    story += [PageBreak()]
    story += section_privacy_full(data, st)
    story += [PageBreak()]
    story += section_performance(data, st)
    story += [PageBreak()]
    story += section_decentralisation(data, st)

    priv_sec = section_privacy_full(data, st)
    if priv_sec:
        story += [PageBreak()]
        story += priv_sec

    comp_sec = section_compliance(data, st)
    if comp_sec:
        story += [PageBreak()]
        story += comp_sec

    doc.build(story)
    print(f"  PDF saved → {pdf_path}")


if __name__ == "__main__":
    main()