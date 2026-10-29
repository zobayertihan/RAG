"""
Core RAG logic: read PDFs, split into chunks, embed, store, search, answer.

Everything lives in plain files under data/:
  data/pdfs/            <- put your PDFs here
  data/index/cache/     <- one cached .json + .npy per processed PDF
  data/index/manifest.json
"""

import hashlib
import json
import os
import re
from pathlib import Path

import pymupdf as fitz  # PyMuPDF
import numpy as np
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
PDF_DIR = BASE_DIR / "data" / "pdfs"
SUPERVISORS_JSON = BASE_DIR / "data" / "supervisors.json"
INDEX_DIR = BASE_DIR / "data" / "index"
CACHE_DIR = INDEX_DIR / "cache"
MANIFEST = INDEX_DIR / "manifest.json"

EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
CHUNK_CHARS = int(os.getenv("CHUNK_CHARS", "1200"))
TOP_K = int(os.getenv("TOP_K", "10"))
# vector = embeddings only (the original behavior), bm25 = keywords only,
# hybrid = both merged. Run eval/run_eval.py before switching the default.
SEARCH_MODE = os.getenv("SEARCH_MODE", "vector")
RRF_K = 60  # standard constant for reciprocal rank fusion
CHUNKER_VERSION = "4"  # bump when pdf_to_chunks or records_to_chunks change, forces re-processing

# Positions that can supervise. Everyone else stays in supervisors.json (for the
# admin later) but is not searchable as a supervisor.
SUPERVISOR_POSITIONS = {
    "Distinguished Professor", "Professor", "Professor (Docent)",
    "Associate Professor", "Assistant Professor", "Postdoc",
}

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")


# ---------------------------------------------------------------- embeddings

_embedder = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding  # imported lazily: slow to load

        print(f"Loading embedding model {EMBED_MODEL} (first run downloads it)...")
        _embedder = TextEmbedding(EMBED_MODEL)
    return _embedder


def _normalize(m: np.ndarray) -> np.ndarray:
    return m / np.clip(np.linalg.norm(m, axis=1, keepdims=True), 1e-12, None)


def embed_passages(texts: list[str]) -> np.ndarray:
    vecs = list(_get_embedder().passage_embed(texts))
    return _normalize(np.array(vecs, dtype=np.float32))


def embed_query(text: str) -> np.ndarray:
    vec = list(_get_embedder().query_embed(text))[0]
    return _normalize(np.array([vec], dtype=np.float32))[0]


# ---------------------------------------------------------------- PDF -> chunks


def _rects_overlap(a, b) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _page_blocks(page) -> list[dict]:
    """Text blocks in reading order, with their position, font size and boldness."""
    out = []
    for b in page.get_text("dict", sort=True)["blocks"]:
        if b.get("type") != 0:
            continue
        spans = [s for line in b["lines"] for s in line["spans"] if s["text"].strip()]
        if not spans:
            continue
        text = " ".join(" ".join(s["text"] for s in line["spans"]) for line in b["lines"])
        out.append({
            "text": " ".join(text.split()),
            "rect": tuple(b["bbox"]),
            "size": max(s["size"] for s in spans),
            "bold": all(s["flags"] & 16 for s in spans),
            "chars": sum(len(s["text"]) for s in spans),
        })
    return out


