// Builds the blog from an Obsidian vault into docs/ (served by GitHub Pages).
//
// Only notes with `publish: true` in their properties are built, and only the
// files those notes embed are copied — nothing else from the vault leaves it.
//
//   node build.mjs [path/to/vault]

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import markPlugin from "markdown-it-mark";
import footnotePlugin from "markdown-it-footnote";
import hljs from "highlight.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
const expandHome = (p) => p.replace(/^~(?=$|\/)/, os.homedir());
const VAULT = path.resolve(expandHome(process.argv[2] || config.vault));
const OUT = path.join(ROOT, "docs");

const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);
const IMAGE_EXT = /\.(svg|png|jpe?g|gif|webp|avif|bmp)$/i;

// ---------- vault index (filenames only; nothing is read until referenced) ----------

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const vaultFiles = walk(VAULT);
// Obsidian resolves [[links]] by basename or by vault-relative path
const byName = new Map();
const byRelPath = new Map();
for (const f of vaultFiles) {
  const base = path.basename(f).toLowerCase();
  if (!byName.has(base)) byName.set(base, f);
  byRelPath.set(path.relative(VAULT, f).toLowerCase(), f);
}

function resolveVaultFile(target, fromFile) {
  target = decodeURIComponent(target).trim();
  const candidates = [target, target + ".md"];
  for (const c of candidates) {
    const rel = path.normalize(path.join(path.dirname(path.relative(VAULT, fromFile)), c)).toLowerCase();
    if (byRelPath.has(rel)) return byRelPath.get(rel);
    if (byRelPath.has(c.toLowerCase())) return byRelPath.get(c.toLowerCase());
    if (byName.has(path.basename(c).toLowerCase())) return byName.get(path.basename(c).toLowerCase());
  }
  return null;
}

// An embedded drawing (`X.excalidraw` / `X.excalidraw.md`) is shown via its exported SVG
function resolveEmbed(target, fromFile) {
  const t = target.replace(/\.md$/i, "");
  if (/\.excalidraw$/i.test(t)) {
    const svg = resolveVaultFile(t + ".svg", fromFile);
    if (svg) return svg;
  }
  return resolveVaultFile(target, fromFile);
}

// ---------- helpers ----------

const slugify = (s) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const isPublished = (v) => v === true || String(v).trim().toLowerCase() === "true";

function parseDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d;
}

const formatDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Split on a line pattern, ignoring matches inside fenced code blocks
function splitOutsideFences(src, lineRe) {
  const parts = [[]];
  let fence = null;
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : m[1];
    if (!fence && lineRe.test(line)) parts.push([]);
    else parts[parts.length - 1].push(line);
  }
  return parts.map((p) => p.join("\n"));
}

// ---------- markdown ----------

const strictLineBreaks = (() => {
  try {
    return !!JSON.parse(fs.readFileSync(path.join(VAULT, ".obsidian/app.json"), "utf8")).strictLineBreaks;
  } catch { return false; }
})();

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: !strictLineBreaks, // Obsidian's default
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre><code class="hljs language-${lang}">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
    }
    return "";
  },
})
  .use(markPlugin)
  .use(footnotePlugin);

// Obsidian callouts: > [!note] Title
function convertCallouts(src) {
  return src.replace(/^>\s*\[!(\w+)\]([+-]?)[ \t]*(.*)\n((?:>.*(?:\n|$))*)/gm, (_, type, _fold, title, body) => {
    const inner = body.replace(/^>\s?/gm, "");
    const t = title.trim() || type[0].toUpperCase() + type.slice(1);
    return `<div class="callout" data-callout="${type.toLowerCase()}">\n<div class="callout-title">${escapeHtml(t)}</div>\n<div class="callout-content">\n\n${inner}\n</div>\n</div>\n\n`;
  });
}

