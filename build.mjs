// junyeol.net — static site build.
// Reads content/ (edited through Pages CMS or by hand), writes dist/.
// Images are resized and converted to WebP at build time, so you can upload plain JPG/PNG.
//
//   npm run build            → dist/
//   BASE=/junyeol.net/ npm run build   (when served from a sub-path)

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { marked } from "marked";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const CONTENT = path.join(ROOT, "content");
const MEDIA_IN = path.join(CONTENT, "media");
const DIST = path.join(ROOT, "dist");
const CACHE = path.join(ROOT, ".cache", "img");
const BASE = ("/" + (process.env.BASE || "/").replace(/^\/+|\/+$/g, "") + "/").replace("//", "/");
const SITE_URL = (process.env.SITE_URL || "").replace(/\/+$/, "");

const WIDTHS = [640, 1280, 2000];
const VIDEO = new Set([".mp4", ".webm", ".mov"]);
const PASSTHROUGH = new Set([".gif", ".svg"]);

// ───────────────────────── helpers
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const url = (p = "") => BASE + String(p).replace(/^\/+/, "");
const md = (s = "") => (s ? marked.parse(String(s), { breaks: false }) : "");
const lines = (s = "") => String(s).split("\n").map((l) => l.trim()).filter(Boolean);
const readJSON = async (f) => JSON.parse(await fs.readFile(f, "utf8"));

async function write(rel, data) {
  const out = path.join(DIST, rel);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, data);
}

// ───────────────────────── images
const imageCache = new Map();

// "/media/foo/bar.jpg" → { kind, sources, src, width, height }
async function processMedia(ref) {
  if (!ref) return null;
  if (imageCache.has(ref)) return imageCache.get(ref);
  const rel = String(ref).replace(/^\/?media\//, "");
  const input = path.join(MEDIA_IN, rel);
  if (!existsSync(input)) {
    console.warn(`  ! missing media: ${ref}`);
    return null;
  }
  const ext = path.extname(rel).toLowerCase();
  const stem = rel.slice(0, -ext.length);
  let result;

  if (VIDEO.has(ext) || PASSTHROUGH.has(ext)) {
    await fs.mkdir(path.dirname(path.join(DIST, "media", rel)), { recursive: true });
    await fs.copyFile(input, path.join(DIST, "media", rel));
    result = { kind: VIDEO.has(ext) ? "video" : "image", src: url("media/" + rel), sources: null };
  } else {
    const buf = await fs.readFile(input);
    const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10);
    const meta = await sharp(buf).rotate().metadata();
    // EXIF-rotated images swap width/height
    const swap = meta.orientation && meta.orientation >= 5;
    const W = swap ? meta.height : meta.width;
    const H = swap ? meta.width : meta.height;
    const widths = WIDTHS.filter((w) => w < W).concat(W > WIDTHS.at(-1) ? [] : [W]);
    const finalWidths = [...new Set(widths.length ? widths : [W])].sort((a, b) => a - b);
    const sources = [];
    for (const w of finalWidths) {
      const name = `${stem}-${hash}-${w}.webp`;
      const cached = path.join(CACHE, name);
      if (!existsSync(cached)) {
        await fs.mkdir(path.dirname(cached), { recursive: true });
        await sharp(buf).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78, effort: 5 }).toFile(cached);
      }
      const out = path.join(DIST, "media", name);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.copyFile(cached, out);
      sources.push({ w, src: url("media/" + name) });
    }
    // small JPEG for link previews (iMessage, Slack, Instagram DMs read og:image)
    const ogName = `${stem}-${hash}-og.jpg`;
    const ogCached = path.join(CACHE, ogName);
    if (!existsSync(ogCached)) {
      await fs.mkdir(path.dirname(ogCached), { recursive: true });
      await sharp(buf).rotate().resize({ width: 1200, height: 630, fit: "cover" }).jpeg({ quality: 82 }).toFile(ogCached);
    }
    await fs.mkdir(path.dirname(path.join(DIST, "media", ogName)), { recursive: true });
    await fs.copyFile(ogCached, path.join(DIST, "media", ogName));

    result = {
      kind: "image",
      width: W,
      height: H,
      sources,
      src: sources.at(-1).src,
      small: sources[0].src,
      og: url("media/" + ogName),
    };
  }
  imageCache.set(ref, result);
  return result;
}

