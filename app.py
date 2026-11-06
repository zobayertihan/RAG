"""
Web server. Start with:

    uvicorn app:app --reload

then open http://127.0.0.1:8000

Public:
  POST /api/chat            the student chat (used by the current page)
  GET  /api/health          what is loaded

Service endpoints (for the Next.js app, Phase 4 onwards). They need the header
X-Service-Key with the value of SERVICE_KEY from .env, and are switched off when
SERVICE_KEY is not set:
  POST /api/reindex/supervisors       save one supervisor record and update search
  DELETE /api/reindex/supervisors/{id}  remove one supervisor from search
  POST /api/summarize-note            two-sentence summary of a student's note
  POST /api/draft-email               accept / agree-to-meet / reject / ask-for-details email draft
  POST /api/query-gaps                group weak student queries into topics, with today's best match
  GET  /api/finance/overview          finance documents and FAQ review status (admin page)
  POST /api/search-supervisors        supervisors matching a text, search only (coordinator suggestions)
  POST /api/parse-staff-pdf           read a staff list PDF into supervisor rows (admin upload, no saving)

/api/chat with mode "finance" answers travel and expense questions with version-aware search
(Phase 8, see finance.py). It accepts "system" (plain, newest, versioned, versioned_faq) and "role".
"""

import hmac
import json
import os
import threading
import urllib.request
from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import finance
import staffpdf
from rag import (BASE_DIR, COLLECTIONS, FINANCE_DIR, FINANCE_ENABLED, GROUP_SIMILARITY, Index, answer, draft_email,
                 group_queries, history_text, missing_finance_files, record_to_chunk, save_supervisor_record, search_query, summarize_note)

app = FastAPI(title="Supervisor Finder")

# Lets a page hosted elsewhere (e.g. GitHub Pages) call this API.
# Set ALLOWED_ORIGINS on the host, e.g. https://zobayertihan.github.io
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST"], allow_headers=["Content-Type"])

# One index per collection. Supervisors must exist; finance only once its PDFs are added.
indexes = {name: Index(name) for name in COLLECTIONS if Index.exists(name)}
if "supervisors" not in indexes:
    raise RuntimeError("No supervisor index. Run: python ingest.py")
# Finance (Phase 8): version-aware search over the documents listed in data/finance/sources.json
fin = finance.FinanceIndex(indexes["finance"]) if "finance" in indexes else None

SEARCH_ONLY_SHOWN = 3  # sources shown when there's no LLM to pick them

# ---------------------------------------------------------------- startup sync (deployed setup)
# On a free host the disk is wiped on every restart, so profile edits saved here would be lost.
# When WEB_URL is set, the search index is brought up to date from the web app's database at
# startup instead: the database is the one source of truth, supervisors.json only the seed.
sync_status = {"state": "off", "at": None, "changed": 0, "detail": None}


