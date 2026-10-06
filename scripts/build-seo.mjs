#!/usr/bin/env node
/* 3NDING SEO + GEO build step (Node 18+, no dependencies). Built for up to ~5,000 books.
 *
 *   node scripts/build-seo.mjs            validate, then generate everything
 *   node scripts/build-seo.mjs --strict   treat warnings (e.g. missing descriptions) as errors
 *   node scripts/build-seo.mjs --check    validate only, write nothing
 *
 * Env: SITE_URL (default https://3nding.top), OG_IMAGE (path or URL)
 *
 * books.json fields: id, title, author, added (YYYY-MM-DD), cover, zip   (required)
 *                    description, excerpt (array of paragraphs), language, tags (array), genre (optional)
 *
 * 1. VALIDATES books.json (stops before writing anything if there are errors).
 * 2. book/<id>.html          one static page per book, with related books (same author > shared tags > neighbours)
 * 3. library/<n>.html        paginated A-Z catalogue (60 per page): a crawlable path to every book (noindex,follow)
 * 4. index.html              canonical/OG/JSON-LD + only the first 12 books prerendered + link to the catalogue
 * 5. sitemap.xml (split into sitemap-N.xml + an index above 40,000 URLs), robots.txt, llms.txt (newest 100 books)
 * Safe to re-run: injected blocks live between <!-- seo:NAME:start/end --> markers.
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.env.SITE_URL || "https://3nding.top").replace(/\/+$/, "");
const STRICT = process.argv.includes("--strict");
const CHECK_ONLY = process.argv.includes("--check");
const NAME = "3NDING";
const TITLE = "3NDING — Browse the library";
const DESC = "Browse, favorite and read books in the 3NDING library, online or offline.";
const HOME_COUNT = 12;
const ARCHIVE_SIZE = 60;
const SITEMAP_MAX = 40000;
const LLMS_MAX = 100;
const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Literata:opsz,wght@7..72,400..700&display=swap";

const exists = (f) => access(path.join(ROOT, f)).then(() => true, () => false);
const read = (f) => readFile(path.join(ROOT, f), "utf8");
async function write(f, s) {
  const p = path.join(ROOT, f);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, s);
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const json = (o) =>
  `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const isRemote = (u) => /^https?:\/\//.test(u);
const abs = (p) => (isRemote(p) ? p : `${SITE}/${p.replace(/^\/+/, "")}`);
const bookPath = (b) => `book/${b.id}.html`;
const describe = (b) =>
  b.description ||
  `${b.title} by ${b.author}. Read it online or save it for offline reading in the ${NAME} library.`;
const norm = (s) => String(s).trim().toLowerCase();

/* ================= 1. Validation ================= */
async function validate(raw) {
  const errors = [];
  const warns = [];
  if (!Array.isArray(raw)) return { errors: ["books.json must be a JSON array"], warns, books: [] };
  const ids = new Set();
  const zips = new Set();
  const descs = new Map();
  const noDesc = [];
  for (const [i, b] of raw.entries()) {
    const at = `entry #${i + 1}${b && b.id ? ` (${b.id})` : ""}`;
    if (!b || typeof b !== "object") { errors.push(`${at}: not an object`); continue; }
    for (const k of ["id", "title", "author", "cover", "zip"])
      if (typeof b[k] !== "string" || !b[k].trim()) errors.push(`${at}: missing "${k}"`);
    if (typeof b.id === "string") {
      if (!/^[\w-]+$/.test(b.id)) errors.push(`${at}: id may only contain letters, digits, _ and -`);
      if (ids.has(b.id)) errors.push(`${at}: duplicate id`);
      ids.add(b.id);
    }
    if (typeof b.zip === "string" && b.zip) {
      if (!b.zip.endsWith(".zip")) errors.push(`${at}: zip must end in .zip`);
      if (zips.has(b.zip)) errors.push(`${at}: zip used by another book`);
      zips.add(b.zip);
      if (!(await exists(b.zip.split("?")[0]))) errors.push(`${at}: zip file not found: ${b.zip}`);
      const base = path.basename(b.zip.split("?")[0], ".zip");
      if (b.id && base !== b.id) warns.push(`${at}: id differs from zip file name "${base}" (the app's convention is that they match)`);
    }
    if (typeof b.cover === "string" && b.cover && !isRemote(b.cover) && !(await exists(b.cover)))
      errors.push(`${at}: cover file not found: ${b.cover}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.added)) || Number.isNaN(Date.parse(b.added)))
      errors.push(`${at}: "added" must be a valid YYYY-MM-DD date`);
    if (b.excerpt !== undefined && !(Array.isArray(b.excerpt) && b.excerpt.every((p) => typeof p === "string")))
      errors.push(`${at}: excerpt must be an array of strings`);
    if (b.tags !== undefined && !(Array.isArray(b.tags) && b.tags.every((t) => typeof t === "string")))
      errors.push(`${at}: tags must be an array of strings`);
    if (!b.description) noDesc.push(b.title || b.id || at);
    else {
      const n = b.description.length;
      if (n < 60 || n > 300) warns.push(`${at}: description is ${n} characters (aim for 60-300)`);
      descs.set(b.description, (descs.get(b.description) || 0) + 1);
    }
  }
  if (noDesc.length)
    warns.push(`${noDesc.length} book(s) have no description and get a generic one (first: ${noDesc.slice(0, 3).join("; ")})`);
  for (const [d, n] of descs) if (n > 1) warns.push(`${n} books share the same description: "${d.slice(0, 50)}..."`);
  return { errors, warns, books: raw };
}

const raw = JSON.parse(await read("books.json"));
const { errors, warns, books } = await validate(raw);
for (const w of warns) console.warn("warning:", w);
if (errors.length || (STRICT && warns.length)) {
  for (const e of errors) console.error("error:", e);
  console.error(`\nStopped: ${errors.length} error(s)${STRICT ? `, ${warns.length} warning(s) (--strict)` : ""}. Nothing was written.`);
  process.exit(1);
}
if (SITE.includes("example.com")) console.warn("warning: SITE_URL looks like a placeholder");
if (CHECK_ONLY) { console.log(`OK: ${books.length} books valid, ${warns.length} warning(s).`); process.exit(0); }

books.forEach((b, i) => (b.order = i));
const byId = new Map(books.map((b) => [b.id, b]));
const ogImage = abs(process.env.OG_IMAGE || books[0]?.cover || "icons/icon-512.png");
const newest = [...books].sort((a, b) => (b.added || "").localeCompare(a.added || "") || b.order - a.order);
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const alpha = [...books].sort((a, b) => collator.compare(a.title, b.title));
const latest = newest[0]?.added;

/* ================= Related books ================= */
const tagsOf = (b) => [...(b.tags || []), ...(b.genre ? [b.genre] : [])].map(norm).filter(Boolean);
const byAuthor = new Map();
const byTag = new Map();
const push = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]));
for (const b of books) { push(byAuthor, norm(b.author), b); tagsOf(b).forEach((t) => push(byTag, t, b)); }
function related(b, n = 4) {
  const out = new Map();
  const add = (x) => { if (x && x.id !== b.id && out.size < n) out.set(x.id, x); };
  (byAuthor.get(norm(b.author)) || []).forEach(add);
  const score = new Map();
  for (const t of tagsOf(b))
    for (const x of byTag.get(t) || []) if (x.id !== b.id) score.set(x.id, (score.get(x.id) || 0) + 1);
  [...score].sort((p, q) => q[1] - p[1] || byId.get(p[0]).order - byId.get(q[0]).order).forEach(([id]) => add(byId.get(id)));
  for (let i = 1; out.size < n && i < books.length; i++) add(books[(b.order + i) % books.length]);
  return [...out.values()];
}

/* ================= Shared HTML ================= */
const coverSrc = (b, prefix) => `${isRemote(b.cover) ? "" : prefix}${esc(b.cover)}`;
const card = (b, prefix = "") =>
  `<li class="card"><a class="cover" href="${prefix}${bookPath(b)}"><img src="${coverSrc(b, prefix)}" alt="Cover of ${esc(b.title)}" loading="lazy" width="600" height="800"></a><div><h3><a href="${prefix}${bookPath(b)}">${esc(b.title)}</a></h3><p class="meta">${esc(b.author)}</p></div></li>`;

function innerPage({ title, desc, url, robots, ogType = "website", img, ld, body, style = "", lang = "en" }) {
  return `<!doctype html>
<html lang="${esc(lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${robots}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="${NAME}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${esc(img)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${esc(img)}" />
    <meta name="theme-color" content="#f5f6f8" />
    <link rel="icon" href="../icons/icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${FONTS}" />
    <link rel="stylesheet" href="../css/style.css" />
    <style>${style}</style>
    ${ld ? json(ld) : ""}
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="../index.html">${NAME}</a>
      <nav aria-label="Main">
        <a href="../index.html"><span class="lbl">Browse</span></a>
        <a href="../favorites.html"><span class="lbl">Favorites</span></a>
      </nav>
    </header>
    <main class="page">
${body}
    </main>
    <footer class="site-footer">
      <div class="sf-base"><p>Your favorites, progress and streaks stay on this device.</p><p>&copy; ${new Date().getFullYear()} ${NAME}</p></div>
    </footer>
  </body>
</html>
`;
}

function bookPage(b) {
  const url = abs(bookPath(b));
  const desc = describe(b);
  const cover = abs(b.cover);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Book", "@id": `${url}#book`, name: b.title, url, image: cover, description: desc,
        inLanguage: b.language || "en",
        author: { "@type": "Person", name: b.author },
        ...(tagsOf(b).length ? { keywords: tagsOf(b).join(", ") } : {}),
        potentialAction: { "@type": "ReadAction", target: abs(`reader.html?id=${encodeURIComponent(b.id)}`) },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Library", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: b.title, item: url },
        ],
      },
    ],
  };
  const excerpt = Array.isArray(b.excerpt) && b.excerpt.length
    ? `      <section><h2 class="section-title">From the opening</h2>${b.excerpt.map((p) => `<p class="page-sub">${esc(p)}</p>`).join("")}</section>\n` : "";
  const body = `      <nav class="page-sub" aria-label="Breadcrumb"><a href="../index.html">Library</a> › ${esc(b.title)}</nav>
      <article class="book-hero">
        <span class="cover"><img src="${coverSrc(b, "../")}" alt="Cover of ${esc(b.title)}" width="600" height="800" fetchpriority="high" /></span>
        <div>
          <h1 class="page-title">${esc(b.title)}</h1>
          <p class="page-sub">by ${esc(b.author)}</p>
          <p>${esc(desc)}</p>
          <dl>
            <dt>Author</dt><dd>${esc(b.author)}</dd>
            ${tagsOf(b).length ? `<dt>Topics</dt><dd>${esc(tagsOf(b).join(", "))}</dd>` : ""}
            ${b.added ? `<dt>Added</dt><dd><time datetime="${esc(b.added)}">${esc(b.added)}</time></dd>` : ""}
            <dt>Reading</dt><dd>Online or offline, with adjustable text</dd>
          </dl>
          <a class="btn btn-primary" href="../reader.html?id=${encodeURIComponent(b.id)}">Read online</a>
        </div>
      </article>
${excerpt}      <section>
        <h2 class="section-title">More to read</h2>
        <ul class="grid">${related(b).map((r) => card(r, "../")).join("")}</ul>
        <p class="page-sub"><a href="../library/1.html">Browse the complete catalogue</a></p>
      </section>`;
  return innerPage({
    title: `${b.title} by ${b.author} — Read online | ${NAME}`, desc, url,
    robots: "index, follow, max-image-preview:large", ogType: "book", img: cover, ld, body, lang: b.language || "en",
    style: `.book-hero{display:grid;grid-template-columns:minmax(120px,220px) 1fr;gap:24px 32px;align-items:start}.book-hero .cover{max-width:220px}.book-hero dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:20px 0;color:var(--muted)}.book-hero dd{margin:0;color:var(--ink)}@media (max-width:560px){.book-hero{grid-template-columns:110px 1fr;gap:16px}}`,
  });
}

