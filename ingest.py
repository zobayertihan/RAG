"""
Run this every time you change data/supervisors.json or add, change, or remove
PDFs in data/finance:

    python ingest.py

Each collection gets its own search index. Only new or changed files are processed;
the rest come from cache.
"""

from rag import FINANCE_DIR, SUPERVISORS_JSON, build_index

if __name__ == "__main__":
    FINANCE_DIR.mkdir(parents=True, exist_ok=True)
    if not SUPERVISORS_JSON.exists():
        print(f"Missing {SUPERVISORS_JSON}. The supervisor collection is required.")
    else:
        for name, st in build_index().items():
            if not st["files"]:
                print(f"{name}: no files yet, skipped")
            else:
                print(f"{name}: {st['chunks']} chunks from {st['files']} file(s) "
                      f"({st['new']} new/changed, {st['cached']} from cache)")
        print("Restart the server to use the new index.")