// Turns Obsidian-flavoured markdown into plain markdown/HTML for one post
function preprocess(src, post, ctx) {
  // %% comments %% (also hides the "Edit in Excalidraw" links)
  src = src.replace(/%%[\s\S]*?%%/g, "");

  // ![[embed|options]]
  src = src.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (whole, target, opts = "") => {
    const file = resolveEmbed(target, post.file);
    if (!file) { ctx.warn(`missing embed: ${target}`); return ""; }
    if (!IMAGE_EXT.test(file)) { ctx.warn(`skipping non-image embed: ${target}`); return ""; }
    const url = ctx.asset(file);
    const words = opts.split(/\s+/).filter(Boolean);
    const size = words.find((w) => /^\d+(x\d+)?$/.test(w));
    const alt = words.filter((w) => w !== size).join(" ");
    const width = size ? ` width="${size.split("x")[0]}"` : "";
    return `<span class="internal-embed image-embed" alt="${escapeHtml(alt)}"><img src="${url}" alt="${escapeHtml(alt)}"${width} loading="lazy"></span>`;
  });

  // ![alt](relative/path.png)
  src = src.replace(/!\[([^\]]*)\]\((?!https?:|data:)([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, alt, target) => {
    const file = resolveVaultFile(target, post.file);
    if (!file) { ctx.warn(`missing image: ${target}`); return whole; }
    return `![${alt}](${ctx.asset(file)})`;
  });

  // [[Note#heading|alias]] -> link if that note is published, plain text otherwise
  src = src.replace(/\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target, heading = "", alias) => {
    const label = alias || target + heading.replace(/^#/, " › ") || heading.slice(1);
    const linked = target ? ctx.findPost(target) : post;
    if (!linked) return escapeHtml(label);
    const hash = heading ? "#" + slugify(heading.slice(1)) : "";
    return `[${label}](${linked === post ? "" : "../" + linked.slug + "/"}${hash})`;
  });

  return convertCallouts(src);
}

// Advanced Slides speaker notes ("note:" to the end of the slide)
const splitNotes = (slide) => {
  const m = slide.match(/^note:/m);
  return m ? [slide.slice(0, m.index), slide.slice(m.index).replace(/^note:\s*/, "")] : [slide, ""];
};

// Give headings ids so [[Note#heading]] links work
md.core.ruler.push("heading_ids", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === "heading_open") {
      const text = tokens[i + 1].children.map((t) => t.content).join("");
      tokens[i].attrSet("id", slugify(text));
    }
  }
});

// ---------- templates ----------

