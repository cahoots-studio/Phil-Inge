# Phil Inge — editing the site

This site is a **Supercomponent project**: the engine (page builder, editor, Figma
sync, token tools) lives in the [supercomponent](https://github.com/cahoots-studio/supercomponent)
repo and is installed as a dependency. This repo holds only what's Phil's: content,
media, page templates (`site/`), its own components (`library/`), brand tokens and CSS.

First time on a machine: `npm install` (needs access to the supercomponent repo).

Page content lives in `/content` as JSON. The HTML in the site root and
`/projects` is **generated** from it — don't hand-edit those files.

## Edit mode

```bash
npm run edit
```

Open http://localhost:4000 and click around:

- **Text** — click any title, tag, summary or headline and type. Enter saves, Esc cancels.
- **Images & video** — hover a media slot and click, or drop a file onto it.
  Saved to `assets/uploads/<project>/`; replacing media deletes the old files.

  | You upload | You get |
  | --- | --- |
  | Video — MP4, MOV, WebM, M4V, MKV, AVI… | MP4 (H.264/AAC), long edge ≤ 1920px, streams instantly, plus a poster frame. Plays autoplay/muted/looping/inline |
  | Animated GIF | Looping MP4 (much smaller) + poster |
  | JPEG, HEIC/HEIF, TIFF, BMP | JPEG, long edge ≤ 2400px |
  | PNG | PNG, long edge ≤ 2400px |
  | WebP, AVIF, SVG, still GIF | Kept exactly as uploaded |

  **Poster frames** — hover a video and click **Poster**: scrub to any moment
  and **Use this frame**, or **Upload image…** for a custom poster (cropped to
  the video's size). The poster shows before the video plays, and in Figma.

  Videos are converted with **ffmpeg** (`brew install ffmpeg`). A video that's
  still over 95 MB after converting is refused — GitHub won't accept files over
  100 MB — so trim long clips first. On the site, videos pause for visitors
  with "reduce motion" on, and only play while on screen (`js/media.js`).
- **Structure** (project pages). Edit mode looks exactly like the live page;
  controls only appear when you hover something editable:
  - **Add section** — hover the line between two sections; they slide apart to
    reveal a full-width *Add section*. It adds a blank section with a container.
  - **Add component** — a blank container shows *Add component*; between
    components, hover the line to open the same action. Pick from the library
    (Gallery, Supercomponent, Top) and its variants.
  - **Add column** — hover the left/right edge of a container or column; the
    content squeezes aside to reveal *Add column*. The container becomes a row
    of columns (stacked on mobile); between columns the same squish adds more.
  - **Toolbars** — hovering a section, column or component shows its own small
    toolbar (only the innermost): move, duplicate, delete, and the component's
    variant (e.g. Gallery Layout). Switching layouts keeps every image.
  - Empty sections, containers and columns are skipped on the published site.
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
- `npm run tokens` — writes `css/tokens.css` from it (don't edit that file).
- Names follow the Figma path: `Padding/Gap/Tiny` → `--padding-gap-tiny`.
  `css/styles.css` keeps short aliases (`--gap-tiny`, `--pad-section-global`…).

To re-sync after changing variables in Figma: ask Claude to re-export them into
`tokens/figma-variables.json`, then run `npm run tokens`.

Colors aren't mode-based yet (the Light scheme is hard-coded in styles.css).

## Push to Figma

Ask Claude to "push to Figma". Every page is rebuilt as a frame in the
**Site — synced from code** section on the Figma Design page, assembled from the
library components (Top, Gallery, Media, Tag, Headline, Text, Project Tile,
Navigation, Footer) with spacing bound to the Figma variables. Each push replaces
the frame of the same name in place. Frames outside the section are never touched.

- Media: images go up as they are; videos go up as their poster frame. HEIC, AVIF
  and TIFF are converted to JPEG first. SVG is skipped. Empty slots keep the
  component's placeholder image.
- Text that only differs in case or spacing is left alone, so typesetting done in
  Figma survives a push.
- Figma's image hash is the SHA-1 of the file, so an image is uploaded only once,
  and pull-from-Figma can compare any slot with the local file directly.

Claude runs the Figma half through the Figma connector. The tool prepares and
records it:

```bash
npm run figma plan [page…]      # compile pages, list media not yet in Figma
npm run figma upload '<urls>'   # post that media to Figma upload URLs
npm run figma script <page…|all> # write the Figma build script
npm run figma status            # frames and images from the last push
```

`.figma-sync/state.json` (committed) holds the uploaded image hashes and frame ids.
The rest of `.figma-sync/` is scratch.

## Other commands

```bash
npm run build                             # rebuild HTML from /content
npm run tokens                            # rebuild css/tokens.css from Figma variables
npm run new-project -- "Project Name"     # new project from _template.json
```

## Files

| Path | What it is |
| --- | --- |
| `content/site.json` | Home headline, Projects page intro, project order |
| `content/projects/<slug>.json` | One project: title, tags, summary, cover, sections |
| `content/projects/_template.json` | Starting point for new projects |
| `library/<name>.json` | This site's own components (Top, Gallery, Exploded View, Colour Palette). Core ones (Media, Supercomponent) come from the engine; a file here with the same name replaces the engine's |
| `site/index.js` | Page templates: which pages exist, `<head>`, header, footer |
| `site/data.js` | Loads `content/` (projects in site order) |
| `site/figma.js` | The pages `npm run figma` pushes, and how each is laid out |
| `site/figma-handlers.js` | Figma overrides for components with their own sync (Colour Palette) |
| `supercomponent.config.js` | Project settings: name, tag colours, Figma file and component ids |
| `node_modules/supercomponent/` | The engine (installed, not committed): renderer, build, editor, Figma sync |

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

Figma has a matching **Gallery** component (Style Guide → Patterns) built from
the Media component, with its image layers named `Media 1…6` in the same slot
order as `content.media[]`. The gap between images is the Figma variable
`Padding/Gap/Media` (`--padding-gap-media`).

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

Requires Node 18+, macOS (`sips` resizes images) and ffmpeg (video).
