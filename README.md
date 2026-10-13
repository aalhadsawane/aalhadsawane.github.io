# aalhadsawane.github.io

Blog built from the Obsidian vault at `~/Desktop/Obsidian Vaults/blog`
(path set in `site.config.json`).

## Publishing

1. In a note's properties set `publish: true`.
2. Run `./publish.sh` (or `./publish.sh --dry-run` to preview `docs/` locally).

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