const head = ({ title, description, css, extra = "" }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n<meta property="og:description" content="${escapeHtml(description)}">` : ""}
<meta property="og:title" content="${escapeHtml(title)}">
${css.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
${extra}
</head>`;

const siteHeader = (prefix) => `<header class="site-header"><a href="${prefix}">${escapeHtml(config.title)}</a></header>`;
const profileLink = (prefix) => `<a class="profile-link" href="${prefix}profile/">profile</a>`;

function postPage(post) {
  return `${head({
    title: `${post.title} · ${config.title}`,
    description: post.description,
    css: ["../assets/base.css", "../assets/hljs.css", "../assets/user.css", "../assets/site.css"],
  })}
<body>
<div class="markdown-preview-view markdown-rendered">
${profileLink("../")}
<div class="markdown-preview-sizer">
${siteHeader("../")}
<p class="post-meta">${formatDate(post.date)} · <a href="slides.html">view as slides</a></p>
<article>
${post.html}
</article>
<footer class="site-footer"><a href="../">← all posts</a></footer>
</div>
</div>
</body>
</html>
`;
}

function slidesPage(post) {
  const REVEAL = "https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.1.0";
  const theme = /^[a-z]+$/.test(post.data.theme || "") ? post.data.theme : "white";
  const opts = {
    hash: true,
    center: post.data.center !== undefined ? isPublished(post.data.center) : true,
    transition: post.data.transition || "slide",
    width: post.data.width || 960,
    height: post.data.height || 700,
  };
  return `${head({
    title: `${post.title} · slides`,
    description: post.description,
    css: [`${REVEAL}/reveal.min.css`, `${REVEAL}/theme/${theme}.min.css`, "../assets/hljs.css", "../assets/user.css", "../assets/slides.css"],
  })}
<body>
<div class="reveal"><div class="slides">
${post.slides}
</div></div>
<a class="slides-back" href="./">← article</a>
<script src="${REVEAL}/reveal.min.js"></script>
<script src="${REVEAL}/plugin/notes/notes.min.js"></script>
<script>Reveal.initialize(Object.assign(${JSON.stringify(opts)}, { plugins: [RevealNotes] }));</script>
</body>
</html>
`;
}

function indexPage(posts) {
  const items = posts.map((p) => `<li class="post-item">
<a class="post-link" href="${p.slug}/">${escapeHtml(p.title)}</a>
<div class="post-meta">${formatDate(p.date)}</div>
${p.description ? `<p class="post-desc">${escapeHtml(p.description)}</p>` : ""}
</li>`).join("\n");
  return `${head({
    title: config.title,
    description: config.description,
    css: ["assets/base.css", "assets/user.css", "assets/site.css"],
  })}
<body>
<div class="markdown-preview-view markdown-rendered">
${profileLink("")}
<div class="markdown-preview-sizer">
<h1>${escapeHtml(config.title)}</h1>
${config.description ? `<p class="tagline">${escapeHtml(config.description)}</p>` : ""}
<hr>
<ul class="post-list">
${items || "<li>No posts yet.</li>"}
</ul>
</div>
</div>
</body>
</html>
`;
}

const SOCIALS = {
  github: ["GitHub", (h) => `https://github.com/${h}`],
  twitter: ["Twitter", (h) => `https://x.com/${h}`],
  linkedin: ["LinkedIn", (h) => `https://www.linkedin.com/in/${h}`],
};

// profile.md: bio as markdown, optional contact/social handles as properties.
// Leave a property empty and it is simply not shown.
function profilePage(file) {
  const { data, content } = matter(fs.readFileSync(file, "utf8"));
  const links = [];
  const resume = data.resume && String(data.resume).trim();
  if (resume) links.push(`<a href="${escapeHtml(resume)}" rel="noopener">Resume</a>`);
  for (const [key, [label, toUrl]] of Object.entries(SOCIALS)) {
    const v = data[key] && String(data[key]).trim();
    if (!v) continue;
    const url = /^https?:/.test(v) ? v : /^[\w-]+(\.[\w-]+)+\//.test(v) ? "https://" + v : toUrl(v.replace(/^@/, "").replace(/^\/+|\/+$/g, ""));
    links.push(`<a href="${escapeHtml(url)}" rel="me noopener">${label}</a>`);
  }
  const email = data.email && String(data.email).trim();
  const contact = email ? `<p>Contact: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>` : "";
  const hasBanner = fs.existsSync(path.join(ROOT, "theme/header.jpg"));
  return `${head({
    title: `Profile · ${config.title}`,
    description: firstParagraph(md.render(content)),
    css: ["../assets/base.css", "../assets/user.css", "../assets/site.css"],
  })}
<body>
<div class="markdown-preview-view markdown-rendered">
${profileLink("../")}
<div class="markdown-preview-sizer">
${siteHeader("../")}
${hasBanner ? `<img class="profile-banner" src="../assets/header.jpg" alt="${escapeHtml(config.title)} giving a talk">` : ""}
<h1>${escapeHtml(data.heading || "About")}</h1>
${md.render(content)}
${contact}
${links.length ? `<p>${links.join(" · ")}</p>` : ""}
<footer class="site-footer"><a href="../">← all posts</a></footer>
</div>
</div>
</body>
</html>
`;
}

// ---------- build ----------

function firstHeading(src) {
  const m = src.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].replace(/[*_`=]/g, "").trim() : null;
}

function firstParagraph(html) {
  for (const m of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text.length > 40) return text.length > 200 ? text.slice(0, 197).trimEnd() + "…" : text;
  }
  return "";
}

function build() {
  const posts = [];
  for (const file of vaultFiles) {
    if (!file.endsWith(".md") || file.endsWith(".excalidraw.md")) continue;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.startsWith("---")) continue;
    let parsed;
    try { parsed = matter(raw); } catch (e) { console.warn(`! bad properties in ${file}: ${e.message}`); continue; }
    if (!isPublished(parsed.data.publish)) continue;
    const name = path.basename(file, ".md");
    const stat = fs.statSync(file);
    posts.push({
      file,
      name,
      data: parsed.data,
      body: parsed.content,
      slug: slugify(parsed.data.slug || name),
      title: parsed.data.title || firstHeading(parsed.content) || name,
      date: parseDate(parsed.data.date) || stat.birthtime,
    });
  }
  posts.sort((a, b) => b.date - a.date);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });

  const findPost = (target) => {
    const t = path.basename(target.trim().replace(/\.md$/i, "")).toLowerCase();
    return posts.find((p) => p.name.toLowerCase() === t);
  };

  for (const post of posts) {
    const dir = path.join(OUT, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    const copied = new Map();
    const ctx = {
      findPost,
      warn: (msg) => console.warn(`! ${post.name}: ${msg}`),
      asset(file) {
        if (!copied.has(file)) {
          const ext = path.extname(file);
          let name = slugify(path.basename(file, ext)) + ext.toLowerCase();
          while ([...copied.values()].includes(name)) name = "x-" + name;
          fs.copyFileSync(file, path.join(dir, name));
          copied.set(file, name);
        }
        return copied.get(file);
      },
    };

    const src = preprocess(post.body, post, ctx);

    // Article: Advanced Slides notes are dropped, slide separators stay as <hr>
    const articleSrc = splitOutsideFences(src, /^---\s*$/).map((s) => splitNotes(s)[0]).join("\n\n---\n\n");
    post.html = md.render(articleSrc);
    post.description = post.data.description || firstParagraph(post.html);

    // Slides: --- separates horizontal slides, -- separates vertical ones
    post.slides = splitOutsideFences(src, /^---\s*$/).map((h) => {
      const verticals = splitOutsideFences(h, /^--\s*$/).map((v) => {
        const [content, notes] = splitNotes(v);
        return `<section><div absolute="true">${md.render(content)}</div>${notes.trim() ? `<aside class="notes">${md.render(notes)}</aside>` : ""}</section>`;
      });
      return verticals.length > 1 ? `<section>${verticals.join("\n")}</section>` : verticals[0];
    }).join("\n");

    fs.writeFileSync(path.join(dir, "index.html"), postPage(post));
    fs.writeFileSync(path.join(dir, "slides.html"), slidesPage(post));
    console.log(`✓ ${post.title}  →  /${post.slug}/  (${copied.size} files)`);
  }

  // Styles: every Obsidian CSS snippet plus any `css:` file a published note uses,
  // de-duplicated by content, so the site always matches the vault.
  const cssFiles = new Set();
  const snippetDir = path.join(VAULT, ".obsidian/snippets");
  if (fs.existsSync(snippetDir)) {
    for (const f of fs.readdirSync(snippetDir).sort()) if (f.endsWith(".css")) cssFiles.add(path.join(snippetDir, f));
  }
  for (const p of posts) {
    for (const c of [].concat(p.data.css || [])) {
      const f = resolveVaultFile(String(c), p.file);
      if (f) cssFiles.add(f); else console.warn(`! ${p.name}: missing css ${c}`);
    }
  }
  const seen = new Set();
  const userCss = [...cssFiles].map((f) => fs.readFileSync(f, "utf8")).filter((c) => !seen.has(c.trim()) && seen.add(c.trim()));
  // @import must come first in a stylesheet
  const imports = [];
  const rest = userCss.map((c) => c.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, (m) => (imports.push(m), ""))).join("\n\n");
  fs.writeFileSync(path.join(OUT, "assets/user.css"), [...new Set(imports)].join("\n") + "\n" + rest);

  for (const f of ["base.css", "site.css", "slides.css"]) fs.copyFileSync(path.join(ROOT, "theme", f), path.join(OUT, "assets", f));
  fs.copyFileSync(path.join(ROOT, "node_modules/highlight.js/styles/github.min.css"), path.join(OUT, "assets/hljs.css"));

  const header = path.join(ROOT, "theme/header.jpg");
  if (fs.existsSync(header)) fs.copyFileSync(header, path.join(OUT, "assets/header.jpg"));
  const profileFile = path.join(ROOT, "profile.md");
  if (fs.existsSync(profileFile)) {
    fs.mkdirSync(path.join(OUT, "profile"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "profile/index.html"), profilePage(profileFile));
  }

  fs.writeFileSync(path.join(OUT, "index.html"), indexPage(posts));
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
  console.log(`\nBuilt ${posts.length} post(s) into ${path.relative(process.cwd(), OUT) || OUT}`);
}

build();
