"""In-memory CSV/TSV → PDF rendering for the Layer-3 (Gemini) pipeline.

Most Gemini variants on Vertex AI accept PDF Parts more reliably than free-form
text payloads, especially for tabular data with mixed-width columns and
multi-section layouts. This helper takes raw CSV bytes (any delimiter the
sniffer recognises) and renders them as a single multi-page PDF using
ReportLab's `Table` flowable so column structure is preserved.

The PDF is *not* persisted to disk; it lives only in the bytes the caller
forwards to Gemini. Original CSV bytes remain stored under `data/uploads/...`.
"""

from __future__ import annotations

import csv as _csv
import io
import logging
from typing import Sequence

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
)

from app.services.extraction.csv_parser import _decode, _sniff_delimiter


logger = logging.getLogger(__name__)


def csv_bytes_to_pdf(content: bytes, *, file_name: str = "upload.csv") -> bytes:
    """Render the CSV/TSV as a landscape A4 PDF. Returns the raw PDF bytes.

    Empty / whitespace-only rows are preserved so section breaks in broker
    statements stay visually obvious to the model.
    """
    text = _decode(content)
    delimiter = _sniff_delimiter(text)
    reader = _csv.reader(io.StringIO(text), delimiter=delimiter)
    rows: list[list[str]] = [list(row) for row in reader]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        title=file_name,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"<b>Source file:</b> {file_name}", styles["Normal"]),
        Paragraph(f"<b>Detected delimiter:</b> {_delim_label(delimiter)}", styles["Normal"]),
        Spacer(1, 6),
    ]

    # Break long files into multiple Tables — ReportLab pages individually but
    # keeping each Table under ~80 rows avoids "table too tall for page" errors
    # when a single section is huge.
    for chunk in _chunk(rows, 80):
        table = Table(_truncate_cells(chunk), repeatRows=1)
        table.setStyle(_table_style(chunk))
        story.append(table)
        story.append(Spacer(1, 6))

    try:
        doc.build(story)
    except Exception:
        # Fallback: render a plaintext page so we always return *something*.
        logger.exception("ReportLab failed to render CSV; falling back to plaintext.")
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4)
        doc.build([Paragraph(line.replace("&", "&amp;").replace("<", "&lt;"), styles["Code"])
                   for line in text.splitlines()[:400]])

    return buf.getvalue()


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _chunk(rows: list[list[str]], n: int) -> list[list[list[str]]]:
    return [rows[i:i + n] for i in range(0, max(len(rows), 1), n)] or [[]]


def _truncate_cells(rows: list[list[str]], *, max_chars: int = 60) -> list[list[str]]:
    """Hard-cap per-cell width so a single bloated cell doesn't blow up
    column widths and force ReportLab to overflow the page."""
    out: list[list[str]] = []
    for row in rows:
        out.append([
            (c[:max_chars] + "…") if isinstance(c, str) and len(c) > max_chars else c
            for c in row
        ])
    return out


def _table_style(rows: Sequence[Sequence[str]]) -> TableStyle:
    style = TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("LEADING", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef5")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ])
    return style


def _delim_label(delim: str) -> str:
    return {",": "comma", "\t": "tab", ";": "semicolon", "|": "pipe"}.get(delim, repr(delim))
