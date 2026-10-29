"""
Checks data/supervisors.json and data/students_dummy.json before you ingest.
Changes nothing; it only reports problems.

    python scripts/check_data.py
"""

import json
import sys
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
from rag import SUPERVISOR_POSITIONS  # noqa: E402

SUP = BASE / "data" / "supervisors.json"
STU = BASE / "data" / "students_dummy.json"
TYPES = {"", "business", "engineering", "generalist"}
problems = 0


def problem(msg):
    global problems
    problems += 1
    print(f"  PROBLEM: {msg}")


def check_supervisors():
    print(f"\n{SUP.name}")
    recs = json.loads(SUP.read_text(encoding="utf-8"))
    ids, names = Counter(r.get("id") for r in recs), Counter(r.get("name") for r in recs)
    for k, n in ids.items():
        if n > 1:
            problem(f"duplicate id {k}")
    for k, n in names.items():
        if n > 1:
            problem(f"duplicate name {k}")

    eligible = [r for r in recs if r.get("position") in SUPERVISOR_POSITIONS]
    searchable = [r for r in eligible if r.get("interests")]
    print(f"  {len(recs)} records, {len(eligible)} can supervise, {len(searchable)} searchable")

    for r in eligible:
        if not r.get("interests"):
            print(f"  note: {r['name']} has no interests, so search can't find them")
        for i in r.get("interests") or []:
            if i.count("(") != i.count(")"):
                problem(f"{r['name']}: unbalanced brackets in interest '{i}' (split on a comma inside brackets?)")
        if r.get("type") not in TYPES:
            problem(f"{r['name']}: type '{r.get('type')}' is not one of {sorted(TYPES - {''})}")
        cap = r.get("capacity")
        if cap is not None and not (isinstance(cap, int) and 0 <= cap <= 7):
            problem(f"{r['name']}: capacity {cap} is not a whole number from 0 to 7")

    missing = Counter()
    for r in searchable:
        for f in ("profile_url", "email", "room", "research_group", "type"):
            if not r.get(f):
                missing[f] += 1
    for f, n in missing.items():
        print(f"  missing {f}: {n} of {len(searchable)} searchable")

    labeled = [r for r in searchable if r.get("type") and r.get("research_group")]
    if labeled and all((r["type"], r["research_group"]) in {("business", "AIROD"), ("engineering", "EngTech")}
                       for r in labeled):
        print("  WARNING: every labeled type matches the research group one-to-one "
              "(AIROD = business, EngTech = engineering).\n"
              "           Types should be judged per person from their interests, "
              "and no one is labeled generalist yet.")


def check_students():
    print(f"\n{STU.name}")
    recs = json.loads(STU.read_text(encoding="utf-8"))
    for k, n in Counter(r.get("id") for r in recs).items():
        if n > 1:
            problem(f"duplicate id {k}")
    for r in recs:
        for f in ("id", "name", "programme", "skills", "interest"):
            if not r.get(f):
                problem(f"{r.get('id')}: missing {f}")
        if not r.get("synthetic"):
            problem(f"{r.get('id')}: not marked synthetic")
    print(f"  {len(recs)} students")


if __name__ == "__main__":
    check_supervisors()
    if STU.exists():
        check_students()
    print(f"\n{problems} problem(s) found." if problems else "\nNo problems found.")
    sys.exit(1 if problems else 0)
