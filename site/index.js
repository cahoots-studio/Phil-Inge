// Phil Inge — page templates. The engine (Supercomponent) renders the content;
// this file decides which pages exist and wraps them in the site's own chrome:
// <head>, header, footer. Exports routes() and layout() for the engine.

const sc = require('supercomponent/engine');

const { config, esc, ctx, img, slug, MARKER, loadLibrary, loadPresets, renderNode, renderSections, editData,
  editorStyles, editorScripts } = sc;

const { loadSite } = require('./data');

// ---------------------------------------------------------------- helpers

function tags(c, doc, list, base = 'tags') {
  return `<ul class="tags">
${(list || []).map((tag, i) =>
  `                  <li class="tag tag--${esc(tag.color || 'orange')}"${c.t(doc, `${base}.${i}.label`)}>${esc(tag.label)}</li>`).join('\n')}
                </ul>`;
}

function projectHref(c, slug) {
  return `${c.p}projects/${slug}.html`;
}

// ---------------------------------------------------------------- chrome

// Typefaces a component brings with it (project artwork rebuilt live), loaded
// only on pages that use it
const EXTRA_FONTS = {
  palette: 'family=Geist:wght@400&family=Geist+Mono:wght@400&family=Instrument+Serif',
};

function head({ title, description }, c, main = '') {
  const extra = Object.entries(EXTRA_FONTS).filter(([hook]) => main.includes(`data-hook="${hook}"`))
    .map(([, q]) => `\n  <link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Inter:wght@400;600&family=Inter+Tight:wght@400&display=swap" rel="stylesheet">${extra}
  <link rel="stylesheet" href="${c.p}css/tokens.css">
  <link rel="stylesheet" href="${c.p}css/styles.css">${editorStyles(c)}
</head>`;
}

// Site navigation, shared by the header and the footer (Figma: Navigation, Footer)
function navColumns(c, projects, currentSlug) {
  const links = labels => labels.map(label => ({ label, href: '#' }));
  return [
    { heading: 'Portfolio', href: `${c.p}projects/`, viewAll: `${c.p}projects/`,
      links: projects.map(pr => ({ label: pr.title, href: projectHref(c, pr.slug), current: pr.slug === currentSlug })) },
    { heading: 'Tools', links: links(['Crayonsnack', 'Vibe Dial', 'Recolorator', 'Builder', 'Message Maker', 'Brand Aligner']) },
    { heading: 'Services', links: links(['Logo Design', 'Visual Identity Design', 'Website Design', 'Integrated Visual Brand Systems']) },
    { heading: 'Sessions', links: links(['Learn', 'Build', 'Consult']) },
  ];
}

function navList(cols, cls, pad) {
  return cols.map(col => {
    const heading = col.href
      ? `<a class="${cls}__heading" href="${col.href}">${esc(col.heading)}</a>`
      : `<p class="${cls}__heading">${esc(col.heading)}</p>`;
    const items = col.links.map(l =>
      `${pad}    <li><a class="nav-link" href="${esc(l.href)}"${l.current ? ' aria-current="page"' : ''}>${esc(l.label)}</a></li>`).join('\n');
    const all = col.viewAll
      ? `\n${pad}  <a class="nav-link nav-link--all" href="${col.viewAll}">View all <span aria-hidden="true">→</span></a>`
      : '';
    return `${pad}<div class="${cls}__col">
${pad}  ${heading}
${pad}  <ul class="${cls}__links">
${items}
${pad}  </ul>${all}
${pad}</div>`;
  }).join('\n');
}

// Figma: Navigation. Desktop is a slim bar that opens into a 3/4-height takeover
// (Desktop Expanded) on hover; touch devices and phones open it with the toggle (js/nav.js).
const AFFILIATES = [
  { name: 'GWK', href: '#' },
  { name: 'Cahoots', href: 'https://www.cahoots.studio' },
  { name: 'Jagaloon', href: '#' },
];

function header(c, projects, currentSlug) {
  const cols = navColumns(c, projects, currentSlug);
  const social = SOCIAL.map(s =>
    `          <li><a href="${s.href}" aria-label="${s.name}"><img src="${c.p}assets/icons/${s.icon}.svg" width="20" height="20" alt=""></a></li>`).join('\n');
  return `  <header class="site-header" data-sc-scheme="scheme-1">
    <div class="site-header__inner">
      <div class="site-header__bar">
        <a class="site-logo" href="${c.p || './'}" aria-label="Phil Inge — home">
          <img src="${c.p}assets/logo.svg" width="312.458" height="50.9614" alt="Phil Inge">
        </a>
        <p class="site-header__peek" aria-hidden="true">${cols.map(col => `<span>${esc(col.heading)}</span>`).join('')}</p>
        <button class="site-header__toggle" type="button" aria-expanded="false" aria-controls="site-panel" aria-label="Open menu">
          <span></span><span></span>
        </button>
      </div>
      <div class="site-header__panel" id="site-panel">
        <nav class="site-nav" id="site-nav" aria-label="Main">
${navList(cols, 'site-nav', '          ')}
        </nav>
        <div class="site-header__affiliates">
          <p class="site-header__label">Affiliates</p>
          <ul>
${AFFILIATES.map(a => `            <li><a href="${a.href}">${esc(a.name)}</a></li>`).join('\n')}
          </ul>
        </div>
      </div>
      <div class="site-header__aside">
        <address class="site-header__contact">
          <span>c/o Cahoots Studio</span>
          <span>Denver, CO 80202</span>
          <a href="https://www.cahoots.studio">www.cahoots.studio</a>
        </address>
        <ul class="site-header__social" aria-label="Social">
${social}
        </ul>
      </div>
      <hr class="site-header__rule">
    </div>
  </header>`;
}

// Figma: Patterns → Footer (Scheme 3 — Contrast)
const SOCIAL = [
  { name: 'LinkedIn', icon: 'linkedin', href: '#' },
  { name: 'Instagram', icon: 'instagram', href: '#' },
  { name: 'Behance', icon: 'behance', href: '#' },
  { name: 'Awwwards', icon: 'awwwards', href: '#' },
];

// Footer message field: short prompt at rest, the full example once it opens
const MESSAGE_PROMPT = [
  'message me here',
  'Hey Phil, this is [Sam Squanch] from [Thusandsuch Bros.] I’m hoping you can help me. Call me back at [anytime that works for you].',
];

function footer(c, projects) {
  const social = SOCIAL.map(s =>
    `          <li><a class="site-footer__social-link" href="${s.href}" aria-label="${s.name}"><img src="${c.p}assets/icons/${s.icon}.svg" width="20" height="20" alt=""></a></li>`).join('\n');
  return `  <footer class="site-footer" data-sc-scheme="scheme-3">
    <div class="site-footer__upper">
      <div class="site-footer__identity">
        <div class="site-footer__logo">
          <a href="${c.p || './'}" aria-label="Phil Inge — home"><img src="${c.p}assets/logo-light.svg" width="312.458" height="50.9614" alt="Phil Inge"></a>
        </div>
      <form class="site-footer__form contact-form" name="contact" method="POST" data-netlify="true" netlify-honeypot="bot-field">
        <input type="hidden" name="form-name" value="contact">
        <p hidden><label>Leave this empty <input name="bot-field"></label></p>
        <label class="contact-form__message">
          <span class="visually-hidden">Message</span>
          <textarea class="ghost-field ghost-field--message" name="message" rows="2" required
            placeholder="${MESSAGE_PROMPT[0]}" data-placeholder-open="${esc(MESSAGE_PROMPT[1])}"></textarea>
        </label>
        <div class="contact-form__reply">
          <label class="contact-form__label" for="contact-email">Contact preference</label>
          <div class="contact-form__row">
            <input class="ghost-field ghost-field--email" id="contact-email" type="email" name="email" autocomplete="email" placeholder="email@yourdomain.com" required>
            <button class="sc-button sc-button--primary sc-button--round contact-form__send" type="submit">Send</button>
          </div>
        </div>
      </form>
        <address class="site-footer__address">
          <span>c/o Cahoots Studio</span>
          <span>Denver, CO 80202</span>
          <a href="https://www.cahoots.studio">www.cahoots.studio</a>
        </address>
        <ul class="site-footer__social" aria-label="Social">
${social}
        </ul>
      </div>
      <nav class="site-footer__nav" aria-label="Footer">
${navList(navColumns(c, projects), 'site-footer', '        ')}
      </nav>
    </div>

    <hr class="site-footer__rule">

    <div class="site-footer__lower">
      <div class="site-footer__credits">
        <p>Dreamed Designed and build by Cahoots Studio</p>
        <p>© 2026 Cahoots Studio</p>
      </div>
      <ul class="site-footer__subnav">
        <li><a href="#">Privacy Policy</a></li>
        <li><a href="#">Terms of Service</a></li>
        <li><a href="#">Accessibility</a></li>
        <li><a href="#">Cookie Settings</a></li>
      </ul>
    </div>
  </footer>

  <script src="${c.p}js/nav.js" defer></script>
  <script src="${c.p}js/contact.js" defer></script>
  <script src="${c.p}js/media.js" defer></script>
  <script src="${c.p}js/top.js" defer></script>
  <script src="${c.p}js/explode.js" defer></script>${editorScripts(c)}
</body>
</html>
`;
}

function page(meta, c, projects, currentSlug, main) {
  return `${head(meta, c, main)}
<body>
${c.edit ? '' : MARKER + '\n'}
${header(c, projects, currentSlug)}

  <main>
${main}
  </main>

${footer(c, projects)}`;
}

// ---------------------------------------------------------------- pages

function renderHome(opts = {}) {
  const { site, projects } = loadSite();
  const c = ctx(opts, '');
  const h = site.home;
  const tiles = projects.map(pr => {
    const doc = `projects/${pr.slug}`;
    // Figma: Project Tile (Card). Tags are revealed on hover — see .project-tile in styles.css
    return `          <li>
            <a class="project-tile" href="${projectHref(c, pr.slug)}">
              <div class="project-tile__media"${c.m(doc, 'cover', pr.cover)}>${img(c, pr.cover)}</div>
              <div class="project-tile__meta">
                <div class="project-tile__tags">${tags(c, doc, pr.tags)}</div>
                <h2 class="project-tile__title"><span${c.t(doc, 'title')}>${esc(pr.title)}</span> <span class="project-tile__arrow" aria-hidden="true"><img src="${c.p}assets/arrow.svg" width="26" height="21.4744" alt=""><img class="project-tile__arrow-hover" src="${c.p}assets/arrow-active.svg" width="26" height="21.4744" alt=""></span></h2>
              </div>
            </a>
          </li>`;
  }).join('\n');

  return page(h, c, projects, null, `${renderTop(c, 'site', site, 'Hero', { headline: 'home.headline' })}

    <section class="portfolio" aria-label="Selected work">
      <div class="container">
        <ul class="portfolio__grid">
${tiles}
        </ul>
      </div>
    </section>`);
}

function renderProjects(opts = {}) {
  const { site, projects } = loadSite();
  const c = ctx(opts, '../');
  const pg = site.projectsPage;
  const rows = projects.map(pr => {
    const doc = `projects/${pr.slug}`;
    return `          <li>
            <a class="project-row" href="${pr.slug}.html">
              <h2 class="project-row__title"${c.t(doc, 'title')}>${esc(pr.title)}</h2>
              <div class="media project-row__media"${c.m(doc, 'cover', pr.cover)}>${img(c, pr.cover)}</div>
              <div class="project-summary">
                ${tags(c, doc, pr.tags)}
                <p${c.t(doc, 'summary')}>${esc(pr.summary)}</p>
              </div>
            </a>
          </li>`;
  }).join('\n');

  return page(pg, c, projects, null, `${renderTop(c, 'site', site, 'Subpage',
    { headline: 'projectsPage.heading', tags: 'projectsPage.tags', text: 'projectsPage.intro' })}

    <section class="project-list" aria-label="All projects">
      <div class="container">
        <ul class="project-list__stack">
${rows}
        </ul>
      </div>
    </section>`);
}

// The page header: a Top instance bound to the page's own data
function renderTop(c, doc, data, type, bind) {
  const lib = loadLibrary();
  const { section, container } = loadPresets();
  const tree = { ...(lib.Top.section || section), children: [{ ...container, children: [
    { type: 'instance', component: 'Top', variant: { Type: type }, bind },
  ] }] };
  const html = renderNode(tree, { c, doc, lib, data, path: 'top' }, null, 2);
  return html.replace('<section ', `<section data-top="${slug(type)}" `);
}

function renderProject(slug, opts = {}) {
  const { projects } = loadSite();
  const pr = projects.find(x => x.slug === slug);
  if (!pr) return null;
  const c = ctx(opts, '../');
  const doc = `projects/${slug}`;
  const meta = {
    title: `${pr.title} — Phil Inge`,
    description: pr.summary,
  };
  const sections = renderSections(c, doc, pr.sections) + (c.edit
    ? `\n  <script type="application/json" id="sc-edit-data">${JSON.stringify(editData(doc, pr.sections)).replace(/</g, '\\u003c')}</script>`
    : '');

  return page(meta, c, projects, slug, `${renderTop(c, doc, pr, 'Portfolio',
    { headline: 'title', tags: 'tags', text: 'summary', 'media.0': 'cover' })}

${sections}`);
}

// ---------------------------------------------------------------- engine hooks

// Every page the site builds: { file, render(opts) }
function routes() {
  const { projects } = loadSite();
  return [
    { file: 'index.html', render: renderHome },
    { file: 'projects/index.html', render: renderProjects },
    ...projects.map(p => ({ file: `projects/${p.slug}.html`, render: opts => renderProject(p.slug, opts) })),
  ];
}

// The site chrome around any page body (the engine's styleguide uses it)
function layout(meta, c, main) {
  const { projects } = loadSite();
  return page(meta, c, projects, null, main);
}

module.exports = { routes, layout, loadSite, renderHome, renderProjects, renderProject, figma: require('./figma') };
