"""
Phase 8: version-aware search for finance questions (travel and expenses).

The finance collection holds several versions of the same rules: yearly government rate
circulars that replace each other, AU guidance pages, a synthetic test policy in four
versions, and FAQ decisions that may have gone stale. data/finance/sources.json records
for each document its family (what it is a version of), when it was published, from when it
applies, and what it replaces.

Four systems, so the thesis can compare them on the same questions, documents, embeddings,
LLM and retrieval budget. Only the choice of which document versions may be searched differs:

  plain           every version of everything (conventional RAG)
  newest          per family, only the most recently published version (the obvious shortcut)
  versioned       per family, the version that applies to the date in question; a question
                  about a named document or "what did it say on <date>" gets that version
  versioned_faq   versioned + FAQ check: an FAQ answer based on a rule that has changed since
                  is taken out of the evidence and reported as outdated instead
"""

import json
import os
import re
from datetime import date

import numpy as np

import rag

SYSTEMS = ("plain", "newest", "versioned", "versioned_faq")
# Real documents (AU, government) and the synthetic test policy are never searched together,
# so a real question can never be answered from made-up rules.
CORPORA = ("real", "synthetic")
DEFAULT_SYSTEM = "versioned_faq"
TOP_K = int(os.getenv("FINANCE_TOP_K", "8"))


# ---------------------------------------------------------------- documents

def load_documents() -> dict[str, dict]:
    """Document id -> its entry in sources.json."""
    if not rag.FINANCE_SOURCES.exists():
        return {}
    return {d["id"]: d for d in json.loads(rag.FINANCE_SOURCES.read_text(encoding="utf-8"))["documents"]}


def _d(s) -> date | None:
    return date.fromisoformat(s) if s else None


