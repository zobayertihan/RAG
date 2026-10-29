"""
Run this every time you change data/supervisors.json or add, change, or remove
PDFs in data/pdfs:

    python ingest.py

Only new or changed files are processed; the rest come from cache.
"""

from rag import PDF_DIR, SUPERVISORS_JSON, build_index

if __name__ == "__main__":
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    if not SUPERVISORS_JSON.exists() and not any(PDF_DIR.glob("*.pdf")):
        print(f"Nothing to index. Add {SUPERVISORS_JSON} or PDFs in {PDF_DIR}.")
    else:
        stats = build_index()
        print(f"Done. {stats['new']} new/changed file(s), {stats['cached']} from cache, "
              f"{stats['chunks']} chunks total.")
        print("Restart the server to use the new index.")
