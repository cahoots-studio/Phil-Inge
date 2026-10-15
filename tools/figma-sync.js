// Push site content to Figma: one frame per page on the Design page, built from the
// library's Figma components (Top, Gallery, Media, Tag, Headline, Text, Project Tile, Footer).
//
// Figma is written through the Figma MCP (use_figma + upload_assets), so Claude runs the
// steps; this tool prepares and records them:
//
//   node tools/figma-sync.js plan [page…]     compile pages → .figma-sync/plan.json and list
//                                             media that still need uploading to Figma
//   node tools/figma-sync.js script <page…|all>  write .figma-sync/scripts/<page|batch>.js,
//                                             the use_figma script that rebuilds those frames
//   node tools/figma-sync.js upload '<urls>'  POST the pending media to upload_assets URLs
//                                             (one per pending file, in order); records hashes
//   node tools/figma-sync.js record '<json>'  store a result: { images: { key: imageHash } }
//                                             from an upload, or a builder result for a page
//   node tools/figma-sync.js status           pages, frames and slot counts from the last push
//
// Pages: home, projects, and each project slug. Video slots go to Figma as their poster
// frame (Figma can't take video through the connector). Empty slots keep the component's
// placeholder, but are still recorded so an image dropped in Figma can be pulled later.
// .figma-sync/state.json (committed) remembers each image's Figma hash, so unchanged media
// are never uploaded twice, and which frame each page was pushed to. (Figma's image hash is
// the SHA-1 of the file, so pull can compare any layer with the local file directly.)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ROOT, loadSite, loadLibrary, findVariant } = require('./render');

const DIR = path.join(ROOT, '.figma-sync');
const STATE = path.join(DIR, 'state.json');
const FIGMA = {
  fileKey: 'lku8ICcBCPYcllZIIjVi3u',
  pageId: '2001:448',            // Design
  bgFrom: '2001:449',            // Home frame: page fill + variable modes to copy
  section: 'Site — synced from code',
  width: 1728,
  sets: {
    Top: '2057:3995', Gallery: '2103:496', Media: '443:446', Headline: '443:369', Text: '443:382',
    Tag: '2021:748', Footer: '452:196', Navigation: '455:318', 'Project Tile': '2024:829',
  },
};
const MAX_BYTES = 10 * 1024 * 1024;  // upload_assets limit
const DIRECT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const TAG = { orange: 'Orange', violet: 'Purple', purple: 'Purple', yellow: 'Yellow', pink: 'Pink', green: 'Green' };
const BLOCK_LAYER = { headline: 'Headline', text: 'Text', label: 'Label', tag: 'Tag', button: 'Button' };

const readState = () => fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { images: {}, pages: {} };
const writeState = s => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n'); };

// ---------------------------------------------------------------- tokens
// "$pad-section-gallery" → styles.css alias chain → tokens.css name → Figma variable path

const cssName = p => '--' + p.toLowerCase().replace(/[\s/]+/g, '-');
function loadTokens() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens', 'figma-variables.json'), 'utf8'));
  const byCss = {};
  const all = {};
  for (const col of Object.values(data.collections)) Object.assign(all, col.variables);
  const px = (p, seen = 0) => {
    const v = all[p] && all[p]['1920'];
    return v && typeof v === 'object' && v.alias && seen < 5 ? px(v.alias, seen + 1) : v;
  };
  for (const p of Object.keys(all)) byCss[cssName(p)] = { v: p, px: px(p) };
  const aliases = {};
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);/gm)) if (!aliases[m[1]]) aliases[m[1]] = m[2];
  return value => {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value;
    const s = String(value).trim();
    if (s.startsWith('$')) {
      let name = '--' + s.slice(1);
      for (let i = 0; i < 6 && !byCss[name] && aliases[name]; i++) name = aliases[name];
      const hit = byCss[name];
      if (!hit || typeof hit.px !== 'number') return null;
      return hit;
    }
    const n = parseFloat(s);
    return /^-?[\d.]+(px)?$/.test(s) ? n : null;  // %, em, calc → let Figma decide
  };
}

// ---------------------------------------------------------------- media

function mediaKey(m, warnings) {
  if (!m || !m.src) return null;
  const rel = m.type === 'video' ? m.poster : m.src;
  if (!rel) { warnings.push(`video without poster: ${m.src}`); return null; }
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { warnings.push(`missing file ${rel}`); return null; }
  const key = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
  return { key, file: rel };
}

