"""Extract text (and sheet rows) from an AI chat attachment.

Usage: python scripts/extract-ai-upload.py <file> <kind>
kind in {.xlsx, .docx, .pdf, .pptx}
Prints one JSON object: {"text": str, "rows": [[str,...],...]}
rows is only populated for .xlsx (first worksheet, values only; formulas are
never evaluated beyond cached values, macros are never executed).
"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

TEXT_CAP = 40000
ROW_CAP = 300
COL_CAP = 20


def cell_text(value):
    if value is None:
        return ""
    return str(value).strip()


def main():
    path, kind = sys.argv[1:]
    out = {"text": "", "rows": []}
    if kind == ".pdf":
        from pypdf import PdfReader

        pages = [(page.extract_text() or "") for page in PdfReader(path).pages]
        out["text"] = "\n".join(pages)[:TEXT_CAP]
    elif kind == ".docx":
        from docx import Document

        doc = Document(path)
        parts = [p.text for p in doc.paragraphs]
        parts += [" | ".join(c.text for c in row.cells) for table in doc.tables for row in table.rows]
        out["text"] = "\n".join(x for x in parts if x.strip())[:TEXT_CAP]
    elif kind == ".pptx":
        from pptx import Presentation

        prs = Presentation(path)
        parts = []
        for i, slide in enumerate(prs.slides, start=1):
            texts = []
            for shape in slide.shapes:
                if shape.has_text_frame:
                    t = shape.text_frame.text.strip()
                    if t:
                        texts.append(t)
                if getattr(shape, "has_table", False) and shape.has_table:
                    for row in shape.table.rows:
                        line = " | ".join(cell_text(c.text) for c in row.cells)
                        if line.strip(" |"):
                            texts.append(line)
            if texts:
                parts.append(f"[第{i}页]\n" + "\n".join(texts))
        out["text"] = "\n\n".join(parts)[:TEXT_CAP]
    elif kind == ".xlsx":
        import os
        import tempfile

        from openpyxl import load_workbook

        # openpyxl 校验扩展名，而服务端存储的上传件无扩展名：先复制到带 .xlsx 的临时文件
        src, tmp = path, None
        if not path.lower().endswith((".xlsx", ".xlsm", ".xltx", ".xltm")):
            fd, tmp = tempfile.mkstemp(suffix=".xlsx")
            os.close(fd)
            with open(path, "rb") as f_in, open(tmp, "wb") as f_out:
                f_out.write(f_in.read())
            src = tmp
        try:
            wb = load_workbook(src, read_only=True, data_only=True)
            ws = wb.worksheets[0]
            rows = []
            for row in ws.iter_rows(max_row=ROW_CAP, max_col=COL_CAP, values_only=True):
                rows.append([cell_text(v) for v in row])
            wb.close()
        finally:
            if tmp:
                os.remove(tmp)
        while rows and not any(r for r in rows[-1]):
            rows.pop()
        # openpyxl 会把每行填充到 max_col：裁掉整列全空的尾部列，避免表头校验误判
        if rows:
            last = 0
            for r in rows:
                for idx in range(len(r) - 1, -1, -1):
                    if r[idx]:
                        last = max(last, idx + 1)
                        break
            rows = [r[:last] for r in rows]
        out["rows"] = rows
        out["text"] = "\n".join("\t".join(r).rstrip() for r in rows[:200])[:TEXT_CAP]
    else:
        raise SystemExit("unsupported_kind:" + kind)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
