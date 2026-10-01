// Local edit mode. Run: node tools/edit.js  →  http://localhost:4000
// Pages render from /content with edit hooks; text and image changes are saved
// straight to the JSON, and the static HTML is rebuilt after every change.
// "Publish" commits the result and pushes it (which deploys philinge.com).
// Only listens on 127.0.0.1. Image processing uses macOS `sips`.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { ROOT, CONTENT, loadLibrary, findVariant, slotCount, newSection, findInstance,
  renderHome, renderProjects, renderProject, renderStyleguide } = require('./render');
const { build } = require('./build');

const PORT = Number(process.env.PORT) || 4000;
const MAX_UPLOAD = 60 * 1024 * 1024;
const MAX_EDGE = 2400;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- helpers

const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
    err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Upload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// "projects/huck-black-box#sections.2.media.1" → { file, keys }
function parseTarget(target) {
  const m = /^(site|projects\/[a-z0-9-]+)#([A-Za-z0-9_.]+)$/.exec(target || '');
  if (!m) throw new Error('Bad target');
  const file = path.join(CONTENT, m[1] + '.json');
  if (!fs.existsSync(file)) throw new Error('Unknown document');
  const keys = m[2].split('.');
  if (keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) throw new Error('Bad path');
  return { doc: m[1], file, keys };
}

function resolveParent(data, keys) {
  let node = data;
  for (const k of keys.slice(0, -1)) {
    if (node == null || typeof node !== 'object' || !(k in node)) throw new Error('Path not found');
    node = node[k];
  }
  return [node, keys[keys.length - 1]];
}

function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// Text fields a component variant exposes (blocks with a `field`, except media)
function componentFields(tree) {
  const out = new Set();
  (function walk(n) {
    if (n.field && n.type !== 'media') out.add(n.field);
    (n.children || []).forEach(walk);
  })(tree);
  return out;
}

function walkKeys(data, keys) {
  let node = data;
  for (const k of keys) {
    if (node == null || typeof node !== 'object' || !(k in node)) throw new Error('Path not found');
    node = node[k];
  }
  return node;
}

// Delete uploads that no content file references any more
function cleanupUploads(srcs) {
  const text = allContentText();
  for (const src of srcs) {
    if (src && src.startsWith('assets/uploads/') && !text.includes(`"${src}"`)) {
      fs.rmSync(path.join(ROOT, src), { force: true });
    }
  }
}

function collectSrcs(node, out = []) {
  if (node && typeof node === 'object') {
    if (typeof node.src === 'string') out.push(node.src);
    Object.values(node).forEach(v => collectSrcs(v, out));
  }
  return out;
}

