"""
Creates data/pdfs/sample_supervisors.pdf with FICTIONAL supervisors so you can
test the system before you have real data. Delete it once you add real PDFs.

    python make_sample_pdf.py
"""

import pymupdf as fitz  # PyMuPDF

from rag import PDF_DIR

PEOPLE = [
    ("Dr. Anna Lind", "Associate Professor",
     "Machine learning for predictive maintenance, sensor data, anomaly detection in manufacturing systems.",
     "anna.lind@example.edu", "https://example.edu/staff/anna-lind"),
    ("Prof. Jonas Berg", "Professor",
     "Business model innovation, digital platforms, technology commercialization and startups.",
     "jonas.berg@example.edu", "https://example.edu/staff/jonas-berg"),
    ("Dr. Maria Costa", "Assistant Professor",
     "Retrieval-augmented generation, large language models, decision support systems, explainable AI.",
     "maria.costa@example.edu", "https://example.edu/staff/maria-costa"),
    ("Dr. Peter Holm", "Associate Professor",
     "Supply chain management, operations research, sustainability in logistics and circular economy.",
     "peter.holm@example.edu", "https://example.edu/staff/peter-holm"),
    ("Prof. Sara Nielsen", "Professor",
     "Computer vision, medical image analysis, deep learning for healthcare applications.",
     "sara.nielsen@example.edu", "https://example.edu/staff/sara-nielsen"),
    ("Dr. Erik Sand", "Associate Professor",
     "Robotics, robot motion planning, industrial robot arms and autonomous mobile robots.",
     "erik.sand@example.edu", "https://example.edu/staff/erik-sand"),
    ("Dr. Lena Fischer", "Assistant Professor",
     "Language models for robot task planning, human-robot interaction, embodied AI.",
     "lena.fischer@example.edu", "https://example.edu/staff/lena-fischer"),
]

if __name__ == "__main__":
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    for i in range(0, len(PEOPLE), 2):  # two people per page
        page = doc.new_page()
        y = 72
        for name, title, research, email, url in PEOPLE[i:i + 2]:
            page.insert_text((72, y), name, fontsize=16)
            y += 22
            page.insert_textbox(fitz.Rect(72, y, 520, y + 80),
                                f"{title}, Department of Business Development and Technology.\n"
                                f"Research interests: {research}", fontsize=11)
            y += 80
            page.insert_text((72, y), f"Email: {email}", fontsize=11)
            y += 18
            page.insert_text((72, y), "Staff profile", fontsize=11, color=(0, 0, 1))
            page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(70, y - 12, 160, y + 4), "uri": url})
            y += 60
    out = PDF_DIR / "sample_supervisors.pdf"
    doc.save(out)
    print(f"Wrote {out}")
