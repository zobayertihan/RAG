"""
Compares the four finance systems (plain, newest, versioned, versioned_faq) on
eval/finance_cases.json. Same documents, embeddings, retrieval budget and LLM for all four;
only which document versions may be searched differs.

    python eval/run_finance_eval.py                 # search only: deterministic, no LLM, free
    python eval/run_finance_eval.py --answers       # also generate answers with the LLM and check them
    python eval/run_finance_eval.py --understand    # read dates from the question with the LLM
                                                    #   instead of using the gold context
    python eval/run_finance_eval.py --show taxi     # print the evidence for cases whose id contains "taxi"

Search metrics, per case (cases with a rule to find):
  right_version_top   the first evidence passage for the rule comes from an accepted version
  wrong_version_in    evidence holds the same rule from a version whose text differs from the accepted one
                      (an outdated or not-yet-valid rule the LLM could repeat)
  stale_faq_in        evidence holds an FAQ entry that is outdated for the version the case is about
FAQ check (versioned_faq only): precision and recall of the entries it flags, against the hand-written
'faq_gold' table, counted over the FAQ entries that search actually retrieved.
Answer metrics (--answers): every 'expect' text present and no 'forbid' text present.

Every run is saved to eval/results/ so numbers in the thesis trace back to a run.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import finance  # noqa: E402
import rag  # noqa: E402

CASES = BASE / "eval" / "finance_cases.json"
RESULTS = BASE / "eval" / "results"


def norm(text: str) -> str:
    """'DKK 1,350' and '1.350 kr.' both become '...1350...', so number checks don't depend on format."""
    return re.sub(r"(?<=\d)[,.  ](?=\d{3}\b)", "", text).lower()


def evaluate_search(fi: finance.FinanceIndex, case: dict, ctx: dict, system: str) -> dict:
    corpus = "synthetic" if case.get("synthetic") else "real"
    found = fi.search(finance.search_text(ctx), ctx, system=system, corpus=corpus)
    hits, stale = found["hits"], found["stale"]
    doc_ids = [fi.doc_of[h["pos"]] for h in hits]
    rule = case.get("rule_id") or case.get("annex")  # synthetic: rule ID; real circulars: annex ("Bilag 5")
    accept = set(case["accept"])
    row = {"evidence": [f"{d}#{h.get('faq_id') or h.get('rule_id') or h.get('annex') or 'p' + str(h.get('page'))}"
                        for d, h in zip(doc_ids, hits)],
           "flagged": [s["stale"]["faq_id"] for s in stale],
           "kept_faqs": [h["faq_id"] for h in hits if h.get("faq_id")]}
    if rule:
        rule_hits = [(d, h) for d, h in zip(doc_ids, hits)
                     if (h.get("rule_id") == rule or h.get("annex") == rule) and not h.get("faq_id")]
        accepted_texts = {fi.rule_text.get((a, rule)) for a in accept}
        row["right_version_top"] = bool(rule_hits) and rule_hits[0][0] in accept if accept else not rule_hits
        # a passage for this rule from a version that isn't accepted; for the synthetic policy, only
        # counted when its text differs (an unchanged rule may come from any version)
        row["wrong_version_in"] = any(
            d not in accept and (case.get("annex") or fi.rule_text.get((d, rule)) not in accepted_texts)
            for d, _ in rule_hits)
        row["rule_found"] = any(d in accept for d, _ in rule_hits)
    gold_stale = set(gold_faqs(case))
    used_faqs = {h.get("faq_id") for h in hits if h.get("faq_id")}
    row["stale_faq_in"] = bool(used_faqs & gold_stale)
    row["_found"] = found
    return row


FAQ_GOLD: dict = {}


def gold_faqs(case: dict) -> list[str]:
    """Outdated FAQ entries for the policy version the case is about (hand-written table)."""
    return FAQ_GOLD.get(case.get("version") or "none", [])


