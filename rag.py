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
SUPERVISORS_JSON = BASE_DIR / "data" / "supervisors.json"
FINANCE_DIR = BASE_DIR / "data" / "finance"  # finance PDFs go here (Phase 8)
INDEX_DIR = BASE_DIR / "data" / "index"
CACHE_DIR = INDEX_DIR / "cache"  # shared by all collections, keyed by file content


def collection_sources(name: str) -> list[Path]:
    """The files each collection is built from. One search index per collection."""
    if name == "supervisors":
        return [SUPERVISORS_JSON] if SUPERVISORS_JSON.exists() else []
    if name == "finance":
        return sorted(FINANCE_DIR.glob("*.pdf"))
    raise ValueError(f"Unknown collection {name!r}")


COLLECTIONS = ("supervisors", "finance")


def manifest_path(name: str) -> Path:
    return INDEX_DIR / name / "manifest.json"

EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
CHUNK_CHARS = int(os.getenv("CHUNK_CHARS", "1200"))
TOP_K = int(os.getenv("TOP_K", "10"))
# vector = embeddings only (the original behavior), bm25 = keywords only,
# hybrid = both merged. Run eval/run_eval.py before switching the default.
SEARCH_MODE = os.getenv("SEARCH_MODE", "vector")
RRF_K = 60  # standard constant for reciprocal rank fusion
CHUNKER_VERSION = "5"  # bump when pdf_to_chunks or records_to_chunks change, forces re-processing

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


def record_to_chunk(r: dict, file_name: str = SUPERVISORS_JSON.name) -> tuple[dict | None, str]:
    """
    One searchable chunk for one supervisor record, or (None, reason) when the person
    is not searchable: they can't supervise, or they have no research interests.
    """
    if r.get("position") not in SUPERVISOR_POSITIONS:
        return None, "position"
    interests = [i.strip() for i in r.get("interests") or [] if i.strip()]
    if not interests:
        return None, "no_interests"
    # The text is what gets embedded and what the LLM reads: research content only.
    # Group, type and room stay as metadata (for display and filters), so they don't
    # pull search results toward a group name.
    text = f"Name: {r['name']}; Position: {r['position']}; Area of interest: {', '.join(interests)}"
    if r.get("requirements"):
        text += f"; Requirements: {', '.join(r['requirements'])}"
    return {
        "file": file_name,
        "page": None,
        "record_id": r["id"],
        "text": text,
        "urls": [r["profile_url"]] if r.get("profile_url") else [],
        "emails": [r["email"]] if r.get("email") else [],
        "position": r["position"],
        "research_group": r.get("research_group") or "",
        "type": r.get("type") or "",
        "room": r.get("room") or "",
        "capacity": r.get("capacity"),
        "updated_at": r.get("updated_at"),
        "version": r.get("version"),
    }, ""


def records_to_chunks(json_path: Path) -> list[dict]:
    records = json.loads(json_path.read_text(encoding="utf-8"))
    chunks, skipped = [], {"position": 0, "no_interests": 0}
    for r in records:
        chunk, reason = record_to_chunk(r, json_path.name)
        if chunk:
            chunks.append(chunk)
        else:
            skipped[reason] += 1
    print(f"  {json_path.name}: {len(chunks)} searchable, "
          f"{skipped['position']} skipped (position), {skipped['no_interests']} skipped (no interests)")
    return chunks


def save_supervisor_record(record: dict) -> dict:
    """
    Writes one supervisor record into data/supervisors.json (replacing the record with
    the same id, or adding it), with a new version number and today's date.
    Returns the record as saved.
    """
    from datetime import date

    records = json.loads(SUPERVISORS_JSON.read_text(encoding="utf-8"))
    old = next((r for r in records if r["id"] == record["id"]), None)
    saved = {**(old or {}), **record,
             "version": ((old or {}).get("version") or 0) + 1,
             "updated_at": date.today().isoformat()}
    if old:
        records[records.index(old)] = saved
    else:
        records.append(saved)
    SUPERVISORS_JSON.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return saved


# ---------------------------------------------------------------- index


