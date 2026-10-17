"""
Run this every time you add, change, or remove PDFs in data/pdfs:

    python ingest.py

Only new or changed PDFs are processed; the rest come from cache.
"""

from rag import PDF_DIR, build_index

if __name__ == "__main__":
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    if not any(PDF_DIR.glob("*.pdf")):
        print(f"No PDFs in {PDF_DIR}. Add some (or run: python make_sample_pdf.py) and try again.")
    else:
        stats = build_index()
        print(f"Done. {stats['new']} new/changed PDF(s), {stats['cached']} from cache, "
              f"{stats['chunks']} chunks total.")
        print("Restart the server (or it reloads automatically with --reload) to use the new index.")