/* ================= Archive pages ================= */
const archiveTotal = Math.max(1, Math.ceil(alpha.length / ARCHIVE_SIZE));
function pageNumbers(cur, total) {
  const keep = new Set([1, total, cur - 2, cur - 1, cur, cur + 1, cur + 2]);
  const nums = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push("gap"); out.push(n); });
  return out;
}
function archivePage(n) {
  const slice = alpha.slice((n - 1) * ARCHIVE_SIZE, n * ARCHIVE_SIZE);
  const url = abs(`library/${n}.html`);
  const link = (to, label, cur) =>
    `<a class="pg" href="${to}.html"${cur ? ' aria-current="page"' : ""}${typeof label === "number" ? ` aria-label="Page ${label}"` : ""}>${label}</a>`;
  const pager = `<nav class="pager" aria-label="Pagination">${n > 1 ? link(n - 1, "Previous") : ""}${pageNumbers(n, archiveTotal)
    .map((it) => (it === "gap" ? '<span class="gap" aria-hidden="true">…</span>' : link(it, it, it === n)))
    .join("")}${n < archiveTotal ? link(n + 1, "Next") : ""}</nav>`;
  const body = `      <nav class="page-sub" aria-label="Breadcrumb"><a href="../index.html">Library</a> › Catalogue</nav>
      <h1 class="page-title">All books, A–Z</h1>
      <p class="page-sub">Page ${n} of ${archiveTotal} · ${books.length} books</p>
      <ul class="grid">${slice.map((b) => card(b, "../")).join("")}</ul>
      ${pager}`;
  return innerPage({
    title: `All books, A–Z — page ${n} | ${NAME}`, desc: `Complete ${NAME} catalogue, A–Z, page ${n} of ${archiveTotal}.`,
    url, robots: "noindex, follow", img: ogImage, body, style: `.pager .pg{text-decoration:none}`,
  });
}

