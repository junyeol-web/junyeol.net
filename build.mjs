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

let COUNTS = {};
// ───────────────────────── templates
const sectionOf = (p) => (String(p.category || "").toLowerCase().startsWith("comm") ? "commissions" : "practice");
const labels = (site) => ({ practice: site.label_practice || "Work P", commissions: site.label_commissions || "Work C" });
const ratio = (m) => (m && m.width && m.height ? (m.width / m.height).toFixed(4) : "");
const chip = (text, cls = "") => (text ? `<span class="chip${cls ? " " + cls : ""}">${esc(text)}</span>` : "");

function mediaTag(m, { sizes, alt = "", eager = false } = {}) {
  if (!m) return "";
  // videos only load and play while on screen (main.js) — this is what keeps the grid light
  if (m.kind === "video") return `<video data-src="${m.src}" muted loop playsinline preload="none"></video>`;
  return img(m, { sizes, alt, eager });
}

function layout({ site, title, description, ogImage, body, page, canonical, counts = COUNTS }) {
  const fullTitle = title ? `${title} — ${site.name}` : `${site.name} — ${site.role}`;
  const desc = description || site.seo_description || site.role;
  const og = ogImage ? (SITE_URL ? SITE_URL + ogImage.replace(BASE, "/") : ogImage) : "";
  const L = labels(site);
  const home = page === "index" ? "" : url("");
  const theme = site.theme === "light" ? "light" : "dark";
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
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
<meta name="theme-color" content="${theme === "dark" ? "#000000" : "#ffffff"}">
<link rel="icon" href="${url("favicon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${url("assets/styles.css")}?v=${BUILD_ID}">
<script>document.documentElement.classList.add("js")</script>
</head>
<body data-page="${page}">
<nav class="menu" aria-label="Main">
  <a href="${url("")}" class="menu-name">${esc(site.name)}</a>
  <a href="${home}#practice" data-nav="practice">${esc(L.practice)}${counts.practice ? ` <span class="n">${counts.practice}</span>` : ""}</a>
  <a href="${home}#commissions" data-nav="commissions">${esc(L.commissions)}${counts.commissions ? ` <span class="n">${counts.commissions}</span>` : ""}</a>
  <a href="${url("info/")}"${page === "info" ? ' aria-current="page"' : ""}>Info</a>
</nav>
<main>
${body}
</main>
<script src="${url("assets/main.js")}?v=${BUILD_ID}" defer></script>
</body>
</html>`;
}

// one tile in the grid: cover cropped to 16:9, two chips on top
function tile(p, n) {
  const sub = p.client || p.discipline || "";
  return `<a class="tile" href="${url(`work/${p.slug}/`)}" id="${esc(p.slug)}">
  <span class="tile-media">${mediaTag(p.coverImg, { sizes: "(min-width: 760px) 50vw, 100vw", alt: p.title, eager: n <= 4 })}</span>
  <span class="chips">${chip(p.title)}${chip(sub)}</span>
</a>`;
}

function indexPage(site, projects) {
  const L = labels(site);
  const groups = { practice: [], commissions: [] };
  projects.forEach((p) => groups[sectionOf(p)].push(p));
  let n = 0;
  const section = (key) =>
    groups[key].length
      ? `<section class="grid-section" id="${key}" data-section="${key}" aria-label="${esc(L[key])}">
  <div class="grid">
${groups[key].map((p) => tile(p, ++n)).join("\n")}
  </div>
</section>`
      : "";
  return `${section("practice")}
${section("commissions")}`;
}

function projectPage(site, p, prev, next) {
  const L = labels(site);
  const meta = [
    ["Section", L[sectionOf(p)]],
    ["Year", p.year],
    ["Client", p.client],
    ["Format", p.format],
    ["Discipline", p.discipline],
    ["Role", p.role],
  ].filter(([, v]) => v);
  const credits = lines(p.credits);
  const media = p.mediaItems
    .map((m) => {
      const lay = ["full", "half", "inset"].includes(m.layout) ? m.layout : "full";
      const sizes = lay === "full" ? "100vw" : "(min-width: 760px) 50vw, 100vw";
      return `<figure class="m m-${lay}"${ratio(m.img) ? ` style="--r:${ratio(m.img)}"` : ""}><span class="mw">${mediaTag(m.img, { sizes, alt: m.caption || p.title })}${m.caption ? `<figcaption>${chip(m.caption)}</figcaption>` : ""}</span></figure>`;
    })
    .join("\n");

  return `<article class="project">
  <header class="project-head">
    <div class="panel">
      <h1 class="row">${esc(p.title)}</h1>
      ${meta.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join("\n      ")}
      ${credits.length ? `<div class="row"><span class="k">Credits</span><span>${credits.map(esc).join("<br>")}</span></div>` : ""}
    </div>
    ${p.summary || p.description ? `<div class="panel text">${p.summary ? `<p>${esc(p.summary)}</p>` : ""}${md(p.description)}</div>` : ""}
  </header>
  <div class="project-media">
${media}
  </div>
  <nav class="project-nav">
    ${prev ? `<a class="chip" href="${url(`work/${prev.slug}/`)}">← ${esc(prev.title)}</a>` : "<span></span>"}
    <a class="chip" href="${url("")}#${esc(p.slug)}">All work</a>
    ${next ? `<a class="chip" href="${url(`work/${next.slug}/`)}">${esc(next.title)} →</a>` : "<span></span>"}
  </nav>
</article>`;
}

function infoPage(site) {
  const list = (title, items) =>
    items && items.length
      ? `<section class="panel"><h2 class="row k">${title}</h2>${items
          .map((it) =>
            typeof it === "string"
              ? `<div class="row">${esc(it)}</div>`
              : `<div class="row"><span>${it.url ? `<a href="${esc(it.url)}" rel="noopener" target="_blank">${esc(it.label)} ↗</a>` : esc(it.label)}</span>${it.year ? `<span class="k">${esc(it.year)}</span>` : ""}</div>`
          )
          .join("")}</section>`
      : "";
  const links = [
    site.email && `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`,
    site.instagram && `<a href="${esc(site.instagram)}" rel="me">Instagram ↗</a>`,
    site.linkedin && `<a href="${esc(site.linkedin)}" rel="me">LinkedIn ↗</a>`,
    site.cv && `<a href="${url(String(site.cv).replace(/^\//, ""))}">CV ↗</a>`,
  ].filter(Boolean);
  return `<section class="info">
  <div class="panel bio">${md(site.bio)}</div>
  ${list("Experience", site.experience)}
  ${list("Education", site.education)}
  ${list("Clients", site.clients)}
  ${list("Exhibitions, awards, press", site.recognition)}
  ${links.length ? `<section class="panel"><h2 class="row k">Contact</h2>${links.map((l) => `<div class="row">${l}</div>`).join("")}</section>` : ""}
</section>`;
}

// ───────────────────────── build
const BUILD_ID = Date.now().toString(36);

async function main() {
  const t0 = Date.now();
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const site = await readJSON(path.join(CONTENT, "site.json"));
  const all = await loadProjects();
  // feed order: practice first, then commissions; prev/next follows the same order
  const projects = [...all.filter((p) => sectionOf(p) === "practice"), ...all.filter((p) => sectionOf(p) === "commissions")];
  const counts = { practice: projects.filter((p) => sectionOf(p) === "practice").length, commissions: projects.filter((p) => sectionOf(p) === "commissions").length };
  COUNTS = counts;
  const siteOg = projects.find((p) => p.featured && p.coverImg?.og)?.coverImg.og || projects.find((p) => p.coverImg?.og)?.coverImg.og;

  await write("index.html", layout({ site, page: "index", body: indexPage(site, projects), ogImage: siteOg, canonical: "/", counts }));
  await write("info/index.html", layout({ site, page: "info", title: "Info", body: infoPage(site), ogImage: siteOg, canonical: "/info/" }));
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
        counts,
      })
    );
  }
  await write("404.html", layout({ site, page: "404", title: "Not found", counts, body: `<section class="notfound"><p>Nothing here.</p><p><a href="${url("")}">Back to work</a></p></section>` }));

  // static assets
  await fs.mkdir(path.join(DIST, "assets"), { recursive: true });
  for (const f of ["styles.css", "main.js"]) await fs.copyFile(path.join(ROOT, "src", f), path.join(DIST, "assets", f));
  const initial = esc((site.name || "J").trim()[0] || "J");
  await write(
    "favicon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#8a8a8a"/><text x="32" y="43" font-family="Arial, sans-serif" font-size="26" text-anchor="middle" fill="#fff">JB</text></svg>`
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
