# aalhadsawane.github.io

Blog built from the Obsidian vault at `~/Desktop/Obsidian Vaults/blog`
(path set in `site.config.json`).

## Publishing

1. In a note's properties set `publish: true`.
2. Run `./publish.sh` (or `./publish.sh --dry-run` to preview `docs/` locally).

Fixing a typo? Edit the note and run `./publish.sh` again; it rebuilds everything and pushes only what changed.
(Renaming a note changes its URL; set a `slug:` property to keep it stable.)

That's it. Setting `publish: false` (or deleting the note) and re-running removes it.

## What the build does

- Picks only notes with `publish: true`; everything else in the vault is ignored.
- Copies only the images/SVGs those notes embed (`![[x.svg|wide]]`, or
  `![[x.excalidraw]]` → its exported `x.excalidraw.svg`), into the post's folder.
- Styles = all `.obsidian/snippets/*.css` + the note's `css:` file, so the site
  matches Obsidian. Always light theme.
- Each post gets `/<slug>/` (article) and `/<slug>/slides.html` (reveal.js, using
  the Advanced Slides `---` / `--` separators and `theme`, `center` properties).
- `index.html` lists posts newest first.

## Optional note properties

| property      | default                                   |
|---------------|-------------------------------------------|
| `title`       | first `# heading`, else filename          |
| `date`        | file creation time (set this to pin it)   |
| `description` | first paragraph                           |
| `slug`        | filename, lowercased and hyphenated       |

## Profile page

`profile.md` (in this repo) is the About page at `/profile/`: the body is the bio, and
`email`, `github`, `twitter`, `linkedin` in its properties become links (a bare handle or a
full URL both work; leave one empty to hide it). The banner is `theme/header.jpg`.

## Keeping the vault and the blog in sync

All visual styling lives in the vault CSS (`slides.css`, copied to `.obsidian/snippets/style.css`;
keep the two identical). This repo's `theme/*.css` only holds blog chrome (header, profile, index).
The slide builder emits the same `<div absolute="true">` wrapper per slide that Advanced Slides does,
so one CSS block styles both.

## RSS / email (follow.it)

The feed is `https://aalhadsawane.github.io/feed.xml`, rebuilt on every publish. A feed reader or
follow.it only sends a new item when it sees a guid it has not seen before, so `feed-state.json`
(committed) gives each post one permanent guid and publish time **the first time it is published**.
Editing a post later changes nothing in the item list, so it never re-sends.

- New post: `publish: true`, run `./publish.sh` → one new feed item → one email.
- Edit / typo fix / re-publish: same guid, no new item, no email.
- Unpublish then publish again: still the same guid, no email.
- A new `slug:` (or renaming the note file) *is* a new post, so it would be sent again.
- `./publish.sh --dry-run` never touches `feed-state.json`.
- `subscribeUrl` in `site.config.json` (optional): once follow.it gives you a sign-up page, put its
  URL there and the "subscribe" link points to it instead of the raw feed.