def check_answer(text: str, case: dict) -> dict:
    """An 'expect' item may be a list of alternatives (e.g. ["2.23", "2,23"]): one of them must appear."""
    t = norm(text)
    missing = [e for e in case["expect"] if not any(norm(x) in t for x in (e if isinstance(e, list) else [e]))]
    present = [f for f in case["forbid"] if norm(f) in t]
    return {"ok": not missing and not present, "missing": missing, "forbidden_present": present}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--systems", default=",".join(finance.SYSTEMS))
    ap.add_argument("--answers", action="store_true", help="also generate and check answers (uses the LLM)")
    ap.add_argument("--understand", action="store_true", help="read dates with the LLM instead of the gold context")
    ap.add_argument("--show", help="print evidence for cases whose id contains this")
    ap.add_argument("--include-unchecked", action="store_true",
                    help="also score cases marked needs_check (answers not yet confirmed by a person)")
    args = ap.parse_args()
    systems = [s.strip() for s in args.systems.split(",") if s.strip()]

    doc = json.loads(CASES.read_text(encoding="utf-8"))
    FAQ_GOLD.update(doc.get("faq_gold") or {})
    # build (or update) the finance index here, so this works even while FINANCE_ENABLED is off in the app
    rag.build_index(("finance",))
    fi = finance.FinanceIndex(rag.Index("finance"))
    known = set(fi.doc_of)
    cases = [c for c in doc["cases"] if (not c["accept"] or set(c["accept"]) & known)
             and (args.include_unchecked or not c.get("needs_check"))]
    unchecked = sum(1 for c in doc["cases"] if c.get("needs_check") and not args.include_unchecked)
    skipped = len(doc["cases"]) - len(cases) - unchecked

    run = {"time": datetime.now().isoformat(timespec="seconds"), "embed_model": rag.EMBED_MODEL_FINANCE,
           "test_set_version": doc.get("version"), "understand": args.understand, "answers": args.answers,
           "systems": {}}
    contexts = {}
    for c in cases:
        if args.understand:
            ctx = finance.understand([{"role": "user", "content": c["question"]}])
        else:
            # gold dates: the LLM still writes the search words (English + Danish) when a key is set,
            # but the dates and named document come from the test case, as a person reads them
            base = (finance.understand([{"role": "user", "content": c["question"]}]) if os.getenv("LLM_API_KEY")
                    else {"query": c["question"], "query_da": ""})
            ctx = {"query": base.get("query") or c["question"], "query_da": base.get("query_da") or "",
                   "event_date": None, "date_precision": None, "as_published_on": None, "doc_ref": None, **c["context"]}
        contexts[c["id"]] = ctx

    for system in systems:
        rows = {}
        for c in cases:
            ctx = contexts[c["id"]]
            row = evaluate_search(fi, c, ctx, system)
            if args.answers:
                data = finance.answer([{"role": "user", "content": c["question"]}], row["_found"], ctx,
                                      corpus="synthetic" if c.get("synthetic") else "real")
                row["answer"] = data and data["answer"]
                row["status"] = data and data["status"]
                row["answer_check"] = check_answer(row["answer"] or "", c) if data else None
            row.pop("_found")
            rows[c["id"]] = row
        def rate(group, key):
            g = [c for c in group if key in rows[c["id"]]]
            return round(sum(rows[c["id"]][key] for c in g) / len(g), 3) if g else None
        summary = {}
        for label, group in (("all", cases), ("real", [c for c in cases if not c.get("synthetic")]),
                             ("synthetic", [c for c in cases if c.get("synthetic")])):
            summary[label] = {"cases": len(group), "right_version_top": rate(group, "right_version_top"),
                              "wrong_version_in": rate(group, "wrong_version_in"),
                              "stale_faq_in": rate(group, "stale_faq_in")}
        if system == "versioned_faq":
            tp = fp = fn = 0
            for c in cases:
                gold, flagged = set(gold_faqs(c)), set(rows[c["id"]]["flagged"])
                kept_faqs = set(rows[c["id"]]["kept_faqs"])
                retrieved_gold = gold & (flagged | kept_faqs)  # outdated entries search actually met
                tp += len(flagged & gold)
                fp += len(flagged - gold)
                fn += len(retrieved_gold - flagged)
            summary["faq_check_precision"] = round(tp / (tp + fp), 3) if tp + fp else None
            summary["faq_check_recall"] = round(tp / (tp + fn), 3) if tp + fn else None
        if args.answers:
            checked = [rows[c["id"]]["answer_check"] for c in cases if rows[c["id"]].get("answer_check")]
            for label in ("all", "real", "synthetic"):
                grp = [rows[c["id"]]["answer_check"] for c in cases if rows[c["id"]].get("answer_check")
                       and (label == "all" or bool(c.get("synthetic")) == (label == "synthetic"))]
                summary[label]["answer_ok"] = round(sum(a["ok"] for a in grp) / len(grp), 3) if grp else None
        run["systems"][system] = {"summary": summary, "cases": rows}

    # ---- print
    print(f"\nFinance test set v{doc.get('version')}: {len(cases)} cases"
          + (f" ({skipped} skipped: their documents are not indexed yet)" if skipped else "")
          + (f" ({unchecked} not scored: answer not yet confirmed, see needs_check)" if unchecked else "")
          + (" | dates read by the LLM" if args.understand else " | gold dates"))
    cols = ["right_version_top", "wrong_version_in", "stale_faq_in"] + (["answer_ok"] if args.answers else [])
    for label in ("real", "synthetic"):
        n = run["systems"][systems[0]]["summary"][label]["cases"]
        if not n:
            continue
        print(f"\n{label.upper()} documents ({n} cases)")
        print(f"{'system':<15}" + "".join(f"{c:>19}" for c in cols))
        for s in systems:
            sm = run["systems"][s]["summary"][label]
            print(f"{s:<15}" + "".join(f"{(sm.get(c) if sm.get(c) is not None else '-'):>19}" for c in cols))
    if "versioned_faq" in run["systems"]:
        sm = run["systems"]["versioned_faq"]["summary"]
        print(f"\nFAQ check (versioned_faq): precision {sm['faq_check_precision']}, recall {sm['faq_check_recall']}")
    print("\nright_version_top: higher is better. wrong_version_in and stale_faq_in: lower is better.")

    print(f"\nPer case: right version on top (wrong version in evidence)")
    print(f"{'case':<22}" + "".join(f"{s:>16}" for s in systems))
    for c in cases:
        cells = []
        for s in systems:
            r = run["systems"][s]["cases"][c["id"]]
            if "right_version_top" in r:
                cells.append(f"{('yes' if r['right_version_top'] else 'NO') + (' (wrong)' if r['wrong_version_in'] else ''):>16}")
            else:
                cells.append(f"{'-':>16}")
        print(f"{c['id']:<22}" + "".join(cells))

    if args.show:
        for c in cases:
            if args.show in c["id"]:
                print(f"\n{c['id']}: {c['question']}\n  context: {contexts[c['id']]}\n  accept: {c['accept']}")
                for s in systems:
                    r = run["systems"][s]["cases"][c["id"]]
                    print(f"  {s}: {' | '.join(r['evidence'])}" + (f"  FLAGGED {r['flagged']}" if r["flagged"] else ""))
                    if r.get("answer"):
                        print(f"     answer: {r['answer'][:300]}\n     check: {r['answer_check']}")

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{datetime.now():%Y-%m-%d_%H%M%S}_finance{'_answers' if args.answers else ''}{'_understand' if args.understand else ''}.json"
    out.write_text(json.dumps(run, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"\nSaved {out.relative_to(BASE)}")


if __name__ == "__main__":
    main()
