"""Parse bounded PDFs in a separate process; never silently OCR scanned pages."""
import io
import json
import sys
try:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (18, 18))
    resource.setrlimit(resource.RLIMIT_AS, (768*1024*1024, 768*1024*1024))
except (ImportError, ValueError, OSError):
    pass
from pypdf import PdfReader
body = sys.stdin.buffer.read(3_000_001)
if len(body) > 3_000_000:
    raise ValueError("PDF exceeds document budget")
reader = PdfReader(io.BytesIO(body), strict=False)
if reader.is_encrypted:
    raise ValueError("Encrypted PDF is not an approved crawl target")
blocks = []
for index, page in enumerate(reader.pages):
    if index >= 60:
        break
    text = page.extract_text() or ""
    blocks.extend(f"[PDF page {index+1}] {line}" for line in text.splitlines() if line.strip())
    if sum(map(len, blocks)) > 400000:
        break
json.dump({"title": str((reader.metadata or {}).get('/Title', 'PDF document')), "blocks": blocks, "links": [], "truncated": len(reader.pages)>60}, sys.stdout)