def pdf_to_chunks(pdf_path: Path) -> list[dict]:
    """
    Split a PDF into chunks that never cross a page boundary.
    A new chunk starts at every heading (bigger or bold short line, e.g. a
    professor's name), so each person's profile ends up in its own chunk.
    Each chunk remembers: file, page number, text, emails and links found in it.
    Clickable links are matched to the text block they sit on, so a link to
    Professor A's page doesn't get attached to Professor B's chunk.
    Tables are detected separately and indexed one row per chunk.
    """
    chunks = []
    doc = fitz.open(pdf_path)
    pages = [_page_blocks(p) for p in doc]

    # "normal" body font size = the size most characters in the document use
    size_chars: dict[float, int] = {}
    for blocks in pages:
        for b in blocks:
            size_chars[round(b["size"], 1)] = size_chars.get(round(b["size"], 1), 0) + b["chars"]
    body_size = max(size_chars, key=size_chars.get) if size_chars else 0

    for page_index, page in enumerate(doc):
        page_no = page_index + 1
        links = [(tuple(l["from"]), l["uri"]) for l in page.get_links() if l.get("uri")]

        # Tables: one chunk per row (e.g. one supervisor per row), with that row's links.
        # Text inside tables is then skipped below so it isn't indexed twice.
        table_rects = []
        for t in page.find_tables().tables:
            table_rects.append(tuple(t.bbox))
            header = [" ".join((h or "").split()) for h in t.header.names]
            for row, cells in zip(t.rows, t.extract()):
                cells = [" ".join((c or "").split()) for c in cells]
                if cells == header or sum(bool(c) for c in cells) < 2:
                    continue  # header row or empty row
                row_links = [u for r, u in links if _rects_overlap(r, row.bbox)]
                # Drop cells that are noise for search: row numbers ("12") and link labels
                # ("Profile"). Otherwise every row shares the same boilerplate and all rows
                # look alike to the embedding model.
                keep = []
                for h, c, rect in zip(header, cells, row.cells):
                    is_label = rect and len(c) <= 20 and any(_rects_overlap(r, rect) for r, _ in links)
                    if c and not c.isdigit() and not is_label:
                        keep.append(f"{h}: {c}" if h else c)
                if len(keep) < 2:
                    continue
                text = "; ".join(keep)
                chunks.append({
                    "file": pdf_path.name,
                    "page": page_no,
                    "text": text,
                    "urls": sorted({u for u in row_links if u.startswith("http")}
                                   | {u.rstrip(".,;:") for u in URL_RE.findall(text)}),
                    "emails": sorted({e.rstrip(".") for e in EMAIL_RE.findall(text)}
                                     | {u[7:] for u in row_links if u.startswith("mailto:")}),
                })

        def in_table(rect):
            cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
            return any(t[0] <= cx <= t[2] and t[1] <= cy <= t[3] for t in table_rects)

        blocks = [b for b in pages[page_index] if not in_table(b["rect"])]

        current_text, current_rects = [], []
        has_body = False

        def flush():
            if not current_text:
                return
            text = "\n".join(current_text).strip()
            if len(text) < 30:  # page numbers, footers: nothing worth searching
                current_text.clear()
                current_rects.clear()
                return
            link_uris = [u for r, u in links if any(_rects_overlap(r, cr) for cr in current_rects)]
            urls = {u for u in link_uris if u.startswith("http")}
            urls |= {u.rstrip(".,;:") for u in URL_RE.findall(text)}
            emails = {e.rstrip(".") for e in EMAIL_RE.findall(text)}
            emails |= {u[7:] for u in link_uris if u.startswith("mailto:")}
            chunks.append({
                "file": pdf_path.name,
                "page": page_no,
                "text": text,
                "urls": sorted(urls),
                "emails": sorted(emails),
            })
            current_text.clear()
            current_rects.clear()

        for b in blocks:
            is_heading = len(b["text"]) < 100 and (b["size"] >= body_size * 1.15 or b["bold"])
            too_long = sum(len(t) for t in current_text) + len(b["text"]) > CHUNK_CHARS
            # don't split right after a heading (keeps "Department" + "Dr. X" together)
            if current_text and ((is_heading and has_body) or too_long):
                flush()
                has_body = False
            has_body = has_body or not is_heading
            current_text.append(b["text"])
            current_rects.append(b["rect"])
        flush()
    doc.close()
    return chunks


# ---------------------------------------------------------------- records -> chunks


def records_to_chunks(json_path: Path) -> list[dict]:
    """
    One chunk per supervisor record. Only people who can supervise AND have at
    least one research interest are searchable; a record with no interests
    cannot be matched to anything.
    """
    records = json.loads(json_path.read_text(encoding="utf-8"))
    chunks, skipped = [], {"position": 0, "no_interests": 0}
    for r in records:
        if r.get("position") not in SUPERVISOR_POSITIONS:
            skipped["position"] += 1
            continue
        interests = [i.strip() for i in r.get("interests") or [] if i.strip()]
        if not interests:
            skipped["no_interests"] += 1
            continue
        # The text is what gets embedded and what the LLM reads: research content only.
        # Group, type and room stay as metadata (for display and filters), so they don't
        # pull search results toward a group name.
        text = f"Name: {r['name']}; Position: {r['position']}; Area of interest: {', '.join(interests)}"
        if r.get("requirements"):
            text += f"; Requirements: {', '.join(r['requirements'])}"
        chunks.append({
            "file": json_path.name,
            "page": None,
            "record_id": r["id"],
            "text": text,
            "urls": [r["profile_url"]] if r.get("profile_url") else [],
            "emails": [r["email"]] if r.get("email") else [],
            "position": r["position"],
            "research_group": r.get("research_group") or "",
            "type": r.get("type") or "",
            "room": r.get("room") or "",
            "updated_at": r.get("updated_at"),
        })
    print(f"  {json_path.name}: {len(chunks)} searchable, "
          f"{skipped['position']} skipped (position), {skipped['no_interests']} skipped (no interests)")
    return chunks


