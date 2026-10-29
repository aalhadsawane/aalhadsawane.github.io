// "Share this passage": select text in a post -> Share -> the image of the slide it is in, and a
// ready-made draft on X / LinkedIn that links to that slide (so the slide shows as the link card).
// Everything runs in the reader's browser, so it works on static hosting.
//
// X and LinkedIn draft links cannot carry an image, so:
//   phones   -> the native share sheet takes the image, quote and link together
//   desktop  -> the image is copied to the clipboard and the draft opens with quote + link;
//               the reader pastes the image into it
(() => {
  const article = document.querySelector("article");
  if (!article) return;

  const SITE = (document.querySelector(".site-name") || {}).textContent || "Aalhad Sawane";
  const TITLE = document.title.split(" · ")[0];
  const PAGE = location.origin + location.pathname;
  const PAGEDIR = location.origin + location.pathname.replace(/[^/]*$/, "");
  const HAS_SLIDE_PAGES = !!article.dataset.slides; // /<post>/s/<N>/ and s/<N>.jpg exist
  const SERIF = '"Playfair Display", Georgia, serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
  const coarse = matchMedia("(pointer: coarse)");

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------- selection bar ----------
  const bar = h("button", "share-bar", "Share");
  bar.type = "button";
  bar.setAttribute("aria-label", "Share this passage");
  document.body.append(bar);

  let state = null, timer = 0, dialogOpen = false, holdUntil = 0;

  const hide = () => bar.classList.remove("on");

  function place(range) {
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return hide();
    const first = rects[0], last = rects[rects.length - 1];
    bar.classList.add("on");
    const w = bar.offsetWidth, bh = bar.offsetHeight;
    // under the end of the selection (phones show their own menu above it); above if no room
    let top = last.bottom + 10;
    if (top + bh > innerHeight - 8 && first.top - bh - 10 > 8) top = first.top - bh - 10;
    const left = Math.max(8, Math.min(last.right - w / 2, innerWidth - w - 8));
    bar.style.top = top + scrollY + "px";
    bar.style.left = left + scrollX + "px";
  }

  // Which slide is the selection in? A slide is everything between two slide breaks (the --- lines
  // of the note). The first slide starts at the top of the article and the last one has no break
  // after it, so the end of the article closes it.
  function slideOf(range) {
    const breaks = [...article.querySelectorAll("hr.slide-break")];
    let n = 1;
    for (const b of breaks) {
      if (b.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) n++;
      else break;
    }
    const r = document.createRange();
    if (n > 1) r.setStartAfter(breaks[n - 2]); else r.setStart(article, 0);
    if (n <= breaks.length) r.setEndBefore(breaks[n - 1]); else r.setEnd(article, article.childNodes.length);
    return { n, frag: r.cloneContents() };
  }

  function update() {
    if (dialogOpen || Date.now() < holdUntil) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
    const range = sel.getRangeAt(0);
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return hide();
    const text = sel.toString().replace(/\s+/g, " ").trim();
    const frag = range.cloneContents();
    if (text.length < 12 && !frag.querySelector("img")) return hide();
    const slide = slideOf(range);
    state = { text, n: slide.n, slideFrag: slide.frag };
    place(range);
  }

  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  });
  bar.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  bar.addEventListener("pointerdown", () => { holdUntil = Date.now() + 800; });
  bar.addEventListener("click", openDialog);

  // ---------- dialog ----------
  function openDialog() {
    if (!state || dialogOpen) return;
    dialogOpen = true;
    hide();
    const snap = state;
    const opener = document.activeElement;

    const back = h("div", "share-backdrop");
    const box = h("div", "share-dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Share this passage");
    const close = h("button", "share-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    const title = h("p", "share-title", "Share this passage");
    const preview = h("div", "share-preview", "Making the image…");
    const row = h("div", "share-actions");
    const hint = h("p", "share-hint");
    box.append(close, title, preview, row, hint);
    back.append(box);
    document.body.append(back);

    const excerpt = (n) => {
      const t = snap.text;
      return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "") + "…";
    };
    // the link goes to this slide's share page, so X and LinkedIn show the slide as the link card
    const link = HAS_SLIDE_PAGES ? `${PAGEDIR}s/${snap.n}/` : PAGE;
    const xText = `“${excerpt(150)}”\n\n— ${SITE}`;
    const inText = `“${excerpt(700)}”\n\n— ${SITE}, ${TITLE}\n${link}`;
    const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(xText)}&url=${encodeURIComponent(link)}`;
    const inUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(inText)}`;

    let blob = null, objUrl = "";
    const buttons = [];
    const add = (label, primary, fn, needsImage) => {
      const b = h("button", primary ? "share-btn primary" : "share-btn", label);
      b.type = "button";
      b.disabled = !!needsImage && !blob; // posting works at once; image buttons wait for the card
      b.addEventListener("click", fn);
      row.append(b);
      buttons.push(b);
      return b;
    };
    const say = (t) => { hint.textContent = t; };

    const copyImage = async () => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return true;
      } catch { return false; }
    };
    const post = (url) => () => { window.open(url, "_blank", "noopener"); };
    const save = () => {
      const a = h("a");
      a.href = objUrl;
      a.download = (location.pathname.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "post") + "-quote.png";
      document.body.append(a);
      a.click();
      a.remove();
    };

    const shareFile = () => (blob ? new File([blob], "quote.png", { type: "image/png" }) : null);
    const phoneShare = () => {
      const f = shareFile();
      return coarse.matches && f && navigator.canShare && navigator.canShare({ files: [f] });
    };

    const setup = () => {
      row.textContent = "";
      buttons.length = 0;
      if (phoneShare()) {
        add("Share…", true, () => {
          navigator.share({ files: [shareFile()], text: `“${excerpt(200)}” — ${SITE}`, url: link }).catch(() => {});
        }, true);
        add("Save image", false, save, true);
        say("Pick X or LinkedIn in the share sheet. The image, quote and link go together.");
      } else {
        add("Post on X", true, post(xUrl));
        add("Post on LinkedIn", true, post(inUrl));
        add("Copy image", false, async () => say((await copyImage()) ? "Image copied." : "Couldn't copy the image. Use “Save image”."), true);
        add("Save image", false, save, true);
        say("The draft links to this slide, so X and LinkedIn show it as an image card. To put the image in the post itself, copy it and paste it into the draft.");
      }
      (buttons[0] || close).focus();
    };

    const onKey = (e) => { if (e.key === "Escape") shut(); };
    function shut() {
      document.removeEventListener("keydown", onKey);
      back.remove();
      if (objUrl) URL.revokeObjectURL(objUrl);
      dialogOpen = false;
      if (opener && opener.focus) opener.focus();
    }
    close.addEventListener("click", shut);
    back.addEventListener("mousedown", (e) => { if (e.target === back) shut(); });
    document.addEventListener("keydown", onKey);
    setup();

    slideImage(snap).then((b) => {
      if (!dialogOpen) return;
      blob = b;
      objUrl = URL.createObjectURL(b);
      const img = h("img");
      img.src = objUrl;
      img.alt = "Preview of the image you are sharing";
      preview.textContent = "";
      preview.append(img);
      setup();
    }).catch(() => {
      preview.textContent = "Couldn't make the image. You can still post the quote.";
      setup();
    });
  }

  // The image is the slide itself, rendered at build time (the same picture the link card shows).
  // If it is not there (older build, or Chrome was missing when publishing) the slide is drawn here.
  async function slideImage(snap) {
    if (HAS_SLIDE_PAGES) {
      try {
        const res = await fetch(`${PAGEDIR}s/${snap.n}.jpg`);
        if (res.ok) {
          const bmp = await createImageBitmap(await res.blob());
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext("2d").drawImage(bmp, 0, 0);
          return await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
        }
      } catch { /* fall through to drawing it */ }
    }
    return renderCard(snap.slideFrag);
  }

  // ---------- the card ----------
  // The selection is turned into a few blocks (paragraphs, headings, list items, code, images)
  // and laid out on a 48px dot grid, like the site, with the credit underneath.
  function extract(root) {
    const out = [];
    let buf = "", kind = "p", quote = 0;
    const flush = () => {
      const raw = kind === "pre" ? buf.replace(/\t/g, "  ").replace(/^\n+|\n+$/g, "") : buf.replace(/\s+/g, " ").trim();
      if (raw) out.push({ t: kind, text: raw, quote: quote > 0 });
      buf = "";
    };
    const LEAF = /^(p|li|h[1-6]|pre|tr|dt|dd|figcaption)$/;
    const BOX = /^(blockquote|div|ul|ol|table|thead|tbody|section)$/;
    (function walk(n) {
      if (n.nodeType === 3) { buf += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      if (tag === "img") { flush(); out.push({ t: "img", src: n.src }); return; }
      if (/^(script|style|button|form|svg|hr|nav|input|label)$/.test(tag) || n.matches(".slides-cta-row, .subscribe-form")) { flush(); return; }
      if (tag === "br") { buf += kind === "pre" ? "\n" : " "; return; }
      if (tag === "td" || tag === "th") { n.childNodes.forEach(walk); buf += "   "; return; }
      const prev = kind;
      if (LEAF.test(tag)) {
        flush();
        kind = /^h[1-6]$/.test(tag) ? tag : tag === "li" ? "li" : tag === "pre" ? "pre" : "p";
        n.childNodes.forEach(walk);
        flush();
        kind = prev;
      } else if (BOX.test(tag)) {
        flush();
        kind = "p";
        if (tag === "blockquote") quote++;
        n.childNodes.forEach(walk);
        flush();
        if (tag === "blockquote") quote--;
        kind = prev;
      } else {
        n.childNodes.forEach(walk); // inline: strong, em, a, code, mark, span
      }
    })(root);
    flush();
    return out;
  }

  function wrap(ctx, text, maxW, byChar) {
    const out = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const tok of byChar ? [...para] : para.split(" ")) {
        const test = line ? (byChar ? line + tok : line + " " + tok) : tok;
        if (ctx.measureText(test).width <= maxW) { line = test; continue; }
        if (line) out.push(line);
        line = tok;
        while (!byChar && ctx.measureText(line).width > maxW) { // one word wider than the card
          let i = line.length;
          while (i > 1 && ctx.measureText(line.slice(0, i)).width > maxW) i--;
          out.push(line.slice(0, i));
          line = line.slice(i);
        }
      }
      out.push(line);
    }
    return out;
  }

  async function renderCard(frag) {
    await Promise.all(["400", "700", "italic 400"].map((w) => document.fonts.load(`${w} 34px "Playfair Display"`)));
    const W = 1200, G = 48, X0 = 96, CW = W - 2 * X0, MAXY = G * 40, INK = "#1f1f1f";
    const root = h("div");
    root.append(frag.cloneNode(true));
    const blocks = extract(root);

    await Promise.all(blocks.filter((b) => b.t === "img").map((b) => new Promise((res) => {
      const i = new Image();
      i.onload = () => { b.img = i; res(); };
      i.onerror = () => res();
      i.src = b.src;
    })));

    const sty = (b) => {
      const q = b.quote ? 36 : 0;
      if (/^h[1-6]$/.test(b.t)) {
        const s = { h1: 46, h2: 46, h3: 40, h4: 36, h5: 34, h6: 34 }[b.t];
        return { font: `700 ${s}px ${SERIF}`, size: s, line: G, indent: q, pad: 0 };
      }
      if (b.t === "pre") return { font: `400 26px ${MONO}`, size: 26, line: 40, indent: q, pad: 20, box: true };
      if (b.t === "li") return { font: `400 34px ${SERIF}`, size: 34, line: G, indent: q + 44, pad: 0, bullet: true };
      return { font: `400 34px ${SERIF}`, size: 34, line: G, indent: q, pad: 0 };
    };

    const m = document.createElement("canvas").getContext("2d");
    const items = [];
    let y = G * 2;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.t === "img") {
        if (!b.img) continue;
        const nw = b.img.naturalWidth || 800, nh = b.img.naturalHeight || 500;
        const dw = Math.min(nw, CW), dh = (nh * dw) / nw;
        if (items.length && y + dh > MAXY + G * 10) break;
        items.push({ k: "img", img: b.img, x: X0 + (CW - dw) / 2, y, w: dw, h: dh });
        y = Math.ceil((y + dh) / G) * G + G;
        continue;
      }
      const st = sty(b);
      m.font = st.font;
      let lines = wrap(m, b.text, CW - st.indent - st.pad * 2, b.t === "pre");
      const rows = Math.floor((MAXY - y - st.pad * 2) / st.line);
      if (rows < 1) break;
      let cut = false;
      if (lines.length > rows) {
        lines = lines.slice(0, rows);
        lines[rows - 1] = lines[rows - 1].replace(/\s*\S{0,3}$/, "") + "…";
        cut = true;
      }
      const hgt = lines.length * st.line + st.pad * 2;
      items.push({ k: "text", st, lines, x: X0 + st.indent, y, h: hgt, quote: b.quote, w: CW - st.indent });
      const next = blocks[i + 1];
      const gap = b.t === "li" && next && next.t === "li" ? 0 : G;
      y = Math.ceil((y + hgt) / G) * G + gap;
      if (cut) break;
    }

    const fy = y;
    const H = fy + G * 5;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");

    ctx.fillStyle = "#fbfbf9";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    for (let gx = 0; gx <= W; gx += G) for (let gy = 0; gy <= H; gy += G) {
      ctx.beginPath();
      ctx.arc(gx, gy, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textBaseline = "alphabetic";
    for (const it of items) {
      if (it.k === "img") { ctx.drawImage(it.img, it.x, it.y, it.w, it.h); continue; }
      const { st } = it;
      if (st.box) {
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.beginPath();
        ctx.roundRect(X0, it.y, CW, it.h, 12);
        ctx.fill();
      }
      if (it.quote) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(X0 + 6, it.y, 4, it.h);
      }
      ctx.font = st.font;
      ctx.fillStyle = INK;
      it.lines.forEach((ln, i) => {
        const base = it.y + st.pad + i * st.line + (st.line - st.size) / 2 + st.size * 0.8;
        ctx.fillText(ln, it.x + st.pad, base);
        if (st.bullet && i === 0) {
          ctx.beginPath();
          ctx.arc(it.x - 24, base - st.size * 0.3, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // credit
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(X0, fy, CW, 1.5);
    ctx.font = `700 32px ${SERIF}`;
    const nameW = ctx.measureText(SITE).width;
    ctx.fillStyle = "rgba(245,214,110,0.8)"; // the site's marker highlight
    ctx.fillRect(X0 - 4, fy + 36, nameW + 8, 18);
    ctx.fillStyle = INK;
    ctx.fillText(SITE, X0, fy + 58);
    const fit = (text, maxW) => {
      while (text.length > 4 && ctx.measureText(text).width > maxW) text = text.slice(0, -2).trimEnd() + "…";
      return text;
    };
    ctx.font = `italic 400 28px ${SERIF}`;
    ctx.fillStyle = "#555";
    ctx.fillText(fit(TITLE, CW), X0, fy + 100);
    ctx.font = `400 24px ${MONO}`;
    ctx.fillStyle = "#777";
    ctx.fillText(fit(PAGE.replace(/^https?:\/\//, ""), CW), X0, fy + 138);

    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
  }
})();
