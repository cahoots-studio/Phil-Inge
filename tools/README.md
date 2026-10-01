# Editing the site

Page content lives in `/content` as JSON. The HTML in the site root and
`/projects` is **generated** from it — don't hand-edit those files.

## Edit mode

```bash
node tools/edit.js
```

Open http://localhost:4000 and click around:

- **Text** — click any title, tag, summary or headline and type. Enter saves, Esc cancels.
- **Images** — hover an image and click, or drop a file onto it. Uploads are
  resized to 2400px max (JPEG, or PNG if you upload a PNG) and saved to
  `assets/uploads/<project>/`. Replacing an image deletes the old upload.
- **Sections** (project pages) — hover a section for its toolbar: switch the
  Gallery **Layout**, move up/down, duplicate, delete. **+ Add section** between
  sections inserts a new Gallery in any layout. Switching layouts keeps every
  image, so images that don't fit a smaller layout come back if you switch back.
- **Publish** — commits `content/`, `assets/` and the generated HTML, then pushes
  to GitHub, which deploys philinge.com. Edit as much as you like first; each
  Publish is one deploy.

Everything saves as you go, and the static HTML is rebuilt after each change, so
you can also review the diff and commit by hand instead of using Publish.

Stop the editor with Ctrl+C. It only listens on your own machine.

## Other commands

```bash
node tools/build.js                       # rebuild HTML from /content
node tools/new-project.js "Project Name"  # new project from _template.json
```

## Files

| Path | What it is |
| --- | --- |
| `content/site.json` | Home headline, Projects page intro, project order |
| `content/projects/<slug>.json` | One project: title, tags, summary, cover, sections |
| `content/projects/_template.json` | Starting point for new projects |
| `library/<name>.json` | Components: variant props + the layout tree for each variant |
| `library/_presets.json` | Section + Container wrapped around a newly added component |
| `tools/render.js` | Page templates (shared by the build and the editor) |
| `tools/build.js` | Writes the static HTML |
| `tools/edit.js` | Local edit server |
| `tools/editor/` | Edit-mode UI (never published) |

## Structure

Pages are trees, the same as the Figma files:

```
Section     full width — padding, background
└ Container / Column   width (fill, or a value on the width ladder)
  └ Component          an instance of a library component + its variant
    └ Block            media, (later: headline, text, tag, field, action row)
```

Every wrapper is a flexbox. Layout keys on any node:

| Key | Values |
| --- | --- |
| `direction` | `row` or `column` (default) |
| `width`, `height` | `fill`, `fill <weight>`, `hug`, or a fixed length |
| `gap`, `padding` | a length; padding can be `{ "x": …, "y": … }` |
| `align`, `justify`, `wrap`, `aspect`, `max`, `background` | CSS values |
| `mobile` | `stack` → one column under 900px |

Any value starting with `$` is a design variable: `"$gap-media"` → `var(--gap-media)`.

A component instance in a page stores only `component`, `variant` and
`content` (e.g. `content.media[]`); the layout comes from `library/`.

Requires Node 18+ and macOS (`sips` does the image resizing).