def _file_key(path: Path) -> str:
    h = hashlib.sha256(path.read_bytes())
    h.update(EMBED_MODEL.encode())  # changing the model invalidates the cache
    h.update(CHUNKER_VERSION.encode())  # so does changing how files are split
    return h.hexdigest()[:20]


def build_index(collections: tuple[str, ...] = COLLECTIONS) -> dict:
    """
    Builds one index per collection from its source files. Only new or changed files
    get embedded; unchanged ones come from the shared cache. Removed files drop out.
    A collection with no source files gets no index.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stats = {}
    for name in collections:
        sources = collection_sources(name)
        mpath = manifest_path(name)
        if not sources:
            if mpath.exists():
                mpath.unlink()  # its files were removed, so the old index must go too
            stats[name] = {"new": 0, "cached": 0, "chunks": 0, "files": 0}
            continue
        manifest = {"model": EMBED_MODEL, "collection": name, "files": []}
        st = {"new": 0, "cached": 0, "chunks": 0, "files": 0}
        for src in sources:
            key = _file_key(src)
            meta_path, vec_path = CACHE_DIR / f"{key}.json", CACHE_DIR / f"{key}.npy"
            if meta_path.exists() and vec_path.exists():
                st["cached"] += 1
                n = len(json.loads(meta_path.read_text(encoding="utf-8")))
            else:
                print(f"  [{name}] processing {src.name}")
                chunks = records_to_chunks(src) if src.suffix == ".json" else pdf_to_chunks(src)
                if not chunks:
                    print(f"  WARNING: nothing to index in {src.name}")
                    continue
                vecs = embed_passages([c["text"] for c in chunks])
                meta_path.write_text(json.dumps(chunks, ensure_ascii=False, indent=1), encoding="utf-8")
                np.save(vec_path, vecs)
                st["new"] += 1
                n = len(chunks)
            manifest["files"].append({"file": src.name, "key": key, "chunks": n})
            st["chunks"] += n
            st["files"] += 1
        mpath.parent.mkdir(parents=True, exist_ok=True)
        mpath.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        stats[name] = st
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


FILTER_FIELDS = ("position", "research_group", "type")


class Index:
    def __init__(self, collection: str = "supervisors"):
        self.collection = collection
        mpath = manifest_path(collection)
        if not mpath.exists():
            raise RuntimeError(f"No index for '{collection}'. Run: python ingest.py")
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
        if manifest["model"] != EMBED_MODEL:
            raise RuntimeError("Embedding model changed since last ingest. Run: python ingest.py")
        self.chunks, vecs = [], []
        for f in manifest["files"]:
            self.chunks += json.loads((CACHE_DIR / f"{f['key']}.json").read_text(encoding="utf-8"))
            vecs.append(np.load(CACHE_DIR / f"{f['key']}.npy"))
        self.vecs = np.vstack(vecs) if vecs else np.zeros((0, 1), dtype=np.float32)
        self._build_bm25()
        print(f"Index '{collection}' loaded: {len(manifest['files'])} files, {len(self.chunks)} chunks, "
              f"search mode {SEARCH_MODE}")

    @staticmethod
    def exists(collection: str) -> bool:
        return manifest_path(collection).exists()

    def _build_bm25(self):
        self.bm25 = None
        if self.chunks:
            from rank_bm25 import BM25Okapi  # keyword index, built in memory
            self.bm25 = BM25Okapi([_tokens(c["text"]) for c in self.chunks])

    # ---- live updates (used by /reindex; the files on disk are updated separately)

    def upsert(self, chunk: dict) -> str:
        """Adds or replaces one record's chunk in memory. Returns "updated" or "added"."""
        vec = embed_passages([chunk["text"]])[0]
        for i, c in enumerate(self.chunks):
            if c.get("record_id") == chunk["record_id"]:
                self.chunks[i] = chunk
                self.vecs[i] = vec
                self._build_bm25()
                return "updated"
        self.chunks.append(chunk)
        self.vecs = np.vstack([self.vecs, vec[None, :]]) if len(self.vecs) else vec[None, :]
        self._build_bm25()
        return "added"

    def remove(self, record_id: str) -> bool:
        keep = [i for i, c in enumerate(self.chunks) if c.get("record_id") != record_id]
        if len(keep) == len(self.chunks):
            return False
        self.chunks = [self.chunks[i] for i in keep]
        self.vecs = self.vecs[keep] if keep else np.zeros((0, self.vecs.shape[1]), dtype=np.float32)
        self._build_bm25()
        return True

    # ---- search

    def _allowed(self, filters: dict | None) -> np.ndarray:
        """Indices of chunks that pass the filters. An empty or missing filter allows everything."""
        idx = np.arange(len(self.chunks))
        for field in FILTER_FIELDS:
            wanted = {v.lower() for v in (filters or {}).get(field) or [] if v}
            if wanted:
                idx = np.array([i for i in idx if str(self.chunks[i].get(field, "")).lower() in wanted], dtype=int)
        return idx

    def search(self, query: str, k: int = TOP_K, mode: str | None = None,
               filters: dict | None = None) -> list[dict]:
        """
        Returns the k best chunks among those that pass the filters (position,
        research_group, type: each a list of allowed values). Each hit keeps
        "score" = cosine similarity (for logs and display) and adds "bm25" and
        "rank_score" (what the order is based on).
        """
        if not self.chunks:
            return []
        mode = mode or SEARCH_MODE
        if mode not in ("vector", "bm25", "hybrid"):
            raise ValueError(f"Unknown search mode {mode!r}; use vector, bm25 or hybrid")
        allowed = self._allowed(filters)
        if not len(allowed):
            return []
        cos = self.vecs @ embed_query(query) if mode in ("vector", "hybrid") else np.zeros(len(self.chunks))
        kw = (np.asarray(self.bm25.get_scores(_tokens(query)), dtype=np.float32)
              if mode in ("bm25", "hybrid") else np.zeros(len(self.chunks)))

        rank_score = np.full(len(self.chunks), -np.inf)
        if mode == "vector":
            rank_score[allowed] = cos[allowed]
        elif mode == "bm25":
            rank_score[allowed] = kw[allowed]
        else:
            # Reciprocal rank fusion over the allowed chunks: each list votes by position,
            # not by raw score, so cosine (0 to 1) and BM25 (unbounded) need no common scale.
            # Chunks with no keyword overlap get no keyword vote.
            rank_score[allowed] = 0.0
            for scores, use_all in ((cos, True), (kw, False)):
                order = allowed[np.argsort(-scores[allowed], kind="stable")]
                for pos, i in enumerate(order):
                    if use_all or scores[i] > 0:
                        rank_score[i] += 1.0 / (RRF_K + pos + 1)

        top = allowed[np.argsort(-rank_score[allowed], kind="stable")][:k]
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
    for card in data["supervisors"]:
        # Room for the typed cards from Phase 2 (best, business, engineering, generalist).
        # Until the types are labeled, the LLM is not asked for it and it stays null.
        card.setdefault("slot", None)
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


