import sys
sys.stdout.reconfigure(encoding="utf-8")
path,kind=sys.argv[1:]
if kind=='.pdf':
 from pypdf import PdfReader
 print('\n'.join((page.extract_text() or '') for page in PdfReader(path).pages)[:20000])
elif kind=='.docx':
 from docx import Document
 doc=Document(path)
 print('\n'.join([p.text for p in doc.paragraphs]+[' | '.join(c.text for c in row.cells) for table in doc.tables for row in table.rows])[:20000])