class FinanceIndex:
    """The finance search index plus what version-aware search needs to know about each document."""

    def __init__(self, index: rag.Index):
        self.index = index
        self.docs = load_documents()
        by_file = {d["file"]: d for d in self.docs.values()}
        self.doc_of = []  # chunk position -> document id
        for c in index.chunks:
            doc = by_file.get(c["file"])
            self.doc_of.append(doc["id"] if doc else None)
        self.families: dict[str, list[dict]] = {}
        for d in self.docs.values():
            if any(i is not None and self.doc_of[i] == d["id"] for i in range(len(self.doc_of))):
                self.families.setdefault(d["family"], []).append(d)
        # rule texts per policy version, to see whether a rule changed: (doc id, rule id) -> text
        self.rule_text = {}
        for c, doc_id in zip(index.chunks, self.doc_of):
            if c.get("rule_id") and c.get("rule_text") and doc_id:
                self.rule_text[(doc_id, c["rule_id"])] = " ".join(c["rule_text"].split())

    # ---- which document versions may be searched

    @staticmethod
    def _applies(doc: dict) -> date | None:
        return _d(doc.get("effective_from")) or _d(doc.get("published_at"))

    def version_for(self, family: str, ctx: dict) -> list[dict]:
        """The version(s) of one family that a question with this context should be answered from."""
        docs = self.families.get(family, [])
        if len(docs) <= 1:
            return docs
        if ctx.get("doc_ref"):
            named = [d for d in docs if d["id"].lower() == str(ctx["doc_ref"]).lower()
                     or str(d.get("version", "")).lower() == str(ctx["doc_ref"]).lower()]
            if named:
                return named
        if ctx.get("as_published_on"):
            # what someone could read on that day: the newest version published by then
            day = _d(ctx["as_published_on"])
            seen = [d for d in docs if _d(d.get("published_at")) and _d(d["published_at"]) <= day]
            return [max(seen, key=lambda d: d["published_at"])] if seen else []
        # the version that applies to the date of the event (default: today), as known now:
        # among versions in force by that date, the most recently published one. So a later
        # correction that applies back to an earlier date wins over the version it corrects.
        day = _d(ctx.get("event_date")) or date.today()
        in_force = [d for d in docs if self._applies(d) and self._applies(d) <= day]
        if not in_force:
            return []
        return [max(in_force, key=lambda d: (d.get("published_at") or "", d.get("effective_from") or ""))]

    def allowed_docs(self, system: str, ctx: dict, corpus: str = "real") -> set[str]:
        if system not in SYSTEMS:
            raise ValueError(f"Unknown system {system!r}; use one of {SYSTEMS}")
        if corpus not in CORPORA:
            raise ValueError(f"Unknown corpus {corpus!r}; use one of {CORPORA}")
        allowed = set()
        for family, docs in self.families.items():
            if bool(docs[0].get("synthetic")) != (corpus == "synthetic"):
                continue
            if system == "plain" or len(docs) == 1:
                allowed |= {d["id"] for d in docs}
            elif system == "newest":
                allowed.add(max(docs, key=lambda d: d.get("published_at") or "")["id"])
            else:
                allowed |= {d["id"] for d in self.version_for(family, ctx)}
        return allowed

    # ---- search

    def search(self, query: str, ctx: dict, system: str = DEFAULT_SYSTEM, k: int = TOP_K, corpus: str = "real") -> dict:
        allowed = self.allowed_docs(system, ctx, corpus)
        only = [i for i, doc_id in enumerate(self.doc_of) if doc_id in allowed]
        # versioned_faq may drop stale FAQ hits; search a little deeper so the evidence budget stays k
        hits = self.index.search(query, k=k + (4 if system == "versioned_faq" else 0), only=only)
        stale = []
        if system == "versioned_faq":
            kept = []
            for h in hits:
                problem = self.faq_problem(h, ctx) if h.get("faq_id") else None
                (stale if problem else kept).append({**h, **({"stale": problem} if problem else {})})
            hits = kept
        hits = hits[:k]
        for h in hits + stale:
            h["doc"] = self.docs.get(self.doc_of[h["pos"]])
        return {"hits": hits, "stale": stale, "allowed": sorted(allowed)}

    # ---- FAQ check

    def faq_problem(self, hit: dict, ctx: dict) -> dict | None:
        """
        None when the FAQ answer still matches the rule that applies; otherwise why it doesn't.
        An FAQ is tied to a rule (e.g. TR-201) and the policy version it was decided under.
        It is outdated when that rule's text differs in the version that applies now.
        A rule that did not change keeps its FAQ valid, even across versions.
        """
        doc = self.docs.get(self.doc_of[hit["pos"]])
        family = (doc or {}).get("faq_for")
        rule, based_on = hit.get("rule_id"), hit.get("based_on")
        if not family or not rule or not based_on:
            return None
        versions = self.families.get(family, [])
        base = next((d for d in versions if d.get("version") == based_on), None)
        current = self.version_for(family, ctx)  # the version the question is about (by date or by name)
        if not base or not current:
            return None
        current = current[0]
        old, new = self.rule_text.get((base["id"], rule)), self.rule_text.get((current["id"], rule))
        if old == new:
            return None
        return {"faq_id": hit.get("faq_id"), "rule_id": rule, "based_on": based_on,
                "current_version": current.get("version"), "current_doc": current["id"],
                "old_rule": old, "current_rule": new,
                "reason": (f"Decided under {based_on}; rule {rule} reads differently in {current.get('version')}, "
                           f"which applies to the date in question.")}


# ---------------------------------------------------------------- understanding the question

UNDERSTAND_PROMPT = """You prepare a search for questions about university travel and expense rules.
Read the conversation and return JSON with these keys:
- "query": the question as a short standalone English search query (keywords, no filler).
- "query_da": the same in Danish keywords used in Danish government travel circulars
  (e.g. hotel allowance = "hoteldispositionsbeloeb hotelgodtgoerelse", mileage = "kilometergodtgoerelse",
  daily allowance = "dagpenge timepenge", taxi = "taxa"). Use plain ASCII (oe, aa, ae).
- "event_date": the date the expense or trip happens or happened, as YYYY-MM-DD, or null if not stated.
  Only a year given: use YYYY-07-01. Only a month: use the 15th. "today"/"now": null.
- "date_precision": "day", "month", "year" or null.
- "as_published_on": only when the question asks what a document SAID on a past date
  ("what did the rules say on 1 March 2026"), as YYYY-MM-DD; else null.
- "doc_ref": a document the question names, e.g. "006-26" or "v2.0", else null.
Return only the JSON."""

DATE_RE = re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b")
YEAR_RE = re.compile(r"\b(20[12]\d)\b")
DOC_RE = re.compile(r"\b(\d{3}-\d{2})\b|\b(v\d\.\d)\b", re.I)