/* ================= Injection helpers ================= */
function inject(html, name, content, anchor) {
  const start = `<!-- seo:${name}:start -->`;
  const end = `<!-- seo:${name}:end -->`;
  const block = `${start}\n${content}\n${end}`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (re.test(html)) return html.replace(re, () => block);
  const out = anchor(html, block);
  if (out === html) console.warn(`warning: could not place "${name}" block`);
  return out;
}
const intoHead = (html, block) => html.replace("</head>", () => `${block}\n  </head>`);

/* ================= Write everything ================= */
let written = 0;
const out = async (f, s) => { await write(f, s); written++; };

for (const b of books) await out(bookPath(b), bookPage(b));
for (let n = 1; n <= archiveTotal; n++) await out(`library/${n}.html`, archivePage(n));

{
  const first = newest.slice(0, HOME_COUNT);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE}/#org`, name: NAME, url: `${SITE}/`, logo: abs("icons/icon-512.png") },
      { "@type": "WebSite", "@id": `${SITE}/#site`, name: NAME, url: `${SITE}/`, description: DESC, publisher: { "@id": `${SITE}/#org` }, inLanguage: "en" },
      {
        "@type": "ItemList", name: "Newest books", numberOfItems: books.length,
        itemListElement: first.map((b, i) => ({ "@type": "ListItem", position: i + 1, url: abs(bookPath(b)), name: b.title })),
      },
    ],
  };
  const head = `    <link rel="canonical" href="${SITE}/" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${NAME}" />
    <meta property="og:title" content="${esc(TITLE)}" />
    <meta property="og:description" content="${esc(DESC)}" />
    <meta property="og:url" content="${SITE}/" />
    <meta property="og:image" content="${esc(ogImage)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(TITLE)}" />
    <meta name="twitter:description" content="${esc(DESC)}" />
    <meta name="twitter:image" content="${esc(ogImage)}" />
    ${json(ld)}`;
  let html = await read("index.html");
  html = inject(html, "head", head, intoHead);
  html = inject(html, "grid", first.map((b) => card(b)).join(""), (h, block) =>
    h.replace('<ul class="grid" id="grid"></ul>', () => `<ul class="grid" id="grid">${block}</ul>`));
  html = inject(html, "catalog",
    `      <p class="page-sub"><a href="library/1.html">Browse the complete catalogue (${books.length} books, A–Z)</a></p>`,
    (h, block) => h.replace("</main>", () => `${block}\n    </main>`));
  await out("index.html", html);
}