# ---------------------------------------------------------------- LLM helpers for the web app

NOTE_PROMPT = """A student sent a supervision request with a note. Write a summary for the supervisor.
Rules:
- Exactly two short sentences, plain text.
- Sentence 1: what the student wants to do, in their own terms.
- Sentence 2: how it relates to the supervisor's listed research areas. Say plainly if it doesn't.
- Use only what the note and the supervisor's areas say. Don't judge the student or recommend a decision."""


def summarize_note(note: str, supervisor_areas: str, request_type: str = "") -> str | None:
    """Two-sentence summary of a student's note for the supervisor. None without an API key."""
    if not os.getenv("LLM_API_KEY"):
        return None
    resp = _client().chat.completions.create(
        model=_model(), temperature=0,
        messages=[{"role": "system", "content": NOTE_PROMPT},
                  {"role": "user", "content": f"REQUEST TYPE: {request_type or 'not given'}\n"
                                              f"SUPERVISOR'S AREAS: {supervisor_areas or 'not listed'}\n"
                                              f"STUDENT'S NOTE:\n{note}"}],
    )
    return (resp.choices[0].message.content or "").strip() or None


EMAIL_ACTIONS = ("accept", "accept_discuss", "reject", "ask_details")

EMAIL_TEMPLATES = {
    "accept": ("Supervision request: accepted",
               "Dear {student},\n\nThank you for your request. I am happy to supervise your project{topic_part}. "
               "Please send me a few dates for a first meeting.\n\nBest regards,\n{supervisor}"),
    "accept_discuss": ("Your idea: let's talk",
                       "Dear {student},\n\nThank you for your message{topic_part}. I am happy to discuss your idea. "
                       "Please send me a few dates for a short meeting.\n\nBest regards,\n{supervisor}"),
    "reject": ("Supervision request",
               "Dear {student},\n\nThank you for your request{topic_part}. Unfortunately I cannot take it on. "
               "I recommend contacting other supervisors whose areas are closer to your idea.\n\nBest regards,\n{supervisor}"),
    "ask_details": ("Supervision request: a few questions",
                    "Dear {student},\n\nThank you for your request{topic_part}. Before I decide, could you send me "
                    "a short description of your preliminary idea: the problem, how you plan to approach it, "
                    "and what data or partners you have in mind?\n\nBest regards,\n{supervisor}"),
}

