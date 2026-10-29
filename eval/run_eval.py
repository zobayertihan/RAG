"""
Measures how well search finds the right supervisors, using eval/supervisor_cases.json.
Search only, no LLM answer, so the same index always gives the same numbers.

    python eval/run_eval.py                    # compare vector, bm25 and hybrid
    python eval/run_eval.py --modes hybrid     # one mode
    python eval/run_eval.py --rewrite          # rewrite each query with the LLM first, as the app does
    python eval/run_eval.py --show iot         # print the top 10 for one case

Every run is saved to eval/results/ with a timestamp, so numbers in the thesis trace back to a run.

Metrics, per case with expected supervisors:
  hit@1   1 if the first result is an expected supervisor, else 0
  good@3  share of the top 3 that are expected, out of what is possible
          (a case with only 2 expected people counts 2 of 2 as perfect)
  recall@10  share of the expected supervisors found anywhere in the top 10
Cases with expected = [] (nobody fits) are not scored; their best score is printed,
which later helps set a "none" threshold. Cases with expected = null are skipped.
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import rag  # noqa: E402

CASES = BASE / "eval" / "supervisor_cases.json"
RESULTS = BASE / "eval" / "results"


def name_of(hit: dict) -> str:
    return hit["text"].split(";")[0].removeprefix("Name: ").strip()


def score_case(names: list[str], expected: list[str]) -> dict:
    exp = set(expected)
    top3 = names[:3]
    return {
        "hit@1": 1.0 if names and names[0] in exp else 0.0,
        "good@3": sum(n in exp for n in top3) / min(3, len(exp)),
        "recall@10": sum(n in exp for n in names[:10]) / len(exp),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modes", default="vector,bm25,hybrid")
    ap.add_argument("--rewrite", action="store_true", help="rewrite queries with the LLM first")
    ap.add_argument("--show", help="case id (or part of it) to print in detail")
    args = ap.parse_args()
    modes = [m.strip() for m in args.modes.split(",") if m.strip()]

    doc = json.loads(CASES.read_text(encoding="utf-8"))
    cases = doc["cases"]
    index = rag.Index()
    known = {name_of(c) for c in index.chunks}
    for c in cases:
        for n in c["expected"] or []:
            if n not in known:
                sys.exit(f"Case {c['id']}: '{n}' is not a searchable supervisor. Fix the test set first.")

    queries = {}
    for c in cases:
        q = c["query"]
        if args.rewrite:
            q = rag.search_query([{"role": "user", "content": q}])
        queries[c["id"]] = q

    run = {"time": datetime.now().isoformat(timespec="seconds"), "embed_model": rag.EMBED_MODEL,
           "test_set_version": doc.get("version"), "rewrite": args.rewrite, "modes": {}}

    for mode in modes:
        per_case, totals, n = {}, {"hit@1": 0.0, "good@3": 0.0, "recall@10": 0.0}, 0
        for c in cases:
            hits = index.search(queries[c["id"]], k=10, mode=mode)
            names = [name_of(h) for h in hits]
            row = {"query": queries[c["id"]], "top10": names,
                   "top_cosine": hits[0]["score"] if hits else None,
                   "top_bm25": hits[0]["bm25"] if hits else None}
            if c["expected"]:
                row.update(score_case(names, c["expected"]))
                for k in totals:
                    totals[k] += row[k]
                n += 1
            per_case[c["id"]] = row
        avg = {k: round(v / n, 3) for k, v in totals.items()} if n else {}
        run["modes"][mode] = {"average": avg, "scored_cases": n, "cases": per_case}

    # ---- print summary
    print(f"\nTest set v{doc.get('version')}: {len(cases)} cases"
          f"{' (queries rewritten by the LLM)' if args.rewrite else ''}\n")
    print(f"{'mode':<8}{'hit@1':>8}{'good@3':>9}{'recall@10':>11}   scored cases")
    for mode in modes:
        a = run["modes"][mode]["average"]
        print(f"{mode:<8}{a['hit@1']:>8.2f}{a['good@3']:>9.2f}{a['recall@10']:>11.2f}   {run['modes'][mode]['scored_cases']}")

    print(f"\nPer case (good@3 per mode; '-' = not scored):")
    print(f"{'case':<24}" + "".join(f"{m:>9}" for m in modes))
    for c in cases:
        cells = []
        for m in modes:
            r = run["modes"][m]["cases"][c["id"]]
            cells.append(f"{r['good@3']:>9.2f}" if "good@3" in r else f"{'-':>9}")
        tag = "" if c["expected"] else ("  (none expected)" if c["expected"] == [] else "  (not judged)")
        print(f"{c['id']:<24}" + "".join(cells) + tag)

    none_cases = [c for c in cases if c["expected"] == []]
    if none_cases:
        print("\nCases where nobody should fit: best scores (helps set a 'none' threshold later)")
        for c in none_cases:
            for m in modes:
                r = run["modes"][m]["cases"][c["id"]]
                print(f"  {c['id']:<20} {m:<7} top: {r['top10'][0] if r['top10'] else '-':<32}"
                      f" cosine {r['top_cosine']}  bm25 {r['top_bm25']}")

    if args.show:
        for c in cases:
            if args.show in c["id"]:
                print(f"\n{c['id']}: {queries[c['id']]}\n  expected: {c['expected']}")
                for m in modes:
                    names = run["modes"][m]["cases"][c["id"]]["top10"]
                    marked = [f"{n}{' *' if c['expected'] and n in c['expected'] else ''}" for n in names]
                    print(f"  {m}: " + " | ".join(marked))

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{datetime.now():%Y-%m-%d_%H%M%S}_{'-'.join(modes)}{'_rewrite' if args.rewrite else ''}.json"
    out.write_text(json.dumps(run, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nSaved {out.relative_to(BASE)}")


if __name__ == "__main__":
    main()