def understand(messages: list[dict]) -> dict:
    """The search query plus the dates and document the question is about."""
    last = messages[-1]["content"]
    if os.getenv("LLM_API_KEY"):
        convo = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in rag._history(messages))
        resp = rag._client().chat.completions.create(
            model=rag._model(), temperature=0, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": UNDERSTAND_PROMPT},
                      {"role": "user", "content": f"{convo}\nUSER (latest): {last}"}],
        )
        try:
            raw = resp.choices[0].message.content or ""
            ctx = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
            ctx = {k: ctx.get(k) for k in ("query", "query_da", "event_date", "date_precision", "as_published_on", "doc_ref")}
            for k in ("event_date", "as_published_on"):
                if ctx[k] and not DATE_RE.fullmatch(str(ctx[k])):
                    ctx[k] = None
            ctx["query"] = ctx["query"] or last
            return ctx
        except (ValueError, TypeError):
            print("WARNING: could not read the question context, using simple rules")
    # without an LLM: dates and document names found in the message itself
    ctx = {"query": last, "query_da": "", "event_date": None, "date_precision": None, "as_published_on": None, "doc_ref": None}
    if m := DATE_RE.search(last):
        ctx["event_date"], ctx["date_precision"] = m.group(0), "day"
    elif m := YEAR_RE.search(last):
        ctx["event_date"], ctx["date_precision"] = f"{m.group(1)}-07-01", "year"
    if m := DOC_RE.search(last):
        ctx["doc_ref"] = m.group(1) or m.group(2).lower()
    return ctx


def search_text(ctx: dict) -> str:
    return " ".join(x for x in (ctx.get("query"), ctx.get("query_da")) if x)


# ---------------------------------------------------------------- answering

ANSWER_PROMPT = """You help university staff and students with travel and expense rules. Answer ONLY from the
numbered sources. Each source line says what it is: authority, version, dates, and whether it is SYNTHETIC
(a made-up test policy for a research prototype, never real Aarhus University policy).

Rules:
- Cite every claim with [S1], [S2] ... Use only sources that support it.
- Name the version and the date it applies from when it matters, e.g. "(circular 007-26, in force from 1 January 2026)".
- If a source is SYNTHETIC, say so in the answer, e.g. "In the demonstration policy (synthetic) ...".
- The user said the trip or expense date is: {event_date}. If no date was given and the rule changed over time,
  say which date your answer assumes, or ask for the date.
- Amounts are maximum rates under conditions, not automatic entitlements. Mention the condition when the source states one.
- If OUTDATED FAQ entries are listed, do not answer from them. Say that FAQ <id> is outdated and answer from the rule.
- If the sources do not answer the question, say you cannot verify it and suggest contacting the finance office.
  Never guess an amount.
- Sources may be in Danish; answer in English.
- The person asking is: {role}.

Return JSON: {{"answer": "...", "status": "answered" | "depends" | "not_found" | "conflict",
"citations": ["S1", ...], "next_step": "..." or null}}
status: "depends" when the answer needs a condition or date the user did not give; "conflict" when an outdated
FAQ or two sources disagree; "not_found" when the sources do not answer it."""


def source_line(i: int, h: dict) -> str:
    d = h.get("doc") or {}
    parts = [f"[S{i}] {d.get('title', h['file'])}", f"authority: {d.get('authority', '?')}"]
    if d.get("version"):
        parts.append(f"version {d['version']}")
    if d.get("effective_from"):
        parts.append(f"in force from {d['effective_from']}")
    if d.get("published_at"):
        parts.append(f"published {d['published_at']}")
    if h.get("page"):
        parts.append(f"page {h['page']}")
    if h.get("section"):
        parts.append(f"section {h['section']}")
    if d.get("synthetic"):
        parts.append("SYNTHETIC")
    return " | ".join(parts) + "\n" + h["text"]


