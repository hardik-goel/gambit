/**
 * Turns one of Gambit's markdown documents into a single HTML file.
 *
 *   pnpm exec tsx scripts/dev/md-to-html.ts GAMBIT_E2E_TESTING.md ~/Downloads
 *
 * Self-contained by design: the styling is inline, so the file is one thing you
 * can send to somebody, open on a machine with no network, or keep. It wears
 * the product's own colours rather than a generic stylesheet, because a
 * document about Gambit that looks like nothing in particular is a document
 * nobody reads twice.
 *
 * Deliberately small: headings, paragraphs, tables, fenced code, lists, rules,
 * and inline emphasis, links and code. That is everything these documents use.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Emphasis, code and links — applied after escaping, never before. */
function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function render(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  let list: "ul" | "ol" | null = null;

  const closeList = (): void => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code, taken verbatim.
    if (line.startsWith("```")) {
      closeList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i]!), i++;
      i++;
      out.push(`<pre><code>${escape(body.join("\n"))}</code></pre>`);
      continue;
    }

    // Tables: a header row, a rule, then rows.
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[\s:|-]+\|$/)) {
      closeList();
      const cells = (row: string): string[] =>
        row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) body.push(cells(lines[i]!)), i++;
      out.push(
        `<div class="scroll"><table><thead><tr>${head
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push("<hr />");
      i++;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== "ul") closeList(), out.push("<ul>"), (list = "ul");
      out.push(`<li>${inline(bullet[1]!)}</li>`);
      i++;
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (list !== "ol") closeList(), out.push("<ol>"), (list = "ol");
      out.push(`<li>${inline(numbered[1]!)}</li>`);
      i++;
      continue;
    }

    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    // A paragraph runs until a blank line; markdown's single newlines are not
    // breaks, so they are joined.
    //
    // The terminators all require their trailing space. Without it, a paragraph
    // opening with **bold** looked like a bullet, ended the paragraph, failed
    // the bullet test, and was dropped — three paragraphs lost their first
    // words before anybody looked at the rendered page.
    const breaks = /^([-*]\s|\d+\.\s|#{1,4}\s|\||```|---)/;
    const paragraph: string[] = [lines[i]!.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() && !breaks.test(lines[i]!)) {
      paragraph.push(lines[i]!.trim());
      i++;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  closeList();
  return out.join("\n");
}

const STYLE = `
:root {
  --bg: #17100b; --panel: #211710; --panel2: #2a1e15; --line: #3a2b1f;
  --ink: #f2e7d5; --mut: #a89a86; --accent: #d8a05e;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.7 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  padding: 56px 22px 96px;
}
main { max-width: 780px; margin: 0 auto; }
h1 { font-size: 34px; letter-spacing: .01em; margin: 0 0 6px; }
h2 { font-size: 23px; margin: 44px 0 12px; padding-top: 18px; border-top: 1px solid var(--line); }
h3 { font-size: 18px; margin: 28px 0 8px; color: var(--accent); }
p { margin: 0 0 14px; }
a { color: var(--accent); }
strong { color: #fff8ec; }
hr { border: none; border-top: 1px solid var(--line); margin: 34px 0; }
ul, ol { margin: 0 0 16px; padding-left: 22px; }
li { margin: 6px 0; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .87em;
  background: var(--panel2); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px;
}
pre {
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 14px 16px; overflow-x: auto; margin: 0 0 18px;
}
pre code { background: none; border: none; padding: 0; font-size: 13.5px; line-height: 1.6; }
.scroll { overflow-x: auto; margin: 0 0 18px; }
table { border-collapse: collapse; width: 100%; font-size: 15px; }
th {
  text-align: left; font-weight: 400; font-size: 12px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--mut); padding: 8px 12px;
}
td { padding: 10px 12px; border-top: 1px solid var(--line); vertical-align: top; }
tbody tr:hover { background: var(--panel); }
footer { margin-top: 60px; color: var(--mut); font-size: 12.5px; text-align: center; }
@media print {
  body { background: #fff; color: #1a1a1a; padding: 0; }
  h2 { border-color: #ddd; } td { border-color: #eee; }
  pre, code { background: #f6f4f0; border-color: #e4e0d8; }
  a { color: #1a1a1a; }
}
`;

/**
 * Nothing may go missing between the markdown and the page.
 *
 * Comparison is on letters and digits only, on both sides: markup differs
 * between the two by definition, and a check that trips over an underscore is
 * a check that gets deleted rather than believed.
 */
function assertNothingDropped(markdown: string, html: string): void {
  const bare = (text: string): string => text.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const openings = markdown
    .split("\n")
    .filter((l) => l.trim() && !/^(#{1,4}\s|```|\||---)/.test(l))
    .map((l) => bare(l.trim().split(/\s+/).slice(0, 3).join("")))
    .filter((w) => w.length > 6);
  const text = bare(html.replace(/<[^>]+>/g, " "));
  const missing = openings.filter((w) => !text.includes(w));
  if (missing.length) {
    throw new Error(
      `these lines did not survive rendering: ${[...new Set(missing)].slice(0, 5).join(", ")}`
    );
  }
}

function main(): void {
  const source = resolve(process.argv[2] ?? "GAMBIT_E2E_TESTING.md");
  const target = (process.argv[3] ?? join(homedir(), "Downloads")).replace(/^~/, homedir());
  const markdown = readFileSync(source, "utf8");
  const title = /^#\s+(.*)$/m.exec(markdown)?.[1] ?? basename(source);
  const name = basename(source).replace(/\.md$/i, "").toLowerCase().replace(/_/g, "-");
  const file = join(target, `${name}.html`);

  const body = render(markdown);
  assertNothingDropped(markdown, body);

  writeFileSync(
    file,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
<footer>Gambit · generated from ${escape(basename(source))}</footer>
</main>
</body>
</html>
`
  );
  console.log(file);
}

main();
