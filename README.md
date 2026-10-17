# Supervisor Finder (RAG from scratch)

A student describes their thesis interest. The system searches your PDFs, finds the
best-matching supervisors, and an LLM explains the matches with contact details,
the PDF page, and profile links.

## How it works

```
PDFs ──> split into chunks ──> embed (local model) ──> saved to data/index/
                (one chunk per person, page + email + links kept)

chat so far ──> LLM rewrites it into one search query ──> embed ──> find 6 most similar chunks
            ──> LLM writes answer (sees the chat history) ──> web page shows only the cited sources
```

The rewrite step is what makes follow-ups work: "now LLM with robotics" or "what's her
email?" are bad search queries on their own, so the LLM first turns the whole chat into
one standalone query. The page shows it under each answer as "Searched for".
The server keeps no chat state; the page sends the history with every message.

| File | What it does |
|---|---|
| `rag.py` | All the RAG logic: PDF reading, chunking, embeddings, search, LLM call |
| `ingest.py` | Builds the index from `data/pdfs/`. Run after adding PDFs |
| `app.py` | Web server (FastAPI) with `/api/ask` and the web page |
| `static/index.html` | The page students use (plain HTML + JavaScript) |
| `make_sample_pdf.py` | Makes a fake test PDF with 5 fictional supervisors |

## Setup on Windows (first time)

### 1. Install the tools
- **Python 3.12** from https://www.python.org/downloads/
  On the first installer screen, tick **"Add python.exe to PATH"**.
- **VS Code** from https://code.visualstudio.com/ (then install its "Python" extension).

Check it worked. Open PowerShell and run:
```powershell
python --version
```

### 2. Open the project
Unzip the project, open the folder in VS Code, then open a terminal there
(**Terminal > New Terminal**).

### 3. Create a virtual environment (an isolated Python just for this project)
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```
If PowerShell says *"running scripts is disabled"*, run this once, then try again:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
You'll see `(.venv)` at the start of the line when it's active.
Activate it again every time you open a new terminal.

### 4. Install packages
```powershell
pip install -r requirements.txt
```

### 5. Add your API key
1. Get a free key at https://console.groq.com/keys
2. Copy `.env.example` to a new file named `.env`
3. Paste the key after `LLM_API_KEY=`
4. Check https://console.groq.com/docs/models and put a current model ID in `LLM_MODEL`

No key yet? Leave it empty. The app still works and shows matching sources without the LLM answer.

### 6. Add PDFs and build the index
Put your PDFs in `data/pdfs/`. To test first with fake data:
```powershell
python make_sample_pdf.py
```
Then:
```powershell
python ingest.py
```
The first run downloads the embedding model (about 70 MB). After that it's offline.

### 7. Run it
```powershell
uvicorn app:app --reload
```
Open http://127.0.0.1:8000 and try:
*"I want to work on LLMs and decision support systems."* Then follow up with
*"actually I want to use LLMs with robotics"* and watch the suggestions change.

## Adding more PDFs later
Drop them into `data/pdfs/` and run `python ingest.py` again. Only new or changed
PDFs are processed. Removed PDFs disappear from the index automatically.
Then restart the server (Ctrl+C, run `uvicorn` again).

## Known limits (read before using real data)
- **Scanned PDFs (images of text) won't work.** The PDF must have selectable text.
  `ingest.py` warns you if a file has none.
- **Profiles are split at headings** (bigger or bold short lines, like a person's name).
  If your PDF has no such formatting, chunks are split by size and two people can
  end up in one chunk. Check `data/index/cache/*.json` after ingesting to see the chunks.
- **Links only appear if they're in the PDF**, as visible text or clickable links.
  The LLM is told never to invent contact details, but always double check.
- **Mixed documents:** when you add PDFs about other topics, they share the same
  search. That's fine for now, but the answer prompt in `rag.py` is written for
  supervisor matching, so you'll want to adjust it then.

## Putting it online later
This is one Python app that serves both the API and the page, so you deploy one thing.
Any host that runs Python web apps works (for example Render or Railway):
- Build command: `pip install -r requirements.txt && python ingest.py`
- Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Set `LLM_API_KEY` and `LLM_MODEL` as environment variables on the host, not in a file.
- Commit your PDFs to the repo (or the build has nothing to index). Never commit `.env`.

Anyone with the link can use your API key's quota. Groq's free tier has rate limits,
which caps the damage, but don't attach a paid key without adding a usage limit.
