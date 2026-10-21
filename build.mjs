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
const sectionOf = (p) => (String(p.category || "").toLowerCase().startsWith("comm") ? "commissions" : "practice");
const labels = (site) => ({ practice: site.label_practice || "Practice", commissions: site.label_commissions || "Commissions" });

function layout({ site, title, description, ogImage, body, page, canonical, counts = {} }) {
  const fullTitle = title ? `${title} — ${site.name}` : `${site.name} — ${site.role}`;
  const desc = description || site.seo_description || site.role;
  const og = ogImage ? (SITE_URL ? SITE_URL + ogImage.replace(BASE, "/") : ogImage) : "";
  const L = labels(site);
  const home = page === "index" ? "" : url("");
  const theme = site.theme === "dark" ? "dark" : "light";
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
<meta name="theme-color" content="${theme === "dark" ? "#0a0a0a" : "#f4f3ef"}">
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
  <nav class="site-nav">
    <a href="${home}#practice" data-nav="practice">${esc(L.practice)}${counts.practice ? `<sup>${counts.practice}</sup>` : ""}</a>
    <a href="${home}#commissions" data-nav="commissions">${esc(L.commissions)}${counts.commissions ? `<sup>${counts.commissions}</sup>` : ""}</a>
    <a href="${home}#info" data-nav="info">Info</a>
  </nav>
</header>
<main>
${body}
</main>
<script src="${url("assets/main.js")}?v=${BUILD_ID}" defer></script>
</body>
</html>`;
}

// one work in the feed: a strip of images (clipped at the edge on desktop, swipeable on phones) + a label
function feedItem(p, n) {
  const seen = new Set();
  const pics = [p.coverImg, ...p.mediaItems.map((m) => m.img)].filter((m) => m && !seen.has(m.src) && seen.add(m.src)).slice(0, 4);
  const strip = pics
    .map((m, i) =>
      m.kind === "video"
        ? `<video src="${m.src}" autoplay muted loop playsinline preload="metadata"></video>`
        : img(m, { sizes: "(min-width: 760px) 50vw, 85vw", alt: i === 0 ? p.title : "", eager: n <= 2 && i === 0 })
    )
    .join("");
  return `<article class="work" id="${esc(p.slug)}">
  <a class="strip" href="${url(`work/${p.slug}/`)}" aria-label="${esc(p.title)}">${strip}</a>
  <a class="label" href="${url(`work/${p.slug}/`)}">
    <span class="l-num">${String(n).padStart(2, "0")}</span>
    <span class="l-title">${esc(p.title)}</span>
    <span class="l-format">${esc(p.format || p.discipline || "")}${p.client ? `<br>for ${esc(p.client)}` : ""}</span>
    <span class="l-year">${esc(p.year || "")}</span>
  </a>
</article>`;
}

function indexPage(site, projects) {
  const L = labels(site);
  const groups = { practice: [], commissions: [] };
  projects.forEach((p) => groups[sectionOf(p)].push(p));
  const section = (key) =>
    groups[key].length
      ? `<section class="feed" id="${key}" data-section="${key}">
  <h2 class="section-title"><span>${esc(L[key])}</span><sup>${groups[key].length}</sup></h2>
${groups[key].map((p, i) => feedItem(p, i + 1)).join("\n")}
</section>`
      : "";
  return `<section class="intro"><p>${esc(site.bio ? String(site.bio).split("\n")[0] : site.role)}</p></section>
${section("practice")}
${section("commissions")}
${infoSection(site)}`;
}

function projectPage(site, p, prev, next) {
  const L = labels(site);
  const meta = [
    ["Year", p.year],
    ["Section", L[sectionOf(p)]],
    ["Client", p.client],
    ["Format", p.format],
    ["Discipline", p.discipline],
    ["Role", p.role],
  ].filter(([, v]) => v);
  const credits = lines(p.credits);
  const media = p.mediaItems
    .map((m) => {
      const lay = ["full", "half", "inset"].includes(m.layout) ? m.layout : "full";
      const sizes = lay === "half" ? "(min-width: 760px) 50vw, 100vw" : lay === "inset" ? "(min-width: 760px) 60vw, 100vw" : "100vw";
      return `<figure class="m m-${lay}">${img(m.img, { sizes, alt: m.caption || p.title })}${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ""}</figure>`;
    })
    .join("\n");

  return `<article class="project">
  <header class="project-head">
    <h1 class="project-title">${esc(p.title)}</h1>
    <dl class="project-meta">
      ${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("\n      ")}
      ${credits.length ? `<div><dt>Credits</dt><dd>${credits.map(esc).join("<br>")}</dd></div>` : ""}
    </dl>
    <div class="project-text">
      ${p.summary ? `<p class="project-summary">${esc(p.summary)}</p>` : ""}
      ${md(p.description)}
    </div>
  </header>
  <div class="project-media">
${media}
  </div>
  <nav class="project-nav">
    ${prev ? `<a href="${url(`work/${prev.slug}/`)}"><span>Previous</span>${esc(prev.title)}</a>` : "<span></span>"}
    ${next ? `<a href="${url(`work/${next.slug}/`)}" class="next"><span>Next</span>${esc(next.title)}</a>` : "<span></span>"}
  </nav>
</article>`;
}

function infoSection(site) {
  const list = (title, items) =>
    items && items.length
      ? `<section class="info-block"><h3>${title}</h3><ul>${items
          .map((it) =>
            typeof it === "string"
              ? `<li><span>${esc(it)}</span></li>`
              : `<li><span>${it.url ? `<a href="${esc(it.url)}" rel="noopener" target="_blank">${esc(it.label)} ↗</a>` : esc(it.label)}</span><span class="yr">${esc(it.year || "")}</span></li>`
          )
          .join("")}</ul></section>`
      : "";
  const links = [
    site.email && `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`,
    site.instagram && `<a href="${esc(site.instagram)}" rel="me">Instagram ↗</a>`,
    site.linkedin && `<a href="${esc(site.linkedin)}" rel="me">LinkedIn ↗</a>`,
    site.cv && `<a href="${url(String(site.cv).replace(/^\//, ""))}">CV (PDF)</a>`,
  ].filter(Boolean);
  return `<section class="info" id="info" data-section="info">
  <h2 class="section-title"><span>Info</span></h2>
  ${(() => { const rest = String(site.bio || "").split(/\n\s*\n/).slice(1).join("\n\n"); return rest ? `<div class="info-bio">${md(rest)}</div>` : ""; })()}
  <div class="info-cols">
    ${site.status ? `<section class="info-block"><h3>Currently</h3><ul><li><span>${esc(site.status)}</span></li></ul></section>` : ""}
    ${list("Experience", site.experience)}
    ${list("Education", site.education)}
    ${list("Clients &amp; Collaborators", site.clients)}
    ${list("Exhibitions, Awards, Press", site.recognition)}
    ${links.length ? `<section class="info-block"><h3>Contact</h3><ul>${links.map((l) => `<li>${l}</li>`).join("")}</ul></section>` : ""}
  </div>
  <p class="colophon">© ${new Date().getFullYear()} ${esc(site.name)}</p>
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
  const siteOg = projects.find((p) => p.featured && p.coverImg?.og)?.coverImg.og || projects.find((p) => p.coverImg?.og)?.coverImg.og;

  await write("index.html", layout({ site, page: "index", body: indexPage(site, projects), ogImage: siteOg, canonical: "/", counts }));
  // old /info/ links keep working
  await write("info/index.html", `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${url("")}#info"><link rel="canonical" href="${url("")}#info"><title>Info</title>`);
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
    const urls = ["/", ...projects.map((p) => `/work/${p.slug}/`)];
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