for (const f of ["favorites.html", "reader.html"]) {
  let html = await read(f);
  html = inject(html, "head", `    <meta name="robots" content="noindex, follow" />`, intoHead);
  await out(f, html);
}

/* sitemap: books only (archive pages are crawl paths, kept out of the index) */
const urlEntry = (b) => `<url><loc>${abs(bookPath(b))}</loc>${b.added ? `<lastmod>${esc(b.added)}</lastmod>` : ""}<priority>0.8</priority></url>`;
const homeEntry = `<url><loc>${SITE}/</loc>${latest ? `<lastmod>${latest}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>1.0</priority></url>`;
const urlset = (items) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</urlset>\n`;
const entries = [homeEntry, ...books.map(urlEntry)];
if (entries.length <= SITEMAP_MAX) await out("sitemap.xml", urlset(entries));
else {
  const parts = [];
  for (let i = 0; i < entries.length; i += SITEMAP_MAX) parts.push(entries.slice(i, i + SITEMAP_MAX));
  for (const [i, p] of parts.entries()) await out(`sitemap-${i + 1}.xml`, urlset(p));
  await out("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts.map((_, i) => `<sitemap><loc>${SITE}/sitemap-${i + 1}.xml</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`);
}

const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"];
await out("robots.txt", `User-agent: *\nAllow: /\n\n${aiBots.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n")}\nSitemap: ${SITE}/sitemap.xml\n`);

await out("llms.txt",
  `# ${NAME}\n\n> ${DESC} A library of ${books.length} books to read in the browser or save for offline reading. Favorites, progress and reading streaks are stored only on the reader's device.\n\n## Newest books\n\n${newest.slice(0, LLMS_MAX).map((b) => `- [${b.title}](${abs(bookPath(b))}): by ${b.author}. ${describe(b)}`).join("\n")}\n\n## Full catalogue\n\n- [All books, A–Z](${SITE}/library/1.html)\n- [Sitemap](${SITE}/sitemap.xml)\n`);

console.log(`Done: ${books.length} books, ${archiveTotal} catalogue page(s), ${written} files written, ${warns.length} warning(s). Site: ${SITE}`);
