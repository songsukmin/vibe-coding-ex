// Simple markup -> docx builder for book manuscript
// Markup: "# " H1, "## " H2, "### " H3, "- " bullet, "> " callout,
// "!! " author box, "?? " interview question (inside author box block),
// "| a | b |" table, "~ " caption, "@PAGE" page break, "@TITLE a|b|c" cover.
const fs = require("fs");
const D = require("docx");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, LevelFormat, PageBreak, Footer, PageNumber } = D;

const FONT = "맑은 고딕";
const BOOK = process.env.BOOK === "1"; // 신국판 152x225mm
const PAGE_W = BOOK ? 8617 : 11906, PAGE_H = BOOK ? 12756 : 16838;
const MARGIN = BOOK ? 1077 : 1440, MARGIN_TB = BOOK ? 1134 : 1440, CONTENT_W = PAGE_W - MARGIN * 2;

function runs(text, base = {}) {
  const out = [];
  text.split(/(\*\*[^*]+\*\*)/).forEach(seg => {
    if (!seg) return;
    const b = seg.startsWith("**") && seg.endsWith("**");
    out.push(new TextRun({ text: b ? seg.slice(2, -2) : seg, bold: b || base.bold, ...base, ...(b ? { bold: true } : {}) }));
  });
  return out;
}
const border = (c) => ({ style: BorderStyle.SINGLE, size: 4, color: c });

function box(lines, fill, borderColor, label) {
  const children = [];
  if (label) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: label, bold: true, color: "7A4B00" })] }));
  lines.forEach(l => {
    if (l.startsWith("?? ")) children.push(new Paragraph({ numbering: { reference: "q", level: 0 }, spacing: { after: 80, line: 360 }, children: runs(l.slice(3)) }));
    else children.push(new Paragraph({ spacing: { after: 80, line: 360 }, children: runs(l) }));
  });
  const b = border(borderColor);
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill, color: "auto" },
      borders: { top: b, bottom: b, left: b, right: b },
      margins: { top: 160, bottom: 160, left: 220, right: 220 },
      children })] })],
  });
}

function table(rows) {
  const cells = rows.map(r => r.replace(/^\||\|$/g, "").split("|").map(s => s.trim()));
  const n = cells[0].length;
  const first = Math.round(CONTENT_W * (n > 3 ? 0.28 : 0.34));
  const rest = Math.floor((CONTENT_W - first) / (n - 1));
  const widths = [CONTENT_W - rest * (n - 1), ...Array(n - 1).fill(rest)];
  const b = border("BFBFBF");
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: cells.map((r, i) => new TableRow({ tableHeader: i === 0, children: r.map((c, j) => new TableCell({
      width: { size: widths[j], type: WidthType.DXA },
      shading: i === 0 ? { type: ShadingType.CLEAR, fill: "1F3A5F", color: "auto" } : (j === 0 ? { type: ShadingType.CLEAR, fill: "F2F4F7", color: "auto" } : undefined),
      borders: { top: b, bottom: b, left: b, right: b },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ alignment: j === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
        children: runs(c, i === 0 ? { bold: true, color: "FFFFFF", size: 19 } : { size: 19 }) })],
    })) })),
  });
}

function build(src, out, footerText) {
  const lines = fs.readFileSync(src, "utf8").split("\n");
  const kids = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i].trimEnd();
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("@TITLE ")) {
      const [t, sub, meta] = l.slice(7).split("|");
      kids.push(new Paragraph({ spacing: { before: 3000, after: 300 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, bold: true, size: 56, color: "1F3A5F" })] }));
      if (sub) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [new TextRun({ text: sub, size: 28, color: "555555" })] }));
      if (meta) meta.split(";").forEach(m => kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: m, size: 22, color: "333333" })] })));
      kids.push(new Paragraph({ children: [new PageBreak()] }));
      i++; continue;
    }
    if (l === "@PAGE") { kids.push(new Paragraph({ children: [new PageBreak()] })); i++; continue; }
    if (l.startsWith("### ")) { kids.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(l.slice(4)) })); i++; continue; }
    if (l.startsWith("## ")) { kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(l.slice(3)) })); i++; continue; }
    if (l.startsWith("# ")) { kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(l.slice(2)) })); i++; continue; }
    if (l.startsWith("- ")) { kids.push(new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 80, line: 360 }, children: runs(l.slice(2)) })); i++; continue; }
    if (l.startsWith("  - ")) { kids.push(new Paragraph({ numbering: { reference: "b", level: 1 }, spacing: { after: 60, line: 340 }, children: runs(l.slice(4)) })); i++; continue; }
    if (l.startsWith("~ ")) { kids.push(new Paragraph({ spacing: { before: 60, after: 240 }, children: [new TextRun({ text: l.slice(2), size: 18, color: "777777", italics: true })] })); i++; continue; }
    if (l.startsWith("|")) {
      const rows = []; while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++].trim());
      kids.push(table(rows)); continue;
    }
    if (l.startsWith("> ")) {
      const rows = []; while (i < lines.length && lines[i].startsWith("> ")) rows.push(lines[i++].slice(2));
      kids.push(box(rows, "EEF3F8", "9DB3CC")); kids.push(new Paragraph({ spacing: { after: 120 }, children: [] })); continue;
    }
    if (l.startsWith("!! ")) {
      const label = l.slice(3); i++;
      const rows = []; while (i < lines.length && (lines[i].startsWith("?? ") || lines[i].startsWith(".. "))) { const x = lines[i++]; rows.push(x.startsWith(".. ") ? x.slice(3) : x); }
      kids.push(box(rows, "FFF6DD", "E0B84C", label)); kids.push(new Paragraph({ spacing: { after: 120 }, children: [] })); continue;
    }
    kids.push(new Paragraph({ spacing: { after: 160, line: 384 }, alignment: AlignmentType.JUSTIFIED, children: runs(l) }));
    i++;
  }
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: BOOK ? 19 : 21 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 36, bold: true, color: "1F3A5F", font: FONT }, paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, color: "1F3A5F", font: FONT }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true, color: "333333", font: FONT }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [
      { reference: "b", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 900, hanging: 260 } } } }] },
      { reference: "q", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "Q%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 520, hanging: 420 } } } }] },
    ] },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN_TB, bottom: MARGIN_TB, left: MARGIN, right: MARGIN } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: footerText + "  ·  ", size: 16, color: "999999" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" })] })] }) },
      children: kids,
    }],
  });
  return Packer.toBuffer(doc).then(b => fs.writeFileSync(out, b));
}

const [src, out, footer] = process.argv.slice(2);
build(src, out, footer || "").then(() => console.log("wrote", out));