def sync_from_web():
    web, key = os.getenv("WEB_URL", "").rstrip("/"), os.getenv("SERVICE_KEY", "")
    if not web or not key:
        return
    sync_status["state"] = "running"
    try:
        req = urllib.request.Request(f"{web}/service/supervisors", headers={"X-Service-Key": key})
        with urllib.request.urlopen(req, timeout=120) as res:
            records = json.loads(res.read())["records"]
        index, changed, seen = indexes["supervisors"], 0, set()
        current = {c.get("record_id"): c["text"] for c in index.chunks}
        for r in records:
            chunk, _ = record_to_chunk(r)
            if chunk:
                seen.add(r["id"])
                if current.get(r["id"]) != chunk["text"]:
                    index.upsert(chunk)
                    changed += 1
            elif index.remove(r["id"]):
                changed += 1
        sync_status.update(state="done", changed=changed, detail=f"{len(records)} records, {len(index.chunks)} searchable")
    except Exception as e:  # the web app may be asleep or down: search keeps the built-in data
        sync_status.update(state="failed", detail=str(e)[:200])
    sync_status["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"Startup sync: {sync_status}")


@app.on_event("startup")
def start_sync():
    threading.Thread(target=sync_from_web, daemon=True).start()


# ---------------------------------------------------------------- chat


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class Filters(BaseModel):
    position: list[str] = []
    research_group: list[str] = []
    type: list[str] = []


class Chat(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)
    mode: Literal["supervisors", "finance"] = "supervisors"  # old clients send no mode: supervisors
    filters: Filters | None = None
    # finance only: which of the four systems to use (the thesis compares them), and who asks
    system: Literal["plain", "newest", "versioned", "versioned_faq"] = finance.DEFAULT_SYSTEM
    role: Literal["student", "staff"] = "staff"
    corpus: Literal["real", "synthetic"] = "real"  # real documents, or the synthetic demonstration policy


@app.post("/api/chat")
def chat(body: Chat):
    messages = [m.model_dump() for m in body.messages]
    if messages[-1]["role"] != "user":
        raise HTTPException(400, "Last message must be from the user")
    if body.mode == "finance":
        return finance_chat(messages, body)
    index = indexes[body.mode]
    filters = body.filters.model_dump() if body.filters else None
    try:
        query = search_query(messages)
        hits = index.search(query, filters=filters)
        if not hits:  # the filters leave nobody: say so without asking the LLM
            return {"mode": body.mode, "message": "No supervisors match those filters. Try removing one.",
                    "supervisors": [], "mentions": [], "query": query, "best_score": None,
                    "history": "(no supervisors matched the filters)", "matches": []}
        # what search found, shown in the server terminal (not to students)
        print(f"\nQUERY: {query}" + (f"  FILTERS: {filters}" if filters else ""))
        for i, h in enumerate(hits, 1):
            print(f"  S{i} {h['score']:.3f}  {h['text'][:90]}")
        data = answer(messages, hits)
    except Exception as e:  # bad key, wrong model name, rate limit...
        raise HTTPException(502, f"LLM call failed: {e}")

    sources = {
        f"S{i}": {"file": h["file"], "page": h["page"], "score": h["score"],
                  "emails": h["emails"], "urls": h["urls"], "snippet": h["text"][:400],
                  "room": h.get("room", ""), "research_group": h.get("research_group", ""),
                  "updated_at": h.get("updated_at"), "record_id": h.get("record_id"),
                  "position": h.get("position", ""), "capacity": h.get("capacity")}
        for i, h in enumerate(hits, 1)
    }
    best_score = hits[0]["score"] if hits else None
    if data is None:  # no API key: show the best raw matches
        return {"mode": body.mode, "message": None, "supervisors": [], "query": query, "best_score": best_score,
                "history": history_text(None),
                "matches": [{"id": k, **v} for k, v in list(sources.items())[:SEARCH_ONLY_SHOWN]]}

    # attach page, links and emails from the data itself, never from the LLM
    cards = [{**c, **sources[c["source"]]} for c in data["supervisors"]]
    carded = {c["source"] for c in cards}
    # people discussed in a follow-up paragraph: name + profile link, taken from the data
    mentions = [{"name": hits[int(m[1:]) - 1]["text"].split(";")[0].split("\n")[0].removeprefix("Name: ")[:60], **sources[m]}
                for m in data["mentions"] if m not in carded]
    return {"mode": body.mode, "message": data["message"], "supervisors": cards, "mentions": mentions,
            "others": others(hits, sources, carded | set(data["mentions"])),
            "query": query, "best_score": best_score, "history": history_text(data), "matches": []}


def others(hits: list[dict], sources: dict, used: set[str]) -> list[dict]:
    """The other search matches, in order, so the web app can offer alternatives when a supervisor is full."""
    return [{"source": f"S{i}", "name": _name(h), **sources[f"S{i}"]}
            for i, h in enumerate(hits, 1) if f"S{i}" not in used]


def finance_chat(messages: list[dict], body: Chat) -> dict:
    if not FINANCE_ENABLED:
        raise HTTPException(404, "Travel and expense questions are switched off (FINANCE_ENABLED in rag.py).")
    if fin is None:
        raise HTTPException(503, "The finance documents are not indexed yet. Run: python ingest.py")
    try:
        ctx = finance.understand(messages)
        found = fin.search(finance.search_text(ctx), ctx, system=body.system, corpus=body.corpus)
        print(f"\nFINANCE [{body.system}, {body.corpus}] {finance.search_text(ctx)}  context: "
              f"{ {k: v for k, v in ctx.items() if k not in ('query', 'query_da') and v} }")
        for i, h in enumerate(found["hits"], 1):
            print(f"  S{i} {h['score']:.3f}  {(h.get('doc') or {}).get('id')}  {h['text'][:70]!r}")
        for s in found["stale"]:
            print(f"  OUTDATED {s['stale']['faq_id']}: {s['stale']['reason']}")
        data = finance.answer(messages, found, ctx, "student" if body.role == "student" else "staff member", body.corpus)
    except Exception as e:
        raise HTTPException(502, f"LLM call failed: {e}")
    hits = found["hits"]
    citations = [finance.citation(i, h) for i, h in enumerate(hits, 1)]
    best = hits[0]["score"] if hits else None
    if data is None:  # no LLM key: show what search found
        return {"mode": "finance", "system": body.system, "corpus": body.corpus, "message": None, "status": "search_only",
                "citations": citations[:3], "stale_faqs": [finance.stale_entry(s) for s in found["stale"]],
                "context": ctx, "query": finance.search_text(ctx), "best_score": best, "next_step": None,
                "history": "(showed search results)"}
    used = [c for c in citations if c["id"] in data["citations"]]
    return {"mode": "finance", "system": body.system, "corpus": body.corpus, "message": data["answer"], "status": data["status"],
            "citations": used, "stale_faqs": [finance.stale_entry(s) for s in found["stale"]],
            "context": ctx, "query": finance.search_text(ctx), "best_score": best,
            "next_step": data.get("next_step"), "history": data["answer"]}


@app.get("/api/health")
def health():
    return {"collections": {name: len(ix.chunks) for name, ix in indexes.items()}, "sync": sync_status,
            "finance": "on" if FINANCE_ENABLED else "off",
            **({"finance_missing_files": missing_finance_files()} if FINANCE_ENABLED else {})}


# ---------------------------------------------------------------- service endpoints


def require_service_key(x_service_key: str = Header(default="")):
    expected = os.getenv("SERVICE_KEY", "")
    if not expected:
        raise HTTPException(503, "Service endpoints are off. Set SERVICE_KEY in .env to use them.")
    if not hmac.compare_digest(x_service_key, expected):
        raise HTTPException(401, "Wrong or missing X-Service-Key header.")


class SupervisorRecord(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    position: str
    interests: list[str] = []
    profile_url: str = ""
    email: str = ""
    room: str = ""
    research_group: str = ""
    type: Literal["", "business", "engineering", "generalist"] = ""
    requirements: list[str] = []
    capacity: int | None = Field(default=None, ge=0, le=7)


@app.post("/api/reindex/supervisors", dependencies=[Depends(require_service_key)])
def reindex_supervisor(record: SupervisorRecord):
    """
    Saves the record to data/supervisors.json (new version number, today's date) and
    updates search right away, without a restart. A record that is no longer searchable
    (no interests, or a position that can't supervise) is taken out of search.
    """
    saved = save_supervisor_record(record.model_dump())
    chunk, reason = record_to_chunk(saved)
    index = indexes["supervisors"]
    if chunk:
        status = index.upsert(chunk)
    else:
        status = "removed" if index.remove(saved["id"]) else "not searchable"
    return {"status": status, "reason": reason or None, "version": saved["version"],
            "updated_at": saved["updated_at"], "searchable": len(index.chunks)}


@app.delete("/api/reindex/supervisors/{record_id}", dependencies=[Depends(require_service_key)])
def unindex_supervisor(record_id: str):
    """Takes a supervisor out of search (the record stays in supervisors.json)."""
    removed = indexes["supervisors"].remove(record_id)
    return {"status": "removed" if removed else "not found", "searchable": len(indexes["supervisors"].chunks)}


class NoteRequest(BaseModel):
    note: str = Field(min_length=1, max_length=4000)
    supervisor_id: str
    request_type: Literal["discuss", "supervision", ""] = ""


@app.post("/api/summarize-note", dependencies=[Depends(require_service_key)])
def summarize(body: NoteRequest):
    sup = next((c for c in indexes["supervisors"].chunks if c.get("record_id") == body.supervisor_id), None)
    areas = sup["text"].split("Area of interest: ")[-1] if sup else ""
    try:
        summary = summarize_note(body.note, areas, body.request_type)
    except Exception as e:
        raise HTTPException(502, f"LLM call failed: {e}")
    return {"summary": summary}  # null when no LLM key is set


class EmailRequest(BaseModel):
    action: Literal["accept", "accept_discuss", "reject", "ask_details"]
    student_name: str = Field(min_length=1, max_length=200)
    supervisor_name: str = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=4000)
    topic: str = Field(default="", max_length=300)


@app.post("/api/draft-email", dependencies=[Depends(require_service_key)])
def email(body: EmailRequest):
    try:
        return draft_email(body.action, body.student_name, body.supervisor_name, body.note, body.topic)
    except Exception as e:
        raise HTTPException(502, f"LLM call failed: {e}")


class SupervisorSearch(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    k: int = Field(default=8, ge=1, le=20)


@app.post("/api/search-supervisors", dependencies=[Depends(require_service_key)])
def search_supervisors(body: SupervisorSearch):
    """Supervisors that fit a text (e.g. a student's note), search only, no LLM. For the coordinator's suggestions."""
    hits = indexes["supervisors"].search(body.query, k=body.k)
    return {"matches": [{"record_id": h.get("record_id"), "name": _name(h), "position": h.get("position", ""),
                         "research_group": h.get("research_group", ""), "score": h["score"]} for h in hits]}


MAX_PDF_BYTES = 15 * 1024 * 1024


@app.post("/api/parse-staff-pdf", dependencies=[Depends(require_service_key)])
async def parse_staff_pdf(request: Request):
    """
    Reads a staff list PDF (a table with name, position and research areas, like the BTECH list)
    into supervisor rows. Saves nothing: the web app compares the rows with the database and
    shows the admin what is new or changed before anything is saved.
    """
    data = await request.body()
    if not data:
        raise HTTPException(400, "No file.")
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "The PDF is larger than 15 MB.")
    try:
        return staffpdf.parse(data)
    except Exception as e:  # not a PDF, or a damaged one
        raise HTTPException(400, f"The PDF could not be read: {str(e)[:200]}")


class GapRequest(BaseModel):
    queries: list[str] = Field(max_length=2000)
    similarity: float = Field(default=GROUP_SIMILARITY, ge=0.5, le=0.99)


def _name(hit: dict) -> str:
    return hit["text"].split(";")[0].split("\n")[0].removeprefix("Name: ")[:80]


@app.post("/api/query-gaps", dependencies=[Depends(require_service_key)])
def query_gaps(body: GapRequest):
    """
    For the admin's demand view. Groups the queries into topics, and searches each topic's
    first query against the index as it is now, so a gap that a profile edit has closed
    shows a higher score than when it was logged. Search only, no LLM.
    """
    queries = [q.strip()[:500] for q in body.queries if q.strip()]
    index = indexes["supervisors"]
    groups = []
    for members in group_queries(queries, body.similarity):
        label = queries[members[0]]
        hits = index.search(label, k=1)
        groups.append({"label": label, "members": members,
                       "best_now": hits[0]["score"] if hits else None,
                       "best_now_name": _name(hits[0]) if hits else None})
    return {"similarity": body.similarity, "groups": groups}


@app.get("/api/finance/overview", dependencies=[Depends(require_service_key)])
def finance_overview():
    if not FINANCE_ENABLED:
        raise HTTPException(404, "Travel and expense questions are switched off (FINANCE_ENABLED in rag.py).")
    """Finance documents with their status today, and FAQ entries with their review status (admin page)."""
    return finance.overview(fin)


# ---------------------------------------------------------------- files and page

# Finance PDFs, so answers can link to file.pdf#page=3 (Phase 8)
FINANCE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/pdfs", StaticFiles(directory=FINANCE_DIR), name="pdfs")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")