// The file to upload for a key: as-is when Figma takes it, else a JPEG made with sips
function uploadFile(rel, key) {
  const file = path.join(ROOT, rel);
  const ext = path.extname(file).toLowerCase();
  if (DIRECT[ext] && fs.statSync(file).size <= MAX_BYTES) return { file, mime: DIRECT[ext] };
  if (ext === '.svg') return null;
  const out = path.join(DIR, 'upload', key + '.jpg');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!fs.existsSync(out)) execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '2400', file, '--out', out], { stdio: 'ignore' });
  return { file: out, mime: 'image/jpeg' };
}

// ---------------------------------------------------------------- compile

function compiler(doc, data, warnings) {
  const lib = loadLibrary();
  const tok = loadTokens();
  const media = {};  // key → rel file
  const useMedia = (m, p) => {
    const hit = mediaKey(m, warnings);
    if (hit) media[hit.key] = hit.file;
    return { k: 'media', p, img: hit && hit.key };
  };
  const at = (p) => `${doc}#${p}`;
  const hasInstance = n => n.type === 'instance' || (n.children || []).some(hasInstance);
  const ALIGN = { 'flex-start': 'MIN', start: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', 'space-between': 'SPACE_BETWEEN', baseline: 'BASELINE' };

  function pad(p) {
    if (p == null) return null;
    if (typeof p !== 'object') { const v = tok(p); return { t: v, r: v, b: v, l: v }; }
    const x = tok(p.x), y = tok(p.y);
    return { t: tok(p.top) ?? y, b: tok(p.bottom) ?? y, l: x, r: x };
  }
  function dim(v, fallback) {
    if (v == null) return fallback;
    if (/^fill/.test(v)) return 'fill';
    if (v === 'hug') return 'hug';
    return tok(v) ?? fallback;
  }

  // Field value for an instance: bound page data, else the instance's own content
  function field(inst, key) {
    if (inst.bind && inst.bind[key]) {
      const p = inst.bind[key];
      return { value: p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data), path: at(p) };
    }
    const [k, i] = key.split('.');
    const v = inst.content && (i != null ? (inst.content[k] || [])[i] : inst.content[k]);
    return { value: v, path: at(`${inst.path}.content.${key}`) };
  }

  // Overrides on a Figma instance, from the blocks in the library variant's tree
  function overrides(def, inst) {
    const { tree } = findVariant(def, inst.variant);
    const o = [];
    let actions = false;
    (function walk(n) {
      if (n.type === 'actions') actions = true;
      if (n.type === 'media' && Number.isInteger(n.slot)) {
        const { value, path: p } = field(inst, `media.${n.slot}`);
        o.push({ ...useMedia(value, p), l: n.slot === 0 ? ['Media 1', 'Media'] : [`Media ${n.slot + 1}`] });
      } else if (n.type === 'tags' && n.field) {
        const { value, path: p } = field(inst, n.field);
        if (Array.isArray(value)) o.push({ k: 'tags', l: 'Tags', p, tags: value.map(t => ({ s: t.label, c: TAG[t.color] || 'Orange' })) });
      } else if (BLOCK_LAYER[n.type] && n.field) {
        const { value, path: p } = field(inst, n.field);
        if (typeof value === 'string' && value) o.push({ k: 'text', l: BLOCK_LAYER[n.type], p, s: value, ...(n.case === 'upper' ? { u: 1 } : {}) });
      }
      (n.children || []).forEach(walk);
    })(tree);
    if (!actions) o.push({ k: 'hide', l: 'Action Row' });
    return o;
  }

  function instance(n, p, extra = {}) {
    const def = lib[n.component];
    if (!def) throw new Error(`Unknown component "${n.component}" in ${doc}`);
    const variant = { ...findVariant(def, n.variant).props };
    if (!FIGMA.sets[n.component]) {
      warnings.push(`${n.component} has no Figma component — built as frames`);
      return node({ ...findVariant(def, n.variant).tree, type: 'container' }, p, { ...n, path: p });
    }
    return { t: 'I', set: n.component, v: variant, n: n.component, w: 'fill', o: overrides(def, { ...n, path: p }), ...extra };
  }

  function node(n, p, inst) {
    switch (n.type) {
      case 'instance': return instance(n, p);
      case 'section': case 'container': case 'column': case 'component': {
        if (!inst && !hasInstance(n)) return null;
        const first = (n.children || []).find(hasInstance);
        const name = n.type === 'section'
          ? `Section${(() => { let f = n; while (f && f.type !== 'instance') f = (f.children || []).find(hasInstance); return f ? ' / ' + f.component : ''; })()}`
          : n.type[0].toUpperCase() + n.type.slice(1);
        const row = n.direction === 'row';
        const kids = (n.children || []).map((c, i) => node(c, `${p}.children.${i}`, inst)).filter(Boolean);
        const out = {
          t: 'F', n: name, d: row ? 'H' : 'V', gap: tok(n.gap), pad: pad(n.padding),
          w: dim(n.width, 'fill'), h: dim(n.height), max: tok(n.max) || tok(n.maxWidth) || undefined,
          jc: ALIGN[n.justify], ai: ALIGN[n.align] || (n.max || first ? 'CENTER' : undefined), wrap: n.wrap || undefined, c: kids,
        };
        // A centred, max-width container: its section centres it
        if (n.type === 'section') out.ai = 'CENTER';
        return out;
      }
      default:
        warnings.push(`${n.type} block outside a component isn't pushed yet (${p})`);
        return null;
    }
  }

  return { node, instance, overrides, tok, media, useMedia, field, at };
}