EMAIL_PROMPT = """Write a short, polite email from a university supervisor to a student about a supervision request.
Decision: {action_text}. Base it on the template below, and mention one concrete point from the
student's note if it helps. Don't add promises, dates or facts that aren't given. Plain text, under 120 words.
Reply with JSON: {{"subject": "...", "body": "..."}}"""

_ACTION_TEXT = {"accept": "accept the request", "accept_discuss": "agree to meet and discuss the idea (this is not yet a supervision agreement)",
                "reject": "decline the request",
                "ask_details": "ask for more details before deciding"}


def draft_email(action: str, student: str, supervisor: str, note: str = "", topic: str = "") -> dict:
    """
    Email draft for the supervisor to edit before sending. Uses the fixed template, and
    lets the LLM personalize it when an API key is set. Returns {"subject", "body", "personalized"}.
    """
    if action not in EMAIL_ACTIONS:
        raise ValueError(f"action must be one of {EMAIL_ACTIONS}")
    subject, body = EMAIL_TEMPLATES[action]
    body = body.format(student=student, supervisor=supervisor,
                       topic_part=f" on {topic}" if topic else "")
    draft = {"subject": subject, "body": body, "personalized": False}
    if not os.getenv("LLM_API_KEY") or not note.strip():
        return draft
    resp = _client().chat.completions.create(
        model=_model(), temperature=0.2, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": EMAIL_PROMPT.format(action_text=_ACTION_TEXT[action])},
                  {"role": "user", "content": f"TEMPLATE SUBJECT: {subject}\nTEMPLATE BODY:\n{body}\n\n"
                                              f"STUDENT'S NOTE:\n{note}"}],
    )
    data = _parse_json(resp.choices[0].message.content or "")
    if data.get("subject") and data.get("body"):
        draft = {"subject": str(data["subject"]).strip(), "body": str(data["body"]).strip(), "personalized": True}
    return draft


# ---------------------------------------------------------------- demand gaps (admin dashboard)

GROUP_SIMILARITY = 0.80  # two queries this similar (cosine) count as one topic


def group_queries(queries: list[str], similarity: float = GROUP_SIMILARITY) -> list[list[int]]:
    """
    Groups similar queries into topics, greedily: each query joins the first group whose
    first query is at least `similarity` close, else starts a new group. Returns lists of
    positions in `queries`, biggest group first. Deterministic for the same input order.
    """
    if not queries:
        return []
    vecs = np.vstack([embed_query(q) for q in queries])
    heads: list[int] = []
    groups: list[list[int]] = []
    for i, v in enumerate(vecs):
        sims = [float(vecs[h] @ v) for h in heads]
        best = int(np.argmax(sims)) if sims else -1
        if best >= 0 and sims[best] >= similarity:
            groups[best].append(i)
        else:
            heads.append(i)
            groups.append([i])
    return sorted(groups, key=len, reverse=True)
