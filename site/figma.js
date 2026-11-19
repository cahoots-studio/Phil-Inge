// Phil Inge — the pages `sc figma` pushes to Figma, built from the engine's compiler.
// Pages: home, projects, and each project slug.

const { loadSite } = require('./data');

function compile(id, h) {
  const { site, projects } = loadSite();
  const { tagsNode, warnings } = h;
  const compiler = (doc, data) => h.compiler(doc, data);
  const FIGMA = { width: h.width };
  const nav = { t: 'I', set: 'Navigation', v: { Layout: 'Desktop' }, n: 'Navigation', w: 'fill' };
  const footer = { t: 'I', set: 'Footer', n: 'Footer', w: 'fill' };

  if (id === 'home') {
    const cmp = compiler('site', site);
    const top = cmp.instance({ type: 'instance', component: 'Top', variant: { Type: 'Hero' }, bind: { headline: 'home.headline' } }, 'top');
    const gap = cmp.tok('$gap-large');
    const max = cmp.tok('$container-max');
    const pad = cmp.tok('$pad-section-global');
    const tileW = (Math.min(max.px, FIGMA.width - 2 * pad.px) - gap.px) / 2;
    const tiles = projects.map(pr => {
      const c = compiler(`projects/${pr.slug}`, pr);
      Object.assign(cmp.media, c.media);
      const o = [
        { k: 'text', l: 'Headline', p: c.at('title'), s: pr.title },
        // Card tags only show on hover (Hover variant), so Default has no Tags layer
        { ...c.useMedia(pr.cover, c.at('cover')), l: ['Media'] },
        { k: 'hide', l: 'Text' }, { k: 'hide', l: 'Action Row' },
      ];
      Object.assign(cmp.media, c.media);
      return { t: 'I', set: 'Project Tile', v: { 'Property 1': 'Default', Version: 'Card' }, n: `Project Tile / ${pr.title}`, w: tileW, o };
    });
    const grid = {
      t: 'F', n: 'Section / Portfolio Grid', d: 'V', pad: cmp.tok('$pad-section-global') && { t: cmp.tok('$pad-section-global'), r: cmp.tok('$pad-section-global'), b: cmp.tok('$pad-section-global'), l: cmp.tok('$pad-section-global') }, w: 'fill', ai: 'CENTER',
      c: [{ t: 'F', n: 'Container', d: 'H', wrap: true, gap, w: 'fill', max, c: tiles }],
    };
    return { name: 'Home', media: cmp.media, c: [nav, top, grid, footer] };
  }

  if (id === 'projects') {
    const cmp = compiler('site', site);
    const top = cmp.instance({ type: 'instance', component: 'Top', variant: { Type: 'Subpage' },
      bind: { headline: 'projectsPage.heading', tags: 'projectsPage.tags', text: 'projectsPage.intro' } }, 'top');
    top.o.push({ k: 'hide', l: 'Media' });
    const g = cmp.tok('$pad-section-global');
    const inner = Math.min(cmp.tok('$container-max').px, FIGMA.width - 2 * g.px);
    const rows = projects.map(pr => {
      const c = compiler(`projects/${pr.slug}`, pr);
      const media = { t: 'I', set: 'Media', v: { Ratio: 'Free' }, n: 'Media', w: 'fill', h: Math.round(inner * 437.625 / 1600), o: [{ ...c.useMedia(pr.cover, c.at('cover')), l: [null] }] };
      Object.assign(cmp.media, c.media);
      return {
        t: 'F', n: `Project Row / ${pr.title}`, d: 'V', gap: cmp.tok('$gap-large'), w: 'fill', ai: 'MAX', c: [
          { t: 'I', set: 'Headline', v: { 'Headline Size': 'Medium' }, n: 'Headline', w: 'fill', o: [{ k: 'text', l: null, p: c.at('title'), s: pr.title, u: 1 }] },
          media,
          { t: 'F', n: 'Summary', d: 'V', gap: cmp.tok('$gap-medium'), ai: 'MAX', w: 560, c: [
            { ...tagsNode(pr.tags, cmp) },
            { t: 'I', set: 'Text', v: { 'Text Size': 'Small' }, n: 'Text', w: 'fill', o: [{ k: 'text', l: null, p: c.at('summary'), s: pr.summary || '' }] },
          ] },
        ],
      };
    });
    const list = {
      t: 'F', n: 'Section / Project List', d: 'V', pad: { t: g, r: g, b: g, l: g }, w: 'fill', ai: 'CENTER',
      c: [{ t: 'F', n: 'Container', d: 'V', gap: cmp.tok('$gap-medium'), w: 'fill', max: cmp.tok('$container-max'), ai: 'MAX', c: rows }],
    };
    return { name: 'Projects', media: cmp.media, c: [top, list, footer] };
  }

  const pr = projects.find(x => x.slug === id);
  if (!pr) throw new Error(`No page "${id}" — use home, projects, or a project slug`);
  const cmp = compiler(`projects/${pr.slug}`, pr);
  const top = cmp.instance({ type: 'instance', component: 'Top', variant: { Type: 'Portfolio' },
    bind: { headline: 'title', tags: 'tags', text: 'summary', 'media.0': 'cover' } }, 'top');
  const sections = (pr.sections || []).map((s, i) => cmp.node(s, `sections.${i}`)).filter(Boolean);
  return { name: `Project / ${pr.title}`, media: cmp.media, c: [top, ...sections, footer] };
}

function pages() {
  const { projects } = loadSite();
  return ['home', 'projects', ...projects.map(p => p.slug)];
}

module.exports = { pages, compile };
