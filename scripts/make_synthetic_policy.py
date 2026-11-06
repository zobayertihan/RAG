"""
Writes the synthetic finance test material for Phase 8: four versions of one fictional
travel and expense policy, and fictional FAQ decision records linked to its rules.

    python scripts/make_synthetic_policy.py

Everything here is made up for the thesis experiment and says so on every section.
It is AU-inspired but is NOT Aarhus University policy. All rules, amounts and dates
are fictional. Each rule keeps the same ID (e.g. TR-201) in every version, so a
version-aware system can tell which rules changed and which FAQ answers went stale.

Versions (dates are fictional):
  v1.0  published 2025-03-14, in force from 2025-04-01  baseline
  v2.0  published 2025-08-01, in force from 2025-09-01  taxis need approval, hotel 1,350, all receipts
  v2.1  published 2025-09-15, in force from 2025-09-01  CORRECTION: hotel cap 1,300 (v2.0 had 1,350 by mistake)
  v3.0  published 2026-02-10, in force from 2026-03-01  taxi safety exception, hotel 1,350 + approval above,
                                                         lost-receipt declaration, settle within 30 days
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "finance" / "synthetic"
LABEL = "SYNTHETIC RESEARCH DOCUMENT. NOT AN OFFICIAL AARHUS UNIVERSITY POLICY. All rules, amounts and dates are fictional."
TITLE = "Demonstration Travel and Expense Policy"

VERSIONS = {
    "v1.0": {"published": "2025-03-14", "effective": "2025-04-01"},
    "v2.0": {"published": "2025-08-01", "effective": "2025-09-01"},
    "v2.1": {"published": "2025-09-15", "effective": "2025-09-01"},
    "v3.0": {"published": "2026-02-10", "effective": "2026-03-01"},
}

# rule id -> (title, {version: text}); a version missing from the dict keeps the previous text
RULES = {
    "GEN-101": ("Scope", {
        "v1.0": "This policy applies to employees on official trips in Denmark and abroad. Students are not "
                "covered, except when they travel on behalf of their department with written approval from "
                "the head of department before the trip.",
    }),
    "TR-201": ("Taxis", {
        "v1.0": "Taxi fares on official trips are reimbursed when the trip is work-related and a receipt is "
                "submitted with the settlement.",
        "v2.0": "Taxis may only be used with prior approval from the budget holder when public transport is "
                "available for the journey. When no reasonable public transport is available, no approval is "
                "needed, but the settlement must explain why a taxi was necessary. A receipt is always required.",
        "v3.0": "Taxis generally require prior approval from the budget holder when public transport is "
                "available for the journey. Exception: no prior approval is needed when public transport is "
                "considered unsafe, or for journeys between 23:00 and 06:00. The reason must be written in the "
                "settlement. A receipt is always required.",
    }),
    "AC-301": ("Hotels in Denmark", {
        "v1.0": "Hotel costs in Denmark are reimbursed up to DKK 1,200 per night, including breakfast.",
        "v2.0": "Hotel costs in Denmark are reimbursed up to DKK 1,350 per night, including breakfast.",
        "v2.1": "Hotel costs in Denmark are reimbursed up to DKK 1,300 per night, including breakfast.",
        "v3.0": "Hotel costs in Denmark are reimbursed up to DKK 1,350 per night, including breakfast. A more "
                "expensive hotel requires approval from the head of department before booking.",
    }),
    "EX-401": ("Receipts", {
        "v1.0": "Receipts are required for every expense above DKK 100. Expenses of DKK 100 or less can be "
                "claimed without a receipt if they are listed in the settlement.",
        "v2.0": "Receipts are required for every expense, whatever the amount.",
        "v3.0": "Receipts are required for every expense. If a receipt is lost, the employee may submit a signed "
                "declaration describing the expense instead, at most twice per calendar year.",
    }),
    "ME-501": ("Meals without daily allowance", {
        "v1.0": "When no daily allowance is paid, documented meal costs are reimbursed up to DKK 300 per day.",
        "v2.0": "When no daily allowance is paid, documented meal costs are reimbursed up to DKK 350 per day.",
        "v3.0": "When no daily allowance is paid, documented meal costs are reimbursed up to DKK 350 per day. "
                "Meals provided free of charge (for example at a conference) are deducted: breakfast 15%, "
                "lunch 30% and dinner 30% of the daily cap.",
    }),
    "CC-601": ("Payment card", {
        "v1.0": "Employees should pay with the university payment card where possible. Expenses paid with a "
                "personal card are reimbursed through the settlement.",
    }),
    "ST-701": ("Settlement deadline", {
        "v1.0": "The settlement must be submitted within 60 days after the trip ends.",
        "v3.0": "The settlement must be submitted within 30 days after the trip ends. Later settlements require "
                "approval from the budget holder.",
    }),
}

ORDER = list(VERSIONS)
CHANGES = {
    "v1.0": "First version.",
    "v2.0": "TR-201 taxis now need prior approval when public transport is available. AC-301 hotel cap raised. "
            "EX-401 receipts required for all expenses. ME-501 meal cap raised.",
    "v2.1": "Correction of v2.0: the AC-301 hotel cap is DKK 1,300, not DKK 1,350 as printed in v2.0. "
            "Applies from 1 September 2025, the date v2.0 came into force.",
    "v3.0": "TR-201 adds a safety and night exception. AC-301 cap DKK 1,350, more expensive hotels need approval. "
            "EX-401 adds the lost-receipt declaration. ME-501 adds deductions for free meals. "
            "ST-701 settlement deadline shortened to 30 days.",
}


def rule_text(rule: str, version: str) -> str:
    texts = RULES[rule][1]
    current = None
    for v in ORDER[: ORDER.index(version) + 1]:
        current = texts.get(v, current)
    return current


def render(version: str) -> str:
    meta = VERSIONS[version]
    supersedes = ORDER[ORDER.index(version) - 1] if version != "v1.0" else "none"
    lines = [
        f"# {TITLE}, version {version}",
        "",
        f"**{LABEL}**",
        "",
        f"Published: {meta['published']}. In force from: {meta['effective']}. Replaces: {supersedes}.",
        "Issued by: Demonstration Finance Office (fictional).",
        "",
    ]
    for rule, (title, _) in RULES.items():
        lines += [f"## {rule} {title}", "", rule_text(rule, version), ""]
    lines += ["## Revision history", ""]
    for v in ORDER[: ORDER.index(version) + 1]:
        lines.append(f"- {v} (published {VERSIONS[v]['published']}, in force from {VERSIONS[v]['effective']}): {CHANGES[v]}")
    lines.append("")
    return "\n".join(lines)


# Fictional FAQ decisions, each tied to the rule and the policy version it was based on.
FAQS = [
    {"id": "FAQ-001", "decided_at": "2025-04-15", "rule_id": "TR-201", "based_on": "v1.0",
     "question": "Can I take a taxi on an official trip when a bus or train would also work?",
     "answer": "Yes. A work-related taxi is reimbursed when you attach the receipt."},
    {"id": "FAQ-002", "decided_at": "2025-05-20", "rule_id": "AC-301", "based_on": "v1.0",
     "question": "What is the most I can spend on a hotel night in Denmark?",
     "answer": "DKK 1,200 per night, including breakfast."},
    {"id": "FAQ-003", "decided_at": "2025-06-10", "rule_id": "CC-601", "based_on": "v1.0",
     "question": "I paid with my own card. Can I still get the money back?",
     "answer": "Yes. Include the expense in your settlement; the university card is preferred, but a personal card is reimbursed."},
    {"id": "FAQ-004", "decided_at": "2025-10-02", "rule_id": "TR-201", "based_on": "v2.0",
     "question": "My train arrives at 00:30 and buses still run. Can I take a taxi home without approval?",
     "answer": "No. Buses are running, so the taxi needs prior approval from the budget holder."},
    {"id": "FAQ-005", "decided_at": "2025-11-12", "rule_id": "EX-401", "based_on": "v2.0",
     "question": "I lost a receipt. Can the expense still be reimbursed?",
     "answer": "No. Every expense needs a receipt."},
    {"id": "FAQ-006", "decided_at": "2026-03-20", "rule_id": "ST-701", "based_on": "v3.0",
     "question": "How long do I have to submit my travel settlement?",
     "answer": "30 days after the trip ends. After that, the budget holder must approve it."},
    {"id": "FAQ-007", "decided_at": "2025-09-05", "rule_id": "AC-301", "based_on": "v2.0",
     "question": "Has the hotel limit in Denmark gone up?",
     "answer": "Yes. From 1 September 2025 the limit is DKK 1,350 per night, including breakfast."},
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for v in ORDER:
        path = OUT / f"demo-policy-{v.replace('.', '-')}.md"
        path.write_text(render(v), encoding="utf-8")
        print(f"wrote {path.relative_to(OUT.parent.parent.parent)}")
    faq = {"label": LABEL, "source": "Fictional meeting decisions of the Demonstration Finance Office.",
           "entries": FAQS}
    (OUT / "demo-faq.json").write_text(json.dumps(faq, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote data/finance/synthetic/demo-faq.json")


if __name__ == "__main__":
    main()