function tagsNode(list, cmp) {
  return {
    t: 'F', n: 'Tags', d: 'H', gap: cmp.tok('$gap-small'), wrap: true, w: 'hug',
    c: (list || []).map(t => ({ t: 'I', set: 'Tag', v: { Color: TAG[t.color] || 'Orange' }, n: 'Tag', o: [{ k: 'text', l: null, s: t.label }] })),
  };
}

function compilePage(id, site, projects, warnings) {
  const nav = { t: 'I', set: 'Navigation', v: { Layout: 'Desktop' }, n: 'Navigation', w: 'fill' };
  const footer = { t: 'I', set: 'Footer', n: 'Footer', w: 'fill' };

  if (id === 'home') {
    const cmp = compiler('site', site, warnings);
    const top = cmp.instance({ type: 'instance', component: 'Top', variant: { Type: 'Hero' }, bind: { headline: 'home.headline' } }, 'top');
    const gap = cmp.tok('$gap-large');
    const max = cmp.tok('$container-max');
    const pad = cmp.tok('$pad-section-global');
    const tileW = (Math.min(max.px, FIGMA.width - 2 * pad.px) - gap.px) / 2;
    const tiles = projects.map(pr => {
      const c = compiler(`projects/${pr.slug}`, pr, warnings);
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
    const cmp = compiler('site', site, warnings);
    const top = cmp.instance({ type: 'instance', component: 'Top', variant: { Type: 'Subpage' },
      bind: { headline: 'projectsPage.heading', tags: 'projectsPage.tags', text: 'projectsPage.intro' } }, 'top');
    top.o.push({ k: 'hide', l: 'Media' });
    const g = cmp.tok('$pad-section-global');
    const inner = Math.min(cmp.tok('$container-max').px, FIGMA.width - 2 * g.px);
    const rows = projects.map(pr => {
      const c = compiler(`projects/${pr.slug}`, pr, warnings);
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
  const cmp = compiler(`projects/${pr.slug}`, pr, warnings);
  const top = cmp.instance({ type: 'instance', component: 'Top', variant: { Type: 'Portfolio' },
    bind: { headline: 'title', tags: 'tags', text: 'summary', 'media.0': 'cover' } }, 'top');
  const sections = (pr.sections || []).map((s, i) => cmp.node(s, `sections.${i}`)).filter(Boolean);
  return { name: `Project / ${pr.title}`, media: cmp.media, c: [top, ...sections, footer] };
}

function allPages(projects) {
  return ['home', 'projects', ...projects.map(p => p.slug)];
}

// ---------------------------------------------------------------- commands

function plan(ids) {
  const { site, projects } = loadSite();
  const state = readState();
  const warnings = [];
  const pages = {};
  const media = {};
  for (const id of ids.length ? ids : allPages(projects)) {
    const pg = compilePage(id, site, projects, warnings);
    pages[id] = { name: pg.name, c: pg.c };
    Object.assign(media, pg.media);
  }
  const pending = [];
  for (const [key, rel] of Object.entries(media)) {
    if (state.images[key]) continue;
    const up = uploadFile(rel, key);
    if (!up) { warnings.push(`can't send ${rel} to Figma (SVG)`); continue; }
    pending.push({ key, source: rel, file: up.file, mime: up.mime, bytes: fs.statSync(up.file).size });
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'plan.json'), JSON.stringify({ pages, media }, null, 1));
  fs.writeFileSync(path.join(DIR, 'pending.json'), JSON.stringify({ pending }, null, 1));
  console.log(JSON.stringify({ pages: Object.keys(pages), media: Object.keys(media).length, pending, warnings: [...new Set(warnings)] }, null, 2));
}

function script(ids) {
  const file = path.join(DIR, 'plan.json');
  if (!fs.existsSync(file)) throw new Error('Run `plan` first');
  const { pages } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!ids.length || ids[0] === 'all') ids = Object.keys(pages);
  for (const id of ids) if (!pages[id]) throw new Error(`"${id}" isn't in the plan — run \`plan\` again`);
  const state = readState();
  const missing = [];
  // Swap media keys for Figma image hashes
  const resolve = n => {
    if (Array.isArray(n)) return n.map(resolve);
    if (!n || typeof n !== 'object') return n;
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === 'img') { if (v && state.images[v]) out.h = state.images[v].hash; else if (v) missing.push(v); }
      else out[k] = resolve(v);
    }
    return out;
  };
  const PLAN = {
    pageId: FIGMA.pageId, bgFrom: FIGMA.bgFrom, section: FIGMA.section, sets: FIGMA.sets,
    frames: ids.map(id => ({ page: id, n: pages[id].name, d: 'V', width: FIGMA.width, c: resolve(pages[id].c) })),
  };
  const builder = fs.readFileSync(path.join(__dirname, 'figma', 'builder.js'), 'utf8').replace(/^\/\/.*\n/gm, '');
  const out = path.join(DIR, 'scripts', `${ids.length > 1 ? 'batch' : ids[0]}.js`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Drop empty fields and the default direction to keep the script small
  const lean = JSON.stringify(PLAN, (k, v) => (v == null || (k === 'd' && v === 'V') ? undefined : v));
  fs.writeFileSync(out, `const PLAN = ${lean};\n${builder}`);
  const chars = fs.statSync(out).size;
  if (chars > 50000) console.error(`warning: ${chars} chars — use_figma takes 50,000; script fewer pages at a time`);
  console.log(JSON.stringify({ script: path.relative(ROOT, out), pages: ids, chars, unuploaded: missing }, null, 2));
}

function record(json) {
  const r = JSON.parse(json);
  const state = readState();
  const now = new Date().toISOString();
  if (r.images) {
    const { media } = JSON.parse(fs.readFileSync(path.join(DIR, 'plan.json'), 'utf8'));
    for (const [key, hash] of Object.entries(r.images)) state.images[key] = { hash, source: media[key] || null, uploaded: now };
  }
  for (const p of r.results || (r.frame ? [r] : [])) {
    state.pages[p.page || p.frame.name] = { frame: p.frame.id, name: p.frame.name, pushed: now };
  }
  writeState(state);
  console.log(`recorded ${r.images ? Object.keys(r.images).length + ' image(s) ' : ''}${(r.results || (r.frame ? [r] : [])).map(p => p.frame.name).join(', ')}`);
}

// POST pending media to upload_assets URLs (in `plan` order) and record their hashes
async function upload(urls) {
  const list = JSON.parse(urls);
  const { pending } = JSON.parse(fs.readFileSync(path.join(DIR, 'pending.json'), 'utf8'));
  if (list.length > pending.length) throw new Error(`${list.length} URLs for ${pending.length} pending files`);
  const images = {};
  await Promise.all(list.map(async (url, i) => {
    const p = pending[i];
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': p.mime }, body: fs.readFileSync(p.file) });
    const body = await res.text();
    const hash = (body.match(/"imageHash"\s*:\s*"([0-9a-f]+)"/) || [])[1];
    if (!res.ok || !hash) throw new Error(`${p.source}: ${res.status} ${body.slice(0, 200)}`);
    images[p.key] = hash;
  }));
  record(JSON.stringify({ images }));
}

function status() {
  const s = readState();
  for (const [id, p] of Object.entries(s.pages)) console.log(`${id.padEnd(16)} ${p.name.padEnd(30)} ${p.frame.padEnd(12)} ${p.pushed}`);
  console.log(`${Object.keys(s.images).length} images in Figma`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'plan') plan(args);
  else if (cmd === 'script') script(args);
  else if (cmd === 'record') record(args[0]);
  else if (cmd === 'upload') upload(args[0]).catch(e => { console.error(e.message); process.exit(1); });
  else if (cmd === 'status') status();
  else console.log('usage: node tools/figma-sync.js plan [page…] | upload <urls> | script <page…|all> | record <json> | status');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