function img(m, { sizes = "100vw", alt = "", cls = "", eager = false } = {}) {
  if (!m) return "";
  if (m.kind === "video")
    return `<video class="${cls}" src="${m.src}" autoplay muted loop playsinline preload="metadata"></video>`;
  if (!m.sources) return `<img class="${cls}" src="${m.src}" alt="${esc(alt)}" loading="${eager ? "eager" : "lazy"}">`;
  const srcset = m.sources.map((s) => `${s.src} ${s.w}w`).join(", ");
  return `<img class="${cls}" src="${m.src}" srcset="${srcset}" sizes="${sizes}" width="${m.width}" height="${m.height}" alt="${esc(alt)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
}

// ───────────────────────── content
async function loadProjects() {
  const dir = path.join(CONTENT, "projects");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const items = [];
  for (const f of files) {
    const data = await readJSON(path.join(dir, f));
    if (data.draft) continue;
    const slug = f.replace(/\.json$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    items.push({ ...data, slug });
  }
  items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  for (const p of items) {
    p.coverImg = await processMedia(p.cover || p.media?.[0]?.image);
    p.mediaItems = [];
    for (const m of p.media || []) {
      const processed = await processMedia(m.video || m.image);
      if (processed) p.mediaItems.push({ ...m, img: processed });
    }
  }
  return items;
}

// ───────────────────────── templates
function layout({ site, title, description, ogImage, body, page, canonical }) {
  const fullTitle = title ? `${title} — ${site.name}` : `${site.name} — ${site.role}`;
  const desc = description || site.seo_description || site.role;
  const og = ogImage ? (SITE_URL ? SITE_URL + ogImage.replace(BASE, "/") : ogImage) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
${canonical && SITE_URL ? `<link rel="canonical" href="${SITE_URL}${canonical}">\n<meta property="og:url" content="${SITE_URL}${canonical}">` : ""}
${og ? `<meta property="og:image" content="${og}">\n<meta name="twitter:card" content="summary_large_image">` : ""}
<meta name="theme-color" content="#f3f2ee">
<link rel="icon" href="${url("favicon.svg")}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400&display=swap">
<link rel="stylesheet" href="${url("assets/styles.css")}?v=${BUILD_ID}">
<style>:root{--accent:${esc(site.accent || "#ff3b00")}}</style>
</head>
<body data-page="${page}">
<header class="site-header">
  <a class="site-name" href="${url("")}">${esc(site.name)}</a>
  <span class="site-role">${esc(site.role)}</span>
  <nav class="site-nav">
    <a href="${url("")}"${page === "index" ? ' aria-current="page"' : ""}>Index</a>
    <a href="${url("info/")}"${page === "info" ? ' aria-current="page"' : ""}>Information</a>
    ${site.email ? `<a href="mailto:${esc(site.email)}">Contact</a>` : ""}
  </nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <span>© ${new Date().getFullYear()} ${esc(site.name)}</span>
  <span>${esc(site.location || "")}</span>
  ${site.email ? `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>` : "<span></span>"}
</footer>
<script src="${url("assets/main.js")}?v=${BUILD_ID}" defer></script>
</body>
</html>`;
}

