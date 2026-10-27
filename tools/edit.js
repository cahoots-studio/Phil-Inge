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
const { ROOT, CONTENT, CONTROLS, loadLibrary, loadPresets, findVariant, slotCount,
  renderHome, renderProjects, renderProject, renderStyleguide } = require('./render');
const { build } = require('./build');

const PORT = Number(process.env.PORT) || 4000;
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024; // 2 GB — phone videos are big; output is much smaller
const MAX_VIDEO_OUT = 95 * 1024 * 1024;   // GitHub rejects files over 100 MB
const MAX_EDGE = 2400;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
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

function readToFile(req, dest, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(dest);
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.destroy(); out.destroy(); reject(new Error('Upload too large (2 GB max)')); }
    });
    req.pipe(out);
    out.on('finish', () => resolve(size));
    out.on('error', reject);
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

// Only real media slots: the project cover, or <instance>.content.media.<n>
// where n is a slot in the instance's current variant. → { list, key, slotName }
function resolveMediaSlot(data, keys) {
  if (keys.length === 1 && keys[0] === 'cover') return { list: data, key: 'cover', slotName: 'cover' };
  const n = keys[keys.length - 1];
  if (keys.length < 4 || keys.at(-3) !== 'content' || keys.at(-2) !== 'media' || !/^\d+$/.test(n)) throw new Error('Not a media slot');
  const instance = walkKeys(data, keys.slice(0, -3));
  const def = instance && instance.type === 'instance' && loadLibrary()[instance.component];
  if (!def || Number(n) >= slotCount(findVariant(def, instance.variant).tree)) throw new Error('Not a media slot');
  instance.content = instance.content || {};
  instance.content.media = instance.content.media || [];
  return { list: instance.content.media, key: Number(n), slotName: `s${Number(keys[1]) + 1}-${Number(n) + 1}` };
}

