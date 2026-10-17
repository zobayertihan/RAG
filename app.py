"""
Web server. Start with:

    uvicorn app:app --reload

then open http://127.0.0.1:8000
"""

from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rag import BASE_DIR, PDF_DIR, Index, answer, history_text, search_query

app = FastAPI(title="Supervisor Finder")
index = Index()

SEARCH_ONLY_SHOWN = 3  # sources shown when there's no LLM to pick them


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class Chat(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)


@app.post("/api/chat")
def chat(body: Chat):
    messages = [m.model_dump() for m in body.messages]
    if messages[-1]["role"] != "user":
        raise HTTPException(400, "Last message must be from the user")
    try:
        query = search_query(messages)
        hits = index.search(query)
        # what search found, shown in the server terminal (not to students)
        print(f"\nQUERY: {query}")
        for i, h in enumerate(hits, 1):
            print(f"  S{i} {h['score']:.3f}  {h['text'][:90]}")
        data = answer(messages, hits)
    except Exception as e:  # bad key, wrong model name, rate limit...
        raise HTTPException(502, f"LLM call failed: {e}")

    sources = {
        f"S{i}": {"file": h["file"], "page": h["page"], "score": h["score"],
                  "emails": h["emails"], "urls": h["urls"], "snippet": h["text"][:400]}
        for i, h in enumerate(hits, 1)
    }
    if data is None:  # no API key: show the best raw matches
        return {"message": None, "supervisors": [], "query": query, "history": history_text(None),
                "matches": [{"id": k, **v} for k, v in list(sources.items())[:SEARCH_ONLY_SHOWN]]}

    # attach page, links and emails from the PDF itself, never from the LLM
    cards = [{**c, **sources[c["source"]]} for c in data["supervisors"]]
    carded = {c["source"] for c in cards}
    # people discussed in a follow-up paragraph: name + profile link, taken from the PDF
    mentions = [{"name": hits[int(m[1:]) - 1]["text"].split(";")[0].split("\n")[0].removeprefix("Name: ")[:60], **sources[m]}
                for m in data["mentions"] if m not in carded]
    return {"message": data["message"], "supervisors": cards, "mentions": mentions, "query": query,
            "history": history_text(data), "matches": []}


# Serve the PDFs so the frontend can link to file.pdf#page=3
app.mount("/pdfs", StaticFiles(directory=PDF_DIR), name="pdfs")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")
