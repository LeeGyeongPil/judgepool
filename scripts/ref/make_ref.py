"""Generate src/core/__fixtures__/ref.json with ir_measures (trec_eval values).

Run from this folder:  uv run python make_ref.py
Development only: the committed ref.json lets the test suite run without Python.
"""
import importlib.metadata as md
import json
import os
from pathlib import Path

# Keep any cache the libraries want inside this folder (sandbox / CI friendly).
HERE = Path(__file__).resolve().parent
os.environ.setdefault("IR_DATASETS_HOME", str(HERE / ".irds"))
os.environ.setdefault("NUMBA_CACHE_DIR", str(HERE / ".numba"))

import ir_measures  # noqa: E402
from ir_measures import P, R, RR, Judged, nDCG  # noqa: E402

ROOT = HERE.parent.parent
FIX = ROOT / "src" / "core" / "__fixtures__"
EXAMPLE = ROOT / "src" / "example"


def measures(k):
    return {
        "ndcg": nDCG @ k,
        "recall": R @ k,
        "precision": P @ k,
        "rr": RR,
        "judged": Judged @ k,
        "recall2": R(rel=2) @ k,
        "precision2": P(rel=2) @ k,
        "rr2": RR(rel=2),
    }


def evaluate(qrels_path, run_path, k):
    qrels = list(ir_measures.read_trec_qrels(str(qrels_path)))
    run = list(ir_measures.read_trec_run(str(run_path)))
    ms = measures(k)
    by_measure = {str(m): name for name, m in ms.items()}
    out = {}
    # ir_measures scores every query in qrels (a query the run lacks gets 0),
    # which is the same as trec_eval -c.  We call that averaging "common".
    agg = ir_measures.calc_aggregate(list(ms.values()), qrels, run)
    out["common"] = {by_measure[str(m)]: round(v, 6) for m, v in agg.items()}
    per_query = {}
    for r in ir_measures.iter_calc(list(ms.values()), qrels, run):
        per_query.setdefault(r.query_id, {})[by_measure[str(r.measure)]] = round(r.value, 6)
    out["per_query"] = per_query
    # trec_eval default: only queries present in both run and qrels.
    in_run = {r.query_id for r in run}
    rows = [v for q, v in per_query.items() if q in in_run]
    out["trec"] = {name: round(sum(v[name] for v in rows) / len(rows), 6) for name in ms}
    # Cross-check "common" by padding missing queries with one unjudged document.
    missing = sorted({x.query_id for x in qrels} - in_run)
    padded = run + [ir_measures.ScoredDoc(q, "__unjudged__", 1.0) for q in missing]
    check = ir_measures.calc_aggregate(list(ms.values()), qrels, padded)
    for m, v in check.items():
        assert abs(v - out["common"][by_measure[str(m)]]) < 1e-6, (run_path, m)
    return out


def read_pairs(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        if line.strip():
            parts = line.split()
            rows.append((parts[0], parts[2]))
    return rows


def example_qrels():
    text = (EXAMPLE / "judgments.jsonl").read_text().splitlines()
    judgments = [json.loads(line) for line in text if line.strip()]
    grade = {(j["query_id"], j["doc_id"]): j["grade"] for j in judgments}
    bm25_docs = set(read_pairs(EXAMPLE / "bm25.run"))

    def write(name, keys):
        lines = [f"{q} 0 {d} {grade[(q, d)]}" for q, d in sorted(keys)]
        (FIX / name).write_text("\n".join(lines) + "\n")

    write("example_biased_qrels.txt", [k for k in grade if k in bm25_docs])
    write("example_full_qrels.txt", list(grade))


def main():
    example_qrels()
    versions = {p: md.version(p) for p in ["ir-measures", "pytrec-eval-terrier"]}
    out = {"versions": versions, "cases": []}
    plan = [
        ("probe-runA", "probe_qrels.txt", FIX / "probe_runA.txt", [3]),
        ("probe-runB", "probe_qrels.txt", FIX / "probe_runB.txt", [3]),
        ("edge", "edge_qrels.txt", FIX / "edge_run.txt", [3, 5]),
    ]
    for scenario in ["biased", "full"]:
        for system in ["bm25", "dense", "hybrid"]:
            plan.append((f"example-{scenario}-{system}", f"example_{scenario}_qrels.txt", EXAMPLE / f"{system}.run", [10]))
    for name, qrels_name, run_path, ks in plan:
        for k in ks:
            res = evaluate(FIX / qrels_name, run_path, k)
            out["cases"].append({"name": name, "qrels": qrels_name, "run": str(run_path.relative_to(ROOT)), "k": k, **res})
    (FIX / "ref.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(versions), len(out["cases"]), "cases written")


if __name__ == "__main__":
    main()