function allContentText() {
  const files = [path.join(CONTENT, 'site.json'),
    ...fs.readdirSync(path.join(CONTENT, 'projects')).map(f => path.join(CONTENT, 'projects', f))];
  return files.filter(f => f.endsWith('.json')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
}

// ---------------------------------------------------------------- API

async function saveText(req) {
  const { target, value } = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
  const { file, keys } = parseTarget(target);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const clean = String(value).replace(/\s+/g, ' ').trim();
  let parent, key;
  const ci = keys.lastIndexOf('content');
  if (ci > 0 && keys.length === ci + 2) {
    // <instance>.content.<field>: the field must be a text block in the component
    const instance = walkKeys(data, keys.slice(0, ci));
    const def = instance && instance.type === 'instance' && loadLibrary()[instance.component];
    if (!def || !componentFields(findVariant(def, instance.variant).tree).has(keys[ci + 1])) throw new Error('Not a text field');
    instance.content = instance.content || {};
    parent = instance.content; key = keys[ci + 1];
  } else {
    // Anything else: only existing text values can be changed
    [parent, key] = resolveParent(data, keys);
    if (typeof parent[key] !== 'string') throw new Error('Not a text field');
  }
  parent[key] = clean;
  writeJSON(file, data);
  build();
  return { value: parent[key] };
}

async function saveMedia(req, url) {
  const { doc, file, keys } = parseTarget(url.searchParams.get('target'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Only real image slots: the project cover, or <instance>.content.media.<n>
  // where n is a slot in the instance's current variant.
  let list, key, slotName;
  if (keys.length === 1 && keys[0] === 'cover') {
    list = data; key = 'cover'; slotName = 'cover';
  } else {
    const n = keys[keys.length - 1];
    if (keys.length < 4 || keys.at(-3) !== 'content' || keys.at(-2) !== 'media' || !/^\d+$/.test(n)) throw new Error('Not an image slot');
    const instance = walkKeys(data, keys.slice(0, -3));
    const def = instance && instance.type === 'instance' && loadLibrary()[instance.component];
    if (!def || Number(n) >= slotCount(findVariant(def, instance.variant).tree)) throw new Error('Not an image slot');
    instance.content = instance.content || {};
    instance.content.media = instance.content.media || [];
    list = instance.content.media; key = Number(n);
    slotName = `s${Number(keys[1]) + 1}-${key + 1}`;
  }

  const type = (req.headers['content-type'] || '').split(';')[0];
  const inExt = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif', 'image/tiff': '.tiff' }[type];
  if (!inExt) throw new Error(`Unsupported image type: ${type || 'unknown'}`);

  const body = await readBody(req, MAX_UPLOAD);
  const tmp = path.join(os.tmpdir(), `sc-upload-${Date.now()}${inExt}`);
  fs.writeFileSync(tmp, body);

  const outExt = inExt === '.png' ? '.png' : '.jpg';
  const slug = doc.replace(/^projects\//, '');
  const name = `${slotName}-${Date.now().toString(36)}${outExt}`;
  const relDir = `assets/uploads/${slug}`;
  fs.mkdirSync(path.join(ROOT, relDir), { recursive: true });
  const dest = path.join(ROOT, relDir, name);

  try {
    const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', tmp]);
    const dims = [...stdout.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map(m => Number(m[1]));
    const args = ['-s', 'format', outExt === '.png' ? 'png' : 'jpeg'];
    if (outExt === '.jpg') args.push('-s', 'formatOptions', '82');
    if (Math.max(...dims) > MAX_EDGE) args.push('-Z', String(MAX_EDGE)); // never upscale
    await run('sips', [...args, tmp, '--out', dest]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  const prev = list[key] && list[key].src;
  const src = `${relDir}/${name}`;
  if (Array.isArray(list)) while (list.length < key) list.push(null);
  list[key] = { src, alt: (list[key] && list[key].alt) || '' };
  writeJSON(file, data);
  cleanupUploads([prev]);
  build();
  return { src };
}

// Section controls: add / move / duplicate / delete / variant
async function saveSection(req) {
  const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
  const { file } = parseTarget(`${body.doc}#sections`);
  if (!/^projects\//.test(body.doc)) throw new Error('Sections live on project pages');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sections = data.sections = data.sections || [];
  const i = Number(body.index);
  const lib = loadLibrary();
  const validVariant = (def, variant) => {
    const out = {};
    for (const [prop, values] of Object.entries(def.props || {})) {
      const v = variant && variant[prop];
      if (v !== undefined && !values.includes(v)) throw new Error(`"${v}" isn’t a ${def.name} ${prop}`);
      out[prop] = v === undefined ? values[0] : v;
    }
    return out;
  };
  const inRange = (n, max) => Number.isInteger(n) && n >= 0 && n < max;
  let removed = [];

  switch (body.action) {
    case 'add': {
      if (!Number.isInteger(i) || i < 0 || i > sections.length) throw new Error('Bad position');
      const def = lib[body.component];
      if (!def) throw new Error('Unknown component');
      sections.splice(i, 0, newSection(def.name, validVariant(def, body.variant)));
      break;
    }
    case 'move': {
      const to = i + (body.dir < 0 ? -1 : 1);
      if (!inRange(i, sections.length) || !inRange(to, sections.length)) throw new Error('Can’t move further');
      [sections[i], sections[to]] = [sections[to], sections[i]];
      break;
    }
    case 'duplicate':
      if (!inRange(i, sections.length)) throw new Error('Bad section');
      sections.splice(i + 1, 0, structuredClone(sections[i]));
      break;
    case 'delete':
      if (!inRange(i, sections.length)) throw new Error('Bad section');
      removed = collectSrcs(sections.splice(i, 1)[0]);
      break;
    case 'variant': {
      if (!inRange(i, sections.length)) throw new Error('Bad section');
      const hit = findInstance(sections[i]);
      const def = hit && lib[hit.node.component];
      if (!def) throw new Error('No component in this section');
      // Content is kept as-is, so images beyond the new layout's slots come back
      // if you switch back to a bigger layout.
      hit.node.variant = validVariant(def, { ...hit.node.variant, ...body.variant });
      break;
    }
    default:
      throw new Error('Unknown action');
  }

  writeJSON(file, data);
  cleanupUploads(removed);
  build();
  return { ok: true, count: sections.length };
}

async function publish() {
  build();
  await run('git', ['add', '--', 'content', 'assets', 'index.html', 'projects']);
  const { stdout: staged } = await run('git', ['diff', '--cached', '--name-only']);
  if (!staged.trim()) return { message: 'Nothing new to publish.' };
  const files = staged.trim().split('\n');
  await run('git', ['commit', '-m', `Publish content (${files.length} file${files.length > 1 ? 's' : ''})`]);
  const { stdout, stderr } = await run('git', ['push', 'origin', 'HEAD']);
  return { message: `Published ${files.length} file${files.length > 1 ? 's' : ''}.`, log: (stdout + stderr).trim() };
}

// ---------------------------------------------------------------- server

function renderRoute(pathname) {
  if (pathname === '/' || pathname === '/index.html') return renderHome({ edit: true });
  if (pathname === '/projects/' || pathname === '/projects/index.html') return renderProjects({ edit: true });
  if (pathname === '/projects') return 'redirect';
  if (pathname === '/__styleguide') return renderStyleguide().replace(/(href|src)="(?!https?:|\/|#)/g, '$1="/');
  const m = /^\/projects\/([a-z0-9-]+)\.html$/.exec(pathname);
  if (m) return renderProject(m[1], { edit: true });
  return undefined;
}

function serveStatic(pathname, res) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || rel.split('/').some(s => s.startsWith('.'))) return send(res, 403, 'Forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST') {
      // Reject cross-site requests: only this page may call the API
      const origin = req.headers.origin;
      if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) {
        return send(res, 403, { error: 'Forbidden' });
      }
      if (url.pathname === '/__api/text') return send(res, 200, await saveText(req));
      if (url.pathname === '/__api/media') return send(res, 200, await saveMedia(req, url));
      if (url.pathname === '/__api/section') return send(res, 200, await saveSection(req));
      if (url.pathname === '/__api/publish') return send(res, 200, await publish());
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    const page = renderRoute(url.pathname);
    if (page === 'redirect') { res.writeHead(301, { Location: '/projects/' }); return res.end(); }
    if (page === null) return send(res, 404, 'No such project', 'text/plain');
    if (page) return send(res, 200, page, MIME['.html']);
    return serveStatic(url.pathname, res);
  } catch (err) {
    console.error(err.stderr || err.message);
    return send(res, 400, { error: (err.stderr || err.message || 'Error').toString().trim() });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  build();
  console.log(`Edit mode → http://localhost:${PORT}\nCtrl+C to stop.`);
});
