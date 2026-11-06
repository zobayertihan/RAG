"""Reads a staff list PDF (a table with name, position and research areas) into supervisor rows."""
import re

import pymupdf

COLS = {
    "name": ("name",),
    "position": ("designation", "position", "title", "role"),
    "interests": ("interest", "research area", "research"),
    "profile": ("profile",),
    "email": ("email", "e-mail"),
}
NOT_STATED = re.compile(r"^\s*(not stated.*|n/?a|none|-|–)\s*$", re.I)
NOTE = re.compile(r"\s*\((taken from|no stated|see )[^)]*\)\s*", re.I)


def _clean(s) -> str:
    return " ".join(str(s or "").split())


def _columns(header: list[str]) -> dict[str, int]:
    found = {}
    for i, h in enumerate(header):
        h = _clean(h).lower()
        for key, words in COLS.items():
            if key not in found and any(w in h for w in words):
                # "AU profile" is the profile column, not the name column
                if key == "name" and "profile" in h:
                    continue
                found[key] = i
                break
    return found


def _interests(text: str) -> list[str]:
    text = NOTE.sub(" ", _clean(text)).strip(" .;")
    if not text or NOT_STATED.match(text):
        return []
    parts = re.split(r"\s*[;,]\s*(?![^()]*\))", text)  # commas outside brackets
    out = []
    for p in parts:
        p = p.strip(" .")
        if p and p.lower() not in (x.lower() for x in out):
            out.append(p[0].upper() + p[1:] if not out else p)
    return out


def parse(data: bytes) -> dict:
    """{"rows": [...], "warnings": [...]} for one PDF."""
    doc = pymupdf.open(stream=data, filetype="pdf")
    rows, warnings, cols = [], [], None
    for page in doc:
        links = [l for l in page.get_links() if l.get("uri")]
        for table in page.find_tables().tables:
            # read each cell's text by position: table.extract() can drop the spaces between words
            cells = [[page.get_text("text", clip=pymupdf.Rect(b)) if b else "" for b in row.cells] for row in table.rows]
            if not cells:
                continue
            start = 0
            head = _columns(cells[0])
            if "name" in head and "interests" in head:
                cols, start = head, 1  # a header row (repeated on each page)
            if not cols:
                continue
            for r in range(start, len(cells)):
                row = cells[r]
                get = lambda k: _clean(row[cols[k]]) if k in cols and cols[k] < len(row) else ""
                name = get("name")
                if not name or _columns(row).get("name") is not None:
                    continue
                url = ""
                if "profile" in cols:
                    bbox = table.rows[r].cells[cols["profile"]]
                    if bbox:
                        rect = pymupdf.Rect(bbox)
                        hit = next((l["uri"] for l in links if rect.intersects(l["from"])), "")
                        url = hit
                    if not url and get("profile").startswith("http"):
                        url = get("profile")
                email = get("email")
                if email and "@" not in email:
                    email = ""
                rows.append({"name": name, "position": get("position"), "interests": _interests(get("interests")),
                             "profile_url": url, "email": email, "page": page.number + 1})
    if not cols:
        warnings.append("No table with a name column and a research area column was found.")
    elif not rows:
        warnings.append("The table was found, but it has no rows with a name.")
    return {"rows": rows, "warnings": warnings}
