from io import BytesIO
from html import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image,
    KeepTogether,
)
from .config import DATA


def work_order_pdf(scan):
    stream = BytesIO()
    pdf = SimpleDocTemplate(
        stream,
        pagesize=(612, 792),
        rightMargin=42,
        leftMargin=42,
        topMargin=42,
        bottomMargin=42,
        title="Scout Radar inspection work order",
    )
    styles = getSampleStyleSheet()
    styles["Heading2"].spaceBefore = 9
    styles.add(
        ParagraphStyle(
            name="SmallNote",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#4b5852"),
        )
    )
    p = lambda text, style="BodyText": Paragraph(escape(str(text)), styles[style])
    r = scan["result"]
    w = scan["work_order"]
    story = [
        p("SCOUT / RADAR", "Title"),
        p("INSPECTION WORK ORDER", "Heading2"),
        p(
            w["id"] + " | " + scan["created_at"][:19].replace("T", " ") + " UTC",
            "SmallNote",
        ),
        Spacer(1, 14),
        p(scan["twin"]["name"], "Heading1"),
        p(f"{r['verdict']} - measured checks only", "Heading2"),
        p(
            f"Input: {scan['request']['mode'].upper()} | Profile: {scan['request']['profile']} | Agent: {scan['agent_provider']}"
        ),
        p(r["scope"], "SmallNote"),
        Spacer(1, 12),
        p(w["summary"]),
    ]
    if scan["request"]["mode"] == "demo":
        story += [
            p(
                "DEMONSTRATION: simulated sensor readings and illustrated camera evidence.",
                "Heading3",
            )
        ]
    if scan.get("ai_error"):
        story += [p(scan["ai_error"])]
    rows = [[p("Measurement"), p("Observed"), p("Requirement"), p("Result")]]
    for c in r["checks"]:
        value = (
            "Not measured"
            if c["value"] is None
            else f"{c['value']:.2f} +/- {c['error']:.2f} {c['unit']}"
        )
        limit = (
            (f">= {c['minimum']:.2f}" if c["minimum"] is not None else "")
            + (" to " if c["minimum"] is not None and c["maximum"] is not None else "")
            + (f"<= {c['maximum']:.2f}" if c["maximum"] is not None else "")
        )
        rows.append(
            [
                p(c["label"]),
                p(value),
                p(limit + " " + c["unit"] + " (sec. " + c["section"] + ")"),
                p(c["status"].replace("NOT_MEASURED", "UNMEASURED")),
            ]
        )
    table = Table(rows, colWidths=[120, 140, 160, 108], repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7efdf")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#dce3dc")),
            ]
        )
    )
    story += [
        Spacer(1, 14),
        table,
        p("Digital twin comparison", "Heading2"),
        p(
            f"Source: {scan['twin']['source']} | {scan['twin']['source_reference']}",
            "SmallNote",
        ),
    ]
    for d in r["drift"]:
        if d["measured"] is not None:
            story.append(
                p(
                    f"{d['label']}: baseline {d['expected']:.2f} {d['unit']}; observed {d['measured']:.2f}; drift {d['delta']:+.2f} {d['unit']}"
                )
            )
    story += [
        p("Corrective work", "Heading2"),
        p(f"Status: {w['status']} | Assignee: {w['assignee'] or 'Unassigned'}"),
    ]
    for i, a in enumerate(w["actions"], 1):
        cost = (
            "Estimate requires review"
            if a["estimate_low"] is None
            else f"Illustrative allowance: ${a['estimate_low']:,}-${a['estimate_high']:,}"
        )
        story.append(
            KeepTogether(
                [
                    p(f"{i}. {a['title']}", "Heading3"),
                    p(a["detail"]),
                    p(cost, "SmallNote"),
                ]
            )
        )
    story += [p(w["cost_note"], "SmallNote")]
    if w["notes"]:
        story += [p("Operator notes", "Heading3"), p(w["notes"])]
    if scan.get("diagnosis"):
        d = scan["diagnosis"]
        story += [
            p("Visual diagnosis", "Heading2"),
            p(d["obstruction"]),
            p(
                f"Provider: {d['provider']} | Classification: {d['classification']} | Model confidence (uncalibrated): {d['confidence']:.0%}",
                "SmallNote",
            ),
            p(d["limitations"], "SmallNote"),
        ]
    for item in scan.get("images", [])[:1]:
        path = DATA / "images" / item["id"]
        if path.exists():
            from PIL import Image as PILImage

            with PILImage.open(path) as im:
                width, height = im.size
            story += [
                Spacer(1, 12),
                Image(str(path), width=400, height=400 * height / width),
                p(
                    "Simulated illustration"
                    if item["simulated"]
                    else f"Captured at {item['angle_deg']:.0f} degrees",
                    "SmallNote",
                ),
            ]
    story += [
        p("Scope and source", "Heading2"),
        p(r["rule_version"], "SmallNote"),
        p("https://www.access-board.gov/ada/chapter/ch04/", "SmallNote"),
    ]
    scope_notes = [p(issue, "SmallNote") for issue in r["issues"] + r["limitations"]]
    story.append(KeepTogether(scope_notes))

    def footer(canvas, doc):
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#67766c"))
        canvas.drawString(42, 24, "SCOUT RADAR | " + w["id"])
        canvas.drawRightString(570, 24, f"Page {doc.page}")

    pdf.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()
