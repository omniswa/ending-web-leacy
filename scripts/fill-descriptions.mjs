#!/usr/bin/env node
/* Fills in missing book descriptions from each book's own text (Node 18+, no dependencies).
 *
 *   node scripts/fill-descriptions.mjs                 preview proposals, write nothing
 *   node scripts/fill-descriptions.mjs --write         save them into books.json
 *   node scripts/fill-descriptions.mjs --excerpt       also propose an "opening" excerpt
 *   node scripts/fill-descriptions.mjs --force         redo books that already have one
 *
 * For every book without a "description", it opens the book's zip, finds the first
 * real paragraph of the first chapter and turns it into a 60-300 character description
 * (cut at a sentence boundary). With --excerpt it also stores the first two paragraphs
 * as "excerpt", which build-seo.mjs renders as a "From the opening" section.
 *
 * These are STARTING POINTS taken from the opening text: read them, and replace any
 * that don't describe the book well. Hand-written blurbs are better for SEO.
 * Then run: node scripts/build-seo.mjs --strict
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const FORCE = process.argv.includes("--force");
const EXCERPT = process.argv.includes("--excerpt");
const DESC_MAX = 250;
const DESC_MIN = 60;
const EXCERPT_PARAS = 2;
const EXCERPT_MAX = 500;

/* ---- minimal zip reader (same format support as js/app.js: stored + deflate) ---- */
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a valid zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged zip");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    entries.set(name, { method, data: buf.subarray(start, start + size) });
  }
  return (name) => {
    const key = entries.has(name) ? name : [...entries.keys()].find((k) => k.endsWith("/" + name));
    if (!key) throw new Error(`"${name}" not found in zip`);
    const { method, data } = entries.get(key);
    if (method === 0) return data.toString("utf8");
    if (method === 8) return inflateRawSync(data).toString("utf8");
    throw new Error("unsupported zip compression");
  };
}

/* ---- text helpers ---- */
const squash = (s) => s.replace(/\s+/g, " ").trim();
const sentences = (s) => s.split(/(?<=[.!?…])["”’')\]]*\s+/).map((x) => x.trim()).filter(Boolean);

function cutAtWord(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:—–-]+$/, "") + "…";
}

function describe(paragraphs) {
  const text = squash(paragraphs.join(" "));
  let out = "";
  for (const s of sentences(text)) {
    if (out && out.length + 1 + s.length > DESC_MAX) break;
    out = out ? `${out} ${s}` : s;
    if (out.length >= 140) break;
  }
  if (out.length > DESC_MAX) out = cutAtWord(out, DESC_MAX);
  return out;
}

function excerpt(paragraphs) {
  return paragraphs.slice(0, EXCERPT_PARAS).map((p) => {
    const t = squash(p);
    if (t.length <= EXCERPT_MAX) return t;
    let out = "";
    for (const s of sentences(t)) {
      if (out && out.length + 1 + s.length > EXCERPT_MAX) break;
      out = out ? `${out} ${s}` : s;
    }
    return out.length > EXCERPT_MAX || !out ? cutAtWord(t, EXCERPT_MAX) : out;
  });
}

/* Real prose paragraphs of the first chapter that has any (skips heading-like lines) */
function openingParagraphs(read) {
  const manifest = JSON.parse(read("manifest.json"));
  for (const ch of manifest.chapters || []) {
    const title = squash(String(ch.title || "")).toLowerCase();
    const paras = read(ch.file)
      .trim()
      .split(/\n\s*\n/)
      .map(squash)
      .filter(Boolean)
      .filter((p) => p.toLowerCase() !== title && !(p.length < 40 && !/[.!?…"”’]$/.test(p)));
    if (paras.length) return paras;
  }
  return [];
}

/* ---- main ---- */
const file = path.join(ROOT, "books.json");
const books = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(books)) throw new Error("books.json must be a JSON array");

let filled = 0;
const problems = [];
for (const b of books) {
  if (b.description && !FORCE) continue;
  try {
    const buf = await readFile(path.join(ROOT, String(b.zip).split("?")[0]));
    const paras = openingParagraphs(readZip(buf));
    if (!paras.length) throw new Error("no readable text found");
    const description = describe(paras);
    if (description.length < DESC_MIN) problems.push(`${b.id}: description is short (${description.length} chars), check it`);
    b.description = description;
    if (EXCERPT && (!b.excerpt || FORCE)) b.excerpt = excerpt(paras);
    filled++;
    console.log(`\n${b.title}  (${b.id})\n  ${description.length} chars: ${description}`);
    if (EXCERPT) console.log(`  excerpt: ${b.excerpt.length} paragraph(s)`);
  } catch (err) {
    problems.push(`${b.id}: skipped, ${err.message}`);
  }
}

const seen = new Map();
for (const b of books) if (b.description) seen.set(b.description, (seen.get(b.description) || 0) + 1);
for (const [d, n] of seen) if (n > 1) problems.push(`${n} books share the description "${d.slice(0, 50)}…"`);

console.log(`\n${filled} description(s) ${WRITE ? "written" : "proposed"}.`);
for (const p of problems) console.warn("warning:", p);

if (WRITE && filled) {
  await writeFile(file, JSON.stringify(books, null, 2) + "\n");
  console.log("books.json updated. Next: node scripts/build-seo.mjs --strict");
} else if (!WRITE && filled) {
  console.log("Nothing saved. Re-run with --write to apply.");
}