# ---------------------------------------------------------------- index


def _file_key(path: Path) -> str:
    h = hashlib.sha256(path.read_bytes())
    h.update(EMBED_MODEL.encode())  # changing the model invalidates the cache
    h.update(CHUNKER_VERSION.encode())  # so does changing how files are split
    return h.hexdigest()[:20]


def build_index() -> dict:
    """
    Index data/supervisors.json plus every PDF in data/pdfs. Only new or changed
    files get embedded; unchanged ones are loaded from cache. Removed files drop out.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    sources = ([SUPERVISORS_JSON] if SUPERVISORS_JSON.exists() else []) + sorted(PDF_DIR.glob("*.pdf"))
    manifest = {"model": EMBED_MODEL, "files": []}
    stats = {"new": 0, "cached": 0, "chunks": 0}

    for src in sources:
        key = _file_key(src)
        meta_path, vec_path = CACHE_DIR / f"{key}.json", CACHE_DIR / f"{key}.npy"
        if meta_path.exists() and vec_path.exists():
            stats["cached"] += 1
            n = len(json.loads(meta_path.read_text(encoding="utf-8")))
        else:
            print(f"  processing {src.name}")
            chunks = records_to_chunks(src) if src.suffix == ".json" else pdf_to_chunks(src)
            if not chunks:
                print(f"  WARNING: nothing to index in {src.name}")
                continue
            vecs = embed_passages([c["text"] for c in chunks])
            meta_path.write_text(json.dumps(chunks, ensure_ascii=False, indent=1), encoding="utf-8")
            np.save(vec_path, vecs)
            stats["new"] += 1
            n = len(chunks)
        manifest["files"].append({"file": src.name, "key": key, "chunks": n})
        stats["chunks"] += n

    MANIFEST.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return stats


_WORD_RE = re.compile(r"[a-z0-9][a-z0-9+/&.-]*[a-z0-9+]|[a-z0-9]")
# Field labels and filler words that appear in every record; they carry no meaning for search.
_STOPWORDS = {
    "name", "position", "area", "of", "interest", "requirements", "and", "the", "a", "an", "in", "for",
    "on", "to", "with", "or", "i", "my", "me", "want", "work", "use", "using", "about", "is", "are",
}


def _stem(w: str) -> str:
    # Light, symmetric stemming so "robots" matches "robot" and "networks" matches "network".
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def _tokens(text: str) -> list[str]:
    out = []
    for w in _WORD_RE.findall(text.lower()):
        parts = [w] + (w.split("/") if "/" in w else [])  # "ar/vr" also counts as "ar" and "vr"
        out += [_stem(p) for p in parts if p and p not in _STOPWORDS]
    return out


class Index:
    def __init__(self):
        if not MANIFEST.exists():
            raise RuntimeError("No index found. Run: python ingest.py")
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        if manifest["model"] != EMBED_MODEL:
            raise RuntimeError("Embedding model changed since last ingest. Run: python ingest.py")
        self.chunks, vecs = [], []
        for f in manifest["files"]:
            self.chunks += json.loads((CACHE_DIR / f"{f['key']}.json").read_text(encoding="utf-8"))
            vecs.append(np.load(CACHE_DIR / f"{f['key']}.npy"))
        self.vecs = np.vstack(vecs) if vecs else np.zeros((0, 1), dtype=np.float32)
        self.bm25 = None
        if self.chunks:
            from rank_bm25 import BM25Okapi  # keyword index, built in memory at startup
            self.bm25 = BM25Okapi([_tokens(c["text"]) for c in self.chunks])
        print(f"Index loaded: {len(manifest['files'])} files, {len(self.chunks)} chunks, search mode {SEARCH_MODE}")

    def _vector_ranking(self, query: str) -> np.ndarray:
        return self.vecs @ embed_query(query)  # cosine similarity (vectors are normalized)

    def _bm25_ranking(self, query: str) -> np.ndarray:
        return np.asarray(self.bm25.get_scores(_tokens(query)), dtype=np.float32)

    def search(self, query: str, k: int = TOP_K, mode: str | None = None) -> list[dict]:
        """
        Returns the k best chunks. Each hit keeps "score" = cosine similarity (as before,
        for logs and display) and adds "bm25" and "rank_score" (what the order is based on).
        """
        if not self.chunks:
            return []
        mode = mode or SEARCH_MODE
        cos = self._vector_ranking(query) if mode in ("vector", "hybrid") else np.zeros(len(self.chunks))
        kw = self._bm25_ranking(query) if mode in ("bm25", "hybrid") else np.zeros(len(self.chunks))

        if mode == "vector":
            rank_score = cos
        elif mode == "bm25":
            rank_score = kw
        elif mode == "hybrid":
            # Reciprocal rank fusion: each list votes by position, not by raw score,
            # so cosine (0 to 1) and BM25 (unbounded) don't need to be on the same scale.
            # Records with no keyword overlap get no keyword vote.
            rank_score = np.zeros(len(self.chunks))
            for scores, use_all in ((cos, True), (kw, False)):
                order = np.argsort(-scores, kind="stable")
                for pos, i in enumerate(order):
                    if use_all or scores[i] > 0:
                        rank_score[i] += 1.0 / (RRF_K + pos + 1)
        else:
            raise ValueError(f"Unknown search mode {mode!r}; use vector, bm25 or hybrid")

        top = np.argsort(-rank_score, kind="stable")[:k]
        return [{**self.chunks[i], "score": round(float(cos[i]), 3), "bm25": round(float(kw[i]), 3),
                 "rank_score": round(float(rank_score[i]), 5)} for i in top]


# ---------------------------------------------------------------- LLM (chat)

HISTORY_TURNS = 8  # how many earlier messages the LLM sees

SYSTEM_PROMPT = """You help university students find a suitable thesis supervisor, in a conversation.
The student may refine their idea, combine fields, or change direction completely.
Each time you get numbered SOURCES (staff records and documents), retrieved for the student's latest message.

