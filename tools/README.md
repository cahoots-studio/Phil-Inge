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

## Design tokens (Figma variables)

Spacing, type sizes, fonts and radii come straight from the Figma variables,
**one value per breakpoint mode**:

| Mode | Screen width |
| --- | --- |
| 1920 | 1680px and up (the comps) |
| 1440 | 1280 – 1679px |
| Desktop | 1024 – 1279px |
| Tablet | 768 – 1023px |
| Mobile Landscape | 480 – 767px |
| Mobile Portrait | under 480px |

- `tokens/figma-variables.json` — every variable in every mode, exported from
  Figma, plus the breakpoint ranges above.
- `node tools/tokens.js` — writes `css/tokens.css` from it (don't edit that file).
- Names follow the Figma path: `Padding/Gap/Tiny` → `--padding-gap-tiny`.
  `css/styles.css` keeps short aliases (`--gap-tiny`, `--pad-section-global`…).

To re-sync after changing variables in Figma: ask Claude to re-export them into
`tokens/figma-variables.json`, then run `node tools/tokens.js`.

Colors aren't mode-based yet (the Light scheme is hard-coded in styles.css).

## Other commands

```bash
node tools/build.js                       # rebuild HTML from /content
node tools/tokens.js                      # rebuild css/tokens.css from Figma variables
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

## Blocks

From Figma → Style Guide & Component Library → Primitives:

| Block | Options |
| --- | --- |
| `headline` | `size`: Hero, Huge, Large, Medium, Small, Tiny · `level`: h1–h6 (default h2) |
| `text` | `size`: Huge, Large, Medium, Small, Tiny |
| `label` | — |
| `tag` | `color`: Orange, Purple, Yellow, Pink, Green |
| `tags` | a list of `{ label, color }` |
| `button` | `priority`: Primary, Secondary, Link · `round`, `submit`, `href` |
| `actions` | Action Row — `actionType`: Buttons (default) or Email Capture |
| `field` | Input — `fieldType`: Basic, Email, Long Form · `label`, `placeholder`, `name` |
| `media` | `aspect` (e.g. `16/9`, `4/5`, `21/9`; omit for Free) |

Inside a library component a block names a `field` (plus a `default`), and the
text comes from the instance's `content.<field>` — that's what edit mode
changes when you click it. A button's link is `content.<field>Href`. Placed
directly in a page tree, a block carries its own `text`.

Library components: **Top** (Type: Hero, Subpage, Portfolio — the page
header), **Gallery** (Layout ×5) and **Supercomponent** (Type: Default, Card).

**Bindings.** An instance can take a field from the page's own data instead of
its `content`, like Webflow binding a component to CMS fields. Every page
renders a Top instance this way: Home binds `headline → home.headline`;
Projects binds headline, tags and text to `projectsPage.*`; project pages bind
`headline → title`, `tags → tags`, `text → summary` and `media.0 → cover`. So
editing a project's header edits the project itself, and the change shows up
on its Home tile, in the Projects list and in the nav. With the editor running, http://localhost:4000/__styleguide
shows every block and every component variant.

Requires Node 18+ and macOS (`sips` does the image resizing).