async function saveMedia(req, url) {
  const { doc, file, keys } = parseTarget(url.searchParams.get('target'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { list, key, slotName } = resolveMediaSlot(data, keys);

  // What was uploaded: content type, with the file name as a fallback
  const type = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
  const origName = decodeURIComponent(req.headers['x-filename'] || '');
  const ext = path.extname(origName).toLowerCase();
  const VIDEO_EXT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.3gp', '.ogv'];
  const kind = type.startsWith('video/') || VIDEO_EXT.includes(ext) ? 'video'
    : type.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.svg'].includes(ext) ? 'image'
    : null;
  if (!kind) throw new Error(`Unsupported file: ${origName || type || 'unknown type'}`);

  const tmp = path.join(os.tmpdir(), `sc-upload-${Date.now()}${ext || ''}`);
  await readToFile(req, tmp, MAX_UPLOAD);

  const slug = doc.replace(/^projects\//, '');
  const stamp = Date.now().toString(36);
  const relDir = `assets/uploads/${slug}`;
  fs.mkdirSync(path.join(ROOT, relDir), { recursive: true });
  const abs = rel => path.join(ROOT, rel);
  let item;

  try {
    const isGif = type === 'image/gif' || ext === '.gif';
    const animatedGif = isGif && await frameCount(tmp) > 1;

    if (kind === 'video' || animatedGif) {
      // Any video (and animated GIFs) → MP4 / H.264, long edge ≤ 1920, streams
      // before it's fully loaded (+faststart), plus a poster frame.
      const src = `${relDir}/${slotName}-${stamp}.mp4`;
      const poster = `${relDir}/${slotName}-${stamp}-poster.jpg`;
      const fit = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'";
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `${fit},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-profile:v', 'high',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', abs(src)]);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', abs(src), '-frames:v', '1', '-q:v', '3', abs(poster)]);
      const size = fs.statSync(abs(src)).size;
      if (size > MAX_VIDEO_OUT) {
        fs.rmSync(abs(src), { force: true }); fs.rmSync(abs(poster), { force: true });
        throw new Error(`Video is ${Math.round(size / 1048576)} MB after converting — over GitHub's 100 MB limit. Trim it or upload a shorter clip.`);
      }
      item = { type: 'video', src, poster };
    } else if (['.webp', '.avif', '.svg'].includes(ext) || ['image/webp', 'image/avif', 'image/svg+xml'].includes(type) || isGif) {
      // Already web formats: keep exactly as uploaded
      const keepExt = ext || { 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/gif': '.gif' }[type];
      const src = `${relDir}/${slotName}-${stamp}${keepExt}`;
      fs.copyFileSync(tmp, abs(src));
      item = { src };
    } else {
      // JPEG / HEIC / TIFF / BMP → JPEG, PNG stays PNG; long edge ≤ 2400, never upscaled
      const outExt = type === 'image/png' || ext === '.png' ? '.png' : '.jpg';
      const src = `${relDir}/${slotName}-${stamp}${outExt}`;
      const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', tmp]);
      const dims = [...stdout.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map(m => Number(m[1]));
      const args = ['-s', 'format', outExt === '.png' ? 'png' : 'jpeg'];
      if (outExt === '.jpg') args.push('-s', 'formatOptions', '82');
      if (Math.max(...dims) > MAX_EDGE) args.push('-Z', String(MAX_EDGE));
      await run('sips', [...args, tmp, '--out', abs(src)]);
      item = { src };
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  const prev = list[key] || {};
  if (Array.isArray(list)) while (list.length < key) list.push(null);
  list[key] = { ...item, alt: prev.alt || '' };
  writeJSON(file, data);
  cleanupUploads([prev.src, prev.poster]);
  build();
  return list[key];
}

// Poster for a video slot: a frame at ?t=<seconds>, or an uploaded image.
async function savePoster(req, url) {
  const { doc, file, keys } = parseTarget(url.searchParams.get('target'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { list, key, slotName } = resolveMediaSlot(data, keys);
  const item = list[key];
  if (!item || item.type !== 'video') throw new Error('Not a video slot');

  const slug = doc.replace(/^projects\//, '');
  const poster = `assets/uploads/${slug}/${slotName}-${Date.now().toString(36)}-poster.jpg`;
  const out = path.join(ROOT, poster);
  const type = (req.headers['content-type'] || '').split(';')[0].toLowerCase();

  if (type.startsWith('image/')) {
    // Custom poster image → JPEG at the video's size, cropped to fill
    const tmp = path.join(os.tmpdir(), `sc-poster-${Date.now()}`);
    await readToFile(req, tmp, 50 * 1024 * 1024);
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(ROOT, item.src)]);
      const [w, h] = stdout.trim().split(',').map(Number);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp,
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
        '-frames:v', '1', '-q:v', '3', out]);
    } finally { fs.rmSync(tmp, { force: true }); }
  } else {
    // A frame from the video itself
    const t = Math.max(0, Number(url.searchParams.get('t')) || 0);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', path.join(ROOT, item.src),
      '-frames:v', '1', '-q:v', '3', out]);
    if (!fs.existsSync(out)) throw new Error('Couldn’t grab a frame at that time');
  }

  const prev = item.poster;
  item.poster = poster;
  writeJSON(file, data);
  cleanupUploads([prev]);
  build();
  return { poster };
}

// Frames in a GIF (1 = still image)
async function frameCount(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
      '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]);
    return Number(stdout.trim()) || 1;
  } catch { return 1; }
}

// Structure edits on a project's page tree. `path` is a node path like
// "sections.2.children.0.children.1" (as tagged by the renderer in edit mode).
//   add-section   { index }                         blank Section + Container
//   add-component { path: container|column, index, component, variant }
//   add-column    { path: container|column, index } or { path, side: start|end }
//   delete | duplicate { path }    move { path, dir: -1|1 }    variant { path, variant }
//   settings      { path, key, value }               a control from CONTROLS (render.js)
async function saveNode(req) {
  const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
  if (!/^projects\/[a-z0-9-]+$/.test(body.doc || '')) throw new Error('Structure edits are on project pages');
  const { file } = parseTarget(`${body.doc}#sections`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.sections = data.sections || [];
  const lib = loadLibrary();
  const { section: sectionPreset, container: containerPreset } = loadPresets();
  let removed = [];

  const keysOf = p => {
    const keys = String(p || '').split('.');
    if (keys[0] !== 'sections' || keys.some(k => !/^(sections|children|\d+)$/.test(k))) throw new Error('Bad path');
    return keys;
  };
  const nodeAt = p => walkKeys(data, keysOf(p));
  const parentOf = p => {
    const keys = keysOf(p);
    const list = walkKeys(data, keys.slice(0, -1));
    const i = Number(keys.at(-1));
    if (!Array.isArray(list) || !(i in list)) throw new Error('Path not found');
    return { list, i };
  };
  const variantFor = (def, variant) => {
    const out = {};
    for (const [prop, values] of Object.entries(def.props || {})) {
      const v = variant && variant[prop];
      if (v !== undefined && !values.includes(v)) throw new Error(`"${v}" isn’t a ${def.name} ${prop}`);
      out[prop] = v === undefined ? values[0] : v;
    }
    return out;
  };
  const isHolder = n => n && (n.type === 'container' || n.type === 'column');
  const hasColumns = n => (n.children || []).some(c => c.type === 'column');
  const newColumn = children => ({ type: 'column', width: 'fill', gap: '$gap-large', children: children || [] });
  const clampIndex = (i, len) => { const n = Number(i); if (!Number.isInteger(n) || n < 0 || n > len) throw new Error('Bad position'); return n; };

  switch (body.action) {
    case 'add-section': {
      const at = clampIndex(body.index, data.sections.length);
      data.sections.splice(at, 0, { ...sectionPreset, children: [{ ...containerPreset, children: [] }] });
      break;
    }
    case 'add-component': {
      const holder = nodeAt(body.path);
      if (!isHolder(holder)) throw new Error('Components go in a container or column');
      if (hasColumns(holder)) throw new Error('This container has columns — add the component inside a column');
      const def = lib[body.component];
      if (!def) throw new Error('Unknown component');
      holder.children = holder.children || [];
      const at = clampIndex(body.index, holder.children.length);
      holder.children.splice(at, 0, { type: 'instance', component: def.name, variant: variantFor(def, body.variant), content: { media: [] } });
      break;
    }
    case 'add-column': {
      const holder = nodeAt(body.path);
      if (!isHolder(holder)) throw new Error('Columns go in a container or column');
      holder.children = holder.children || [];
      if (hasColumns(holder)) {
        holder.children.splice(clampIndex(body.index, holder.children.length), 0, newColumn());
      } else {
        // Turn a stack into two columns: what's there now + an empty one
        const existing = newColumn(holder.children);
        holder.children = body.side === 'start' ? [newColumn(), existing] : [existing, newColumn()];
        holder.direction = 'row';
        holder.gap = holder.gap || '$gap-large';
        holder.mobile = 'cols';
      }
      break;
    }
    case 'delete': {
      const { list, i } = parentOf(body.path);
      removed = collectSrcs(list.splice(i, 1)[0]);
      // A row left with a single column goes back to a plain stack
      const parentKeys = keysOf(body.path).slice(0, -2);
      if (parentKeys.length > 1) {
        const parent = walkKeys(data, parentKeys);
        if (isHolder(parent) && hasColumns(parent) && parent.children.length === 1) {
          parent.children = parent.children[0].children || [];
          delete parent.direction; delete parent.mobile;
          if (parent.gap === '$gap-large' && parent.type === 'container') delete parent.gap;
        }
      }
      break;
    }
    case 'duplicate': {
      const { list, i } = parentOf(body.path);
      list.splice(i + 1, 0, structuredClone(list[i]));
      break;
    }
    case 'move': {
      const { list, i } = parentOf(body.path);
      const to = i + (Number(body.dir) < 0 ? -1 : 1);
      if (to < 0 || to >= list.length) throw new Error('Can’t move further');
      [list[i], list[to]] = [list[to], list[i]];
      break;
    }
    case 'settings': {
      // One control from the settings panel; only values listed in CONTROLS
      const node = nodeAt(body.path);
      const control = node && (CONTROLS[node.type] || []).find(c => c.key === body.key);
      if (!control) throw new Error('Not a setting here');
      const value = body.value === undefined ? null : body.value;
      if (!control.options.some(o => o.value === value)) throw new Error(`“${value}” isn’t a ${control.label} option`);
      const keys = control.key.split('.');
      const holder = keys.slice(0, -1).reduce((o, k) => (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}), node);
      if (value === null) delete holder[keys.at(-1)]; else holder[keys.at(-1)] = value;
      break;
    }
    case 'variant': {
      const node = nodeAt(body.path);
      const def = node && node.type === 'instance' && lib[node.component];
      if (!def) throw new Error('Not a component');
      // Content is kept, so media beyond the new layout's slots come back later
      node.variant = variantFor(def, { ...node.variant, ...body.variant });
      break;
    }
    default:
      throw new Error('Unknown action');
  }

  writeJSON(file, data);
  cleanupUploads(removed);
  build();
  return { ok: true };
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

function serveStatic(pathname, res, range) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || rel.split('/').some(s => s.startsWith('.'))) return send(res, 403, 'Forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Byte ranges: Safari won't play video without them
    const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
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
      if (url.pathname === '/__api/poster') return send(res, 200, await savePoster(req, url));
      if (url.pathname === '/__api/node') return send(res, 200, await saveNode(req));
      if (url.pathname === '/__api/publish') return send(res, 200, await publish());
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    const page = renderRoute(url.pathname);
    if (page === 'redirect') { res.writeHead(301, { Location: '/projects/' }); return res.end(); }
    if (page === null) return send(res, 404, 'No such project', 'text/plain');
    if (page) return send(res, 200, page, MIME['.html']);
    return serveStatic(url.pathname, res, req.headers.range);
  } catch (err) {
    console.error(err.stderr || err.message);
    return send(res, 400, { error: (err.stderr || err.message || 'Error').toString().trim() });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  build();
  console.log(`Edit mode → http://localhost:${PORT}\nCtrl+C to stop.`);
});