def answer(messages: list[dict], found: dict, ctx: dict, role: str = "staff member", corpus: str = "real") -> dict | None:
    """The LLM answer, or None when no API key is set (search-only)."""
    if not os.getenv("LLM_API_KEY"):
        return None
    hits, stale = found["hits"], found["stale"]
    sources = "\n\n".join(source_line(i, h) for i, h in enumerate(hits, 1)) or "(no sources found)"
    outdated = "\n".join(
        f"OUTDATED FAQ {s['stale']['faq_id']}: {s['text']}\n  Why: {s['stale']['reason']}\n"
        f"  The rule now reads: {s['stale']['current_rule']}" for s in stale)
    prompt = ANSWER_PROMPT.format(event_date=ctx.get("event_date") or "not given", role=role)
    if corpus == "synthetic":
        prompt += ("\nAll sources here are the SYNTHETIC demonstration policy and its FAQ. Start the answer with "
                   "'In the demonstration policy (synthetic test data),'.")
    resp = rag._client().chat.completions.create(
        model=rag._model(), temperature=0.1, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": prompt}, *rag._history(messages),
                  {"role": "user", "content": f"QUESTION: {messages[-1]['content']}\n\nSOURCES:\n{sources}"
                                              + (f"\n\nOUTDATED FAQ ENTRIES (do not use as the answer):\n{outdated}" if outdated else "")}],
    )
    raw = resp.choices[0].message.content or ""
    try:
        data = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
    except ValueError:
        data = {"answer": raw.strip(), "status": "answered", "citations": []}
    valid = {f"S{i}" for i in range(1, len(hits) + 1)}
    data["answer"] = str(data.get("answer", "")).strip()
    data["citations"] = [c for c in dict.fromkeys(data.get("citations") or []) if c in valid]
    if data.get("status") not in ("answered", "depends", "not_found", "conflict"):
        data["status"] = "answered"
    return data


def citation(i: int, h: dict) -> dict:
    """What the web app shows for a source: never invented, all from sources.json and the chunk."""
    d = h.get("doc") or {}
    url = d.get("url")
    if url and h.get("page") and url.lower().endswith(".pdf"):
        url = f"{url}#page={h['page']}"
    return {"id": f"S{i}", "title": d.get("title", h["file"]), "doc_id": d.get("id"), "version": d.get("version"),
            "authority": d.get("authority"), "synthetic": bool(d.get("synthetic")),
            "published_at": d.get("published_at"), "effective_from": d.get("effective_from"),
            "captured_at": d.get("captured_at"), "page": h.get("page"), "section": h.get("section"),
            "url": url, "snippet": h["text"][:400], "score": h.get("score")}


def stale_entry(s: dict) -> dict:
    return {"faq_id": s["stale"]["faq_id"], "rule_id": s["stale"]["rule_id"], "based_on": s["stale"]["based_on"],
            "current_version": s["stale"]["current_version"], "reason": s["stale"]["reason"],
            "faq_text": s["text"], "current_rule": s["stale"]["current_rule"],
            "synthetic": bool((s.get("doc") or {}).get("synthetic"))}


# ---------------------------------------------------------------- admin overview

def overview(fi: "FinanceIndex | None") -> dict:
    """For the admin page: every listed document with its status today, and every FAQ entry with its review status."""
    today = date.today()
    docs = load_documents()
    indexed = set(fi.doc_of) if fi else set()
    chunks_per_doc: dict[str, int] = {}
    for d in (fi.doc_of if fi else []):
        chunks_per_doc[d] = chunks_per_doc.get(d, 0) + 1
    current = set()
    if fi:
        for family in fi.families:
            current |= {d["id"] for d in fi.version_for(family, {})}
    rows = []
    for d in docs.values():
        if d["id"] not in indexed:
            status = "file missing"
        elif d["id"] in current:
            status = "in force" if len(fi.families.get(d["family"], [])) > 1 else "current"
        elif FinanceIndex._applies(d) and FinanceIndex._applies(d) > today:
            status = "not yet in force"
        else:
            status = "replaced"
        rows.append({k: d.get(k) for k in ("id", "title", "family", "authority", "version", "synthetic", "language",
                                            "url", "published_at", "effective_from", "captured_at", "supersedes", "note")}
                    | {"status": status, "chunks": chunks_per_doc.get(d["id"], 0)})
    faqs = []
    if fi:
        for i, c in enumerate(fi.index.chunks):
            if not c.get("faq_id"):
                continue
            problem = fi.faq_problem({**c, "pos": i}, {})
            faqs.append({"faq_id": c["faq_id"], "rule_id": c.get("rule_id"), "based_on": c.get("based_on"),
                         "decided_at": c.get("decided_at"), "text": c["text"],
                         "synthetic": bool((docs.get(fi.doc_of[i]) or {}).get("synthetic")),
                         "status": "needs review" if problem else "valid",
                         "current_version": problem["current_version"] if problem else None,
                         "old_rule": problem["old_rule"] if problem else None,
                         "current_rule": problem["current_rule"] if problem else None})
    return {"today": today.isoformat(), "documents": rows, "faqs": faqs}
