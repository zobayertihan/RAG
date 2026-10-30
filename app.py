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
"""

import hmac
import os
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rag import (BASE_DIR, COLLECTIONS, FINANCE_DIR, Index, answer, draft_email,
                 history_text, record_to_chunk, save_supervisor_record, search_query, summarize_note)

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

SEARCH_ONLY_SHOWN = 3  # sources shown when there's no LLM to pick them


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


@app.post("/api/chat")
def chat(body: Chat):
    messages = [m.model_dump() for m in body.messages]
    if messages[-1]["role"] != "user":
        raise HTTPException(400, "Last message must be from the user")
    if body.mode == "finance":
        # Phase 8 adds the finance prompt and answer format. Until then this mode is closed,
        # even if finance PDFs are indexed, so it can't answer with the supervisor prompt.
        raise HTTPException(400, "The finance helper is not available yet.")
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
            "query": query, "best_score": best_score, "history": history_text(data), "matches": []}


@app.get("/api/health")
def health():
    return {"collections": {name: len(ix.chunks) for name, ix in indexes.items()}}


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


# ---------------------------------------------------------------- files and page

# Finance PDFs, so answers can link to file.pdf#page=3 (Phase 8)
FINANCE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/pdfs", StaticFiles(directory=FINANCE_DIR), name="pdfs")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")
