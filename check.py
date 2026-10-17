"""
Diagnose search problems step by step. Run from the project folder:

    python check.py
"""

import os

import rag

MSG = ("Hi, I am zobayer a ML focused student, I am interested in LLM, CV, and ML. "
       "Can you help me to find a supervisor for the TS1 project?")

print("1. rag.py in use:      ", rag.__file__)
print("   new version?        ", "YES" if "TS1" in rag.REWRITE_PROMPT else "NO  <-- old rag.py is being loaded")
print("2. API key set?        ", "YES" if os.getenv("LLM_API_KEY") else "NO  <-- rewrite is skipped without a key")
print("   model:              ", os.getenv("LLM_MODEL"))
print("   TOP_K:              ", rag.TOP_K)

print("3. Calling the LLM to rewrite the query...")
try:
    query = rag.search_query([{"role": "user", "content": MSG}])
    print("   rewritten query:    ", query)
    if query == MSG:
        print("   PROBLEM: the query came back unchanged")
except Exception as e:
    print("   API ERROR:          ", e)
    query = MSG

print("4. Search results for that query:")
index = rag.Index()
for i, h in enumerate(index.search(query), 1):
    print(f"   S{i} {h['score']:.3f}  {h['text'][:100]}")