Keep two kinds of content strictly apart:
1. FACTS about a person (name, title, research areas): ONLY from the SOURCES. Never invent or
   embellish them, and never claim a person did specific work that is not in the sources.
2. GUIDANCE (why someone fits, thesis ideas): you may use general knowledge, as your suggestions.

Reply with a JSON object in exactly this shape:
{
  "message": "your reply to the student (see the rules below for its length)",
  "mentions": ["S2"],
  "supervisors": [
    {
      "source": "S2",
      "name": "full name exactly as in the source",
      "title": "title exactly as in the source",
      "focus": "their research areas from the source, comma separated",
      "fit": "2 to 3 sentences: why this person fits the student's specific interest",
      "ideas": ["concrete thesis idea", "another idea", "a third idea"],
      "role": "supervisor"
    }
  ]
}

Rules:
- Suggest 2 to 3 supervisors as ALTERNATIVES, best match first. Each one must work as the
  student's single supervisor; students normally have one supervisor for projects like TS1, TS2
  or MOT. "source" must be the [S#] the person comes from.
- If the interest combines several fields (for example LLMs + computer vision), rank people by how
  much of the combination they cover. In "fit", say which of the student's fields they cover and
  which they don't, so the student can compare the options.
- Only suggest co-supervision if the student asks for it. Then set "role" to "co-supervisor" for
  the second person and explain the split in "message".
- Cards ("supervisors") are ONLY for suggesting supervisors. For a recommendation, "message" is
  1 to 3 sentences and the details go in the cards.
- Follow-up questions about people (for example "what about X?", "how can he help me?", "compare
  the first two") are NOT recommendations: answer in "message" as 2 to 4 short paragraphs separated
  by a blank line, and return an empty "supervisors" list. Explain concretely how the person can
  help: what their research areas mean for the student's idea, the kind of projects and skills the
  student could work on with them, and what they cannot cover. Facts about the person still come
  only from the sources; the rest is your guidance.
- Put the [S#] of every person you discuss in "mentions" (the app links their profile). Use an
  empty list when you discuss nobody specific.
- If the student asks something that is not about choosing supervisors, answer in "message" and
  return an empty "supervisors" list.
- If no source is a reasonable fit, say so in "message", suggest how to rephrase, and return an
  empty "supervisors" list.
- Do not write contact details, links, or emails anywhere; the app adds them from the sources.
- Plain text inside the strings, no markdown."""

REWRITE_PROMPT = """Rewrite the student's latest message into ONE standalone search query for finding
supervisors in a document database. The query must make sense without the conversation.
- Resolve references ("her", "the first one", "those supervisors") into the people's NAMES and
  research fields, taken from the assistant's earlier replies.
- Keep every field the student still wants combined; drop fields they abandoned.
- Never just repeat the latest message if it contains references or no topic.
- Keep only research topics. Leave out greetings, the student's own name, course or project
  codes (like TS1), and words like supervisor, thesis, project, help, find.
- Expand abbreviations: ML = machine learning, CV = computer vision, LLM = large language models,
  NLP = natural language processing, AI = artificial intelligence, IoT = internet of things.

Examples:
Latest: "Hi, I'm Sara, I like ML and CV. Can you help me find a supervisor for my TS1 project?"
Query: machine learning, computer vision, deep learning
Latest: "what about robotics too?" (earlier interest: LLMs)
Query: large language models combined with robotics, robot task planning
Latest: "tell me more about the first one" (assistant recommended Lena Fischer first)
Query: Lena Fischer language models for robot task planning human-robot interaction
Latest: "explain more on the primary supervisors" (assistant recommended Erik Sand and Lena Fischer)
Query: Erik Sand robotics motion planning; Lena Fischer language models robot task planning

Output only the query, no quotes, no explanation."""

CITE_RE = re.compile(r"\[S\d+\]")


def _client():
    from openai import OpenAI  # Groq, OpenAI, Together, etc. all speak this API

    return OpenAI(api_key=os.getenv("LLM_API_KEY"),
                  base_url=os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1"))


def _model() -> str:
    return os.getenv("LLM_MODEL") or "MISSING: set LLM_MODEL in .env"


def _history(messages: list[dict]) -> list[dict]:
    """Earlier turns, with old [S1] markers removed (they pointed at old sources)."""
    return [{"role": m["role"], "content": CITE_RE.sub("", m["content"])}
            for m in messages[:-1][-HISTORY_TURNS:]]


def search_query(messages: list[dict]) -> str:
    """
    Turn the conversation into one search query. "What about robotics too?" alone
    finds nothing useful; "LLMs combined with robotics" does.
    Without an API key, falls back to the student's last two messages.
    """
    if not os.getenv("LLM_API_KEY"):
        return messages[-1]["content"]
    convo = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in _history(messages))
    resp = _client().chat.completions.create(
        # no small max_tokens here: reasoning models (like gpt-oss) spend tokens "thinking"
        # first, and a tight limit leaves the actual answer empty
        model=_model(), temperature=0,
        messages=[{"role": "system", "content": REWRITE_PROMPT},
                  {"role": "user", "content": f"{convo}\nSTUDENT (latest): {messages[-1]['content']}"}],
    )
    query = (resp.choices[0].message.content or "").strip().strip('"')
    if not query:
        print("WARNING: query rewrite came back empty, searching with the raw message")
    return query or messages[-1]["content"]


def _parse_json(raw: str) -> dict:
    """Models sometimes wrap JSON in text or code fences; take the outermost {...}."""
    try:
        return json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
    except ValueError:
        return {"message": raw.strip(), "supervisors": []}


def answer(messages: list[dict], hits: list[dict]) -> dict | None:
    """
    Returns {"message": str, "supervisors": [...]} for the cards,
    or None when no API key is set (search-only mode).
    """
    if not os.getenv("LLM_API_KEY"):
        return None
    sources = "\n\n".join(f"[S{i}] ({h['file']}" + (f", page {h['page']}" if h['page'] else "") + f")\n{h['text']}"
                           for i, h in enumerate(hits, 1))
    resp = _client().chat.completions.create(
        model=_model(), temperature=0.1,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, *_history(messages),
                  {"role": "user", "content": f"STUDENT: {messages[-1]['content']}\n\nSOURCES:\n{sources}"}],
    )
    data = _parse_json(resp.choices[0].message.content or "")
    valid = {f"S{i}" for i in range(1, len(hits) + 1)}
    data["message"] = str(data.get("message", "")).strip()
    # drop cards that point at a source that doesn't exist (the link would be wrong)
    data["supervisors"] = [s for s in data.get("supervisors") or []
                           if isinstance(s, dict) and s.get("source") in valid]
    mentions = data.get("mentions") if isinstance(data.get("mentions"), list) else []
    data["mentions"] = list(dict.fromkeys(m for m in mentions if m in valid))  # dedupe, keep order
    return data


def history_text(data: dict | None) -> str:
    """Short text version of a reply, kept in the chat history so follow-ups like
    'tell me more about the first one' can be resolved."""
    if not data:
        return "(showed search results)"
    lines = [data["message"]]
    for i, s in enumerate(data["supervisors"], 1):
        lines.append(f"{i}. {s.get('name')} ({s.get('title')}): {s.get('focus')}")
    return "\n".join(lines)