function indexPage(site, projects) {
  const cats = [...new Set(projects.map((p) => p.category).filter(Boolean))];
  const rows = projects
    .map((p, i) => {
      const n = String(i + 1).padStart(2, "0");
      const preview = p.coverImg && p.coverImg.sources ? p.coverImg.sources.find((s) => s.w >= 1280)?.src || p.coverImg.src : p.coverImg?.src || "";
      return `<li class="row" data-category="${esc(p.category || "")}">
  <a href="${url(`work/${p.slug}/`)}" data-preview="${esc(preview)}" data-kind="${p.coverImg?.kind || ""}">
    <span class="c-num">${n}</span>
    <span class="c-title">${esc(p.title)}${p.featured ? '<span class="star" aria-label="Selected">●</span>' : ""}</span>
    <span class="c-disc">${esc(p.discipline || "")}</span>
    <span class="c-cat">${esc(p.category || "")}</span>
    <span class="c-year">${esc(p.year || "")}</span>
    <span class="c-thumb">${img(p.coverImg, { sizes: "40vw", alt: "" })}</span>
  </a>
</li>`;
    })
    .join("\n");

  const grid = projects
    .map(
      (p) => `<li class="tile" data-category="${esc(p.category || "")}">
  <a href="${url(`work/${p.slug}/`)}">
    <span class="tile-img">${img(p.coverImg, { sizes: "(min-width: 900px) 33vw, 50vw", alt: p.title })}</span>
    <span class="tile-meta"><span>${esc(p.title)}</span><span>${esc(p.year || "")}</span></span>
  </a>
</li>`
    )
    .join("\n");

  return `<section class="index" data-view="list">
  <div class="index-bar">
    <div class="filters" role="group" aria-label="Filter projects">
      <button type="button" data-filter="" aria-pressed="true">All <sup>${projects.length}</sup></button>
      ${cats
        .map((c) => `<button type="button" data-filter="${esc(c)}" aria-pressed="false">${esc(c)} <sup>${projects.filter((p) => p.category === c).length}</sup></button>`)
        .join("\n      ")}
    </div>
    <div class="views" role="group" aria-label="View">
      <button type="button" data-view-btn="list" aria-pressed="true">List</button>
      <button type="button" data-view-btn="grid" aria-pressed="false">Images</button>
    </div>
  </div>
  <div class="list-head" aria-hidden="true">
    <span class="c-num">No.</span><span class="c-title">Project</span><span class="c-disc">Discipline</span><span class="c-cat">Context</span><span class="c-year">Year</span>
  </div>
  <ol class="list">
${rows}
  </ol>
  <ol class="grid">
${grid}
  </ol>
  <div class="preview" aria-hidden="true"><img alt=""><video muted loop playsinline></video></div>
</section>`;
}

function projectPage(site, p, prev, next) {
  const meta = [
    ["Year", p.year],
    ["Context", p.category],
    ["Client", p.client],
    ["Discipline", p.discipline],
    ["Role", p.role],
  ].filter(([, v]) => v);
  const credits = lines(p.credits);
  const media = p.mediaItems
    .map((m) => {
      const lay = ["full", "half", "inset"].includes(m.layout) ? m.layout : "full";
      const sizes = lay === "half" ? "(min-width: 760px) 50vw, 100vw" : lay === "inset" ? "(min-width: 760px) 66vw, 100vw" : "100vw";
      return `<figure class="m m-${lay}">${img(m.img, { sizes, alt: m.caption || p.title })}${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ""}</figure>`;
    })
    .join("\n");

  return `<article class="project">
  <header class="project-head">
    <h1 class="project-title">${esc(p.title)}</h1>
    ${p.summary ? `<p class="project-summary">${esc(p.summary)}</p>` : ""}
    <dl class="project-meta">
      ${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("\n      ")}
      ${credits.length ? `<div><dt>Credits</dt><dd>${credits.map(esc).join("<br>")}</dd></div>` : ""}
    </dl>
    ${p.description ? `<div class="project-text">${md(p.description)}</div>` : ""}
  </header>
  <div class="project-media">
${media}
  </div>
  <nav class="project-nav">
    ${prev ? `<a href="${url(`work/${prev.slug}/`)}"><span>Previous</span>${esc(prev.title)}</a>` : "<span></span>"}
    <a href="${url("")}" class="to-index"><span>Back to</span>Index</a>
    ${next ? `<a href="${url(`work/${next.slug}/`)}" class="next"><span>Next</span>${esc(next.title)}</a>` : "<span></span>"}
  </nav>
</article>`;
}

function infoPage(site) {
  const list = (title, items) =>
    items && items.length
      ? `<section class="info-block"><h2>${title}</h2><ul>${items
          .map((it) =>
            typeof it === "string"
              ? `<li><span>${esc(it)}</span></li>`
              : `<li><span>${esc(it.label)}</span><span class="yr">${esc(it.year || "")}</span></li>`
          )
          .join("")}</ul></section>`
      : "";
  const links = [
    site.email && `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`,
    site.instagram && `<a href="${esc(site.instagram)}" rel="me">Instagram</a>`,
    site.linkedin && `<a href="${esc(site.linkedin)}" rel="me">LinkedIn</a>`,
    site.cv && `<a href="${url(String(site.cv).replace(/^\//, ""))}">CV (PDF)</a>`,
  ].filter(Boolean);
  return `<section class="info">
  <div class="info-bio">${md(site.bio)}</div>
  <div class="info-cols">
    ${site.status ? `<section class="info-block"><h2>Currently</h2><ul><li><span>${esc(site.status)}</span></li></ul></section>` : ""}
    ${list("Education", site.education)}
    ${list("Experience", site.experience)}
    ${list("Clients &amp; Collaborators", site.clients)}
    ${list("Exhibitions, Awards, Press", site.recognition)}
    ${links.length ? `<section class="info-block"><h2>Contact</h2><ul>${links.map((l) => `<li>${l}</li>`).join("")}</ul></section>` : ""}
  </div>
</section>`;
}

// ───────────────────────── build
const BUILD_ID = Date.now().toString(36);

async function main() {
  const t0 = Date.now();
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const site = await readJSON(path.join(CONTENT, "site.json"));
  const projects = await loadProjects();
  const siteOg = projects.find((p) => p.featured && p.coverImg?.og)?.coverImg.og || projects.find((p) => p.coverImg?.og)?.coverImg.og;

  await write("index.html", layout({ site, page: "index", body: indexPage(site, projects), ogImage: siteOg, canonical: "/" }));
  await write("info/index.html", layout({ site, page: "info", title: "Information", body: infoPage(site), ogImage: siteOg, canonical: "/info/" }));
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    await write(
      `work/${p.slug}/index.html`,
      layout({
        site,
        page: "project",
        title: p.title,
        description: p.summary,
        ogImage: p.coverImg?.og,
        body: projectPage(site, p, projects[i - 1], projects[i + 1]),
        canonical: `/work/${p.slug}/`,
      })
    );
  }
  await write("404.html", layout({ site, page: "404", title: "Not found", body: `<section class="notfound"><p>Nothing here.</p><p><a href="${url("")}">Back to index</a></p></section>` }));

  // static assets
  await fs.mkdir(path.join(DIST, "assets"), { recursive: true });
  for (const f of ["styles.css", "main.js"]) await fs.copyFile(path.join(ROOT, "src", f), path.join(DIST, "assets", f));
  const initial = esc((site.name || "J").trim()[0] || "J");
  await write(
    "favicon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${esc(site.accent || "#ff3b00")}"/><text x="32" y="46" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="500" text-anchor="middle" fill="#111">${initial}</text></svg>`
  );
  // files placed under content/static are copied as-is (CV PDF, etc.)
  const staticDir = path.join(CONTENT, "static");
  if (existsSync(staticDir)) await fs.cp(staticDir, DIST, { recursive: true });
  // CV or other files uploaded through the CMS media folder that aren't images
  for (const ref of [site.cv].filter(Boolean)) {
    const rel = String(ref).replace(/^\/?media\//, "");
    const src = path.join(MEDIA_IN, rel);
    if (existsSync(src)) {
      await fs.mkdir(path.dirname(path.join(DIST, "media", rel)), { recursive: true });
      await fs.copyFile(src, path.join(DIST, "media", rel));
    }
  }
  if (SITE_URL) {
    const urls = ["/", "/info/", ...projects.map((p) => `/work/${p.slug}/`)];
    await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${SITE_URL}${u}</loc></url>`).join("")}</urlset>\n`);
  }
  await write("robots.txt", `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
  await write(".nojekyll", "");

  console.log(`Built ${projects.length} projects in ${((Date.now() - t0) / 1000).toFixed(1)}s → dist/ (base ${BASE})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
