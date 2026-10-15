// Figma side of `node tools/figma-sync.js script <page>`: runs inside use_figma (Plugin API).
// PLAN is injected above this file by figma-sync.js. It rebuilds page frames inside the
// "Site — synced from code" section on the Design page, replacing the previous frame of the
// same name in place. Returns { results: [{ page, frame, slots, empty }], warnings }; `record`
// stores the frame ids. Pull needs no slot map: a Figma image hash is the SHA-1 of the file,
// so each layer can be compared with the local file directly.

const page = await figma.getNodeByIdAsync(PLAN.pageId);
await figma.setCurrentPageAsync(page);

const sets = {};
for (const [name, id] of Object.entries(PLAN.sets)) sets[name] = await figma.getNodeByIdAsync(id);
const vars = {};
for (const v of await figma.variables.getLocalVariablesAsync('FLOAT')) if (!vars[v.name]) vars[v.name] = v;

const warnings = [];
const PLAN_HASHES = new Set(JSON.stringify(PLAN).match(/"h":"[0-9a-f]{40}"/g)?.map(m => m.slice(5, -1)) || []);
const slots = {};
const AXIS = { w: 'layoutSizingHorizontal', h: 'layoutSizingVertical' };

function variantOf(name, props) {
  const set = sets[name];
  if (!set) return null;
  if (set.type === 'COMPONENT') return set;
  const want = Object.entries(props || {});
  return set.children.find(c => want.every(([k, v]) => c.variantProperties && c.variantProperties[k] === v)) || set.defaultVariant;
}

// A number, or { v: 'Figma/Variable/Name', px } — bound to the variable when it exists
function setNum(node, field, val) {
  if (val == null) return;
  if (typeof val === 'number') { node[field] = val; return; }
  node[field] = val.px;
  const v = vars[val.v];
  if (v) node.setBoundVariable(field, v);
  else warnings.push(`no variable ${val.v}`);
}

function isAuto(n) { return n && 'layoutMode' in n && n.layoutMode !== 'NONE'; }

function size(node, p, parent) {
  for (const dim of ['w', 'h']) {
    const s = p[dim];
    if (s && typeof s === 'object') {
      node.resize(dim === 'w' ? s.px : node.width, dim === 'h' ? s.px : node.height);
      if (vars[s.v]) node.setBoundVariable(dim === 'w' ? 'width' : 'height', vars[s.v]);
      if (isAuto(parent)) node[AXIS[dim]] = 'FIXED';
    } else if (typeof s === 'number') {
      node.resize(dim === 'w' ? s : node.width, dim === 'h' ? s : node.height);
      if (isAuto(parent)) node[AXIS[dim]] = 'FIXED';
    } else if (s === 'fill' && isAuto(parent)) node[AXIS[dim]] = 'FILL';
    else if (s === 'hug' && isAuto(node)) node[AXIS[dim]] = 'HUG';
  }
  if (p.max) setNum(node, 'maxWidth', p.max);
}

function frame(p) {
  const f = figma.createFrame();
  f.name = p.n;
  f.layoutMode = p.d === 'H' ? 'HORIZONTAL' : 'VERTICAL';
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.fills = [];
  f.clipsContent = false;
  setNum(f, 'itemSpacing', p.gap);
  if (p.wrap) { f.layoutWrap = 'WRAP'; setNum(f, 'counterAxisSpacing', p.gap); }
  if (p.pad) [['t', 'paddingTop'], ['r', 'paddingRight'], ['b', 'paddingBottom'], ['l', 'paddingLeft']]
    .forEach(([k, field]) => setNum(f, field, p.pad[k]));
  f.primaryAxisAlignItems = p.jc || 'MIN';
  f.counterAxisAlignItems = p.ai || 'MIN';
  return f;
}

function findLayer(root, names) {
  for (const nm of [].concat(names)) {
    if (nm == null) return root;
    if (root.name === nm && root.type !== 'FRAME') return root;
    const hit = root.findOne(n => n.name === nm);
    if (hit) return hit;
  }
  return null;
}

const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
async function setText(layer, o) {
  const t = layer.type === 'TEXT' ? layer : layer.findOne(n => n.type === 'TEXT');
  if (!t) return null;
  const s = o.u && t.textCase !== 'UPPER' ? o.s.toUpperCase() : o.s;
  // Leave the designer's typesetting alone when only case/spacing differ
  if (norm(t.characters) !== norm(s)) {
    const fonts = t.characters.length ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
    for (const f of fonts) await figma.loadFontAsync(f);
    t.characters = s;
  }
  return t;
}

async function setTags(layer, o) {
  let list = layer.children.filter(c => c.type === 'INSTANCE');
  if (!list.length) return;
  while (list.length < o.tags.length) {
    try { layer.appendChild(list[0].clone()); } catch (e) { warnings.push(`only ${list.length} tags fit in ${layer.name}`); break; }
    list = layer.children.filter(c => c.type === 'INSTANCE');
  }
  for (const [i, tg] of list.entries()) {
    const t = o.tags[i];
    tg.visible = !!t;
    if (!t) continue;
    try { tg.setProperties({ Color: t.c }); } catch (e) { warnings.push(`tag colour ${t.c}`); }
    await setText(tg, { s: t.s });
    if (o.p) slots[`${o.p}.${i}.label`] = { id: tg.id, text: t.s };
  }
}

function setMedia(layer, o) {
  const target = layer.findOne ? (layer.findOne(n => n.name === 'Image') || layer) : layer;
  if (o.h) target.fills = [{ type: 'IMAGE', imageHash: o.h, scaleMode: 'FILL' }];
  const f = target.fills;
  const paint = f !== figma.mixed && f.find(x => x.type === 'IMAGE');
  slots[o.p] = { id: target.id, hash: paint ? paint.imageHash : null, media: true };
}

async function override(node, o) {
  const layer = findLayer(node, o.l);
  if (!layer) { if (o.k !== 'hide') warnings.push(`${node.name}: no layer ${[].concat(o.l).join(' | ')}`); return; }
  if (o.k === 'hide') layer.visible = false;
  else if (o.k === 'text') { const t = await setText(layer, o); if (t && o.p) slots[o.p] = { id: t.id, text: o.s }; }
  else if (o.k === 'tags') await setTags(layer, o);
  else if (o.k === 'media') setMedia(layer, o);
}

let count = 0;
async function build(p, parent) {
  let node;
  if (p.t === 'I') {
    const comp = variantOf(p.set, p.v);
    if (!comp) { warnings.push(`missing component ${p.set}`); node = frame({ n: `${p.set} (missing)` }); }
    else node = comp.createInstance();
    if (p.n) node.name = p.n;
  } else node = frame(p);
  parent.appendChild(node);
  count++;
  size(node, p, parent);
  for (const c of p.c || []) await build(c, node);
  for (const o of p.o || []) await override(node, o);
  return node;
}

// ---- place each frame: replace the frame of the same name inside the sync section
let section = page.children.find(n => n.type === 'SECTION' && n.name === PLAN.section);
if (!section) {
  const bottom = Math.max(...page.children.map(n => n.y + n.height));
  section = figma.createSection();
  section.name = PLAN.section;
  section.x = 237;
  section.y = Math.round(bottom + 2000);
  section.resizeWithoutConstraints(2128, 2000);
}
const bg = PLAN.bgFrom && await figma.getNodeByIdAsync(PLAN.bgFrom);
const cols = await figma.variables.getLocalVariableCollectionsAsync();

const results = [];
for (const spec of PLAN.frames) {
  for (const k of Object.keys(slots)) delete slots[k];
  const old = section.children.find(n => n.name === spec.n);
  let x = 200, y = 200;
  if (old) { x = old.x; y = old.y; old.remove(); }
  else if (section.children.length) x = Math.max(...section.children.map(n => n.x + n.width)) + 200;

  const root = frame({ ...spec, c: [] });
  section.appendChild(root);
  root.x = x; root.y = y;
  root.counterAxisSizingMode = 'FIXED';
  root.resize(spec.width, 100);
  root.primaryAxisSizingMode = 'AUTO';
  root.clipsContent = true;
  if (bg) {
    root.fills = bg.fills;
    for (const [colId, modeId] of Object.entries(bg.explicitVariableModes || {})) {
      const col = cols.find(c => c.id === colId);
      if (col) root.setExplicitVariableModeForCollection(col, modeId);
    }
  }
  for (const c of spec.c) await build(c, root);
  results.push({ page: spec.page, frame: { id: root.id, name: root.name, h: Math.round(root.height) }, slots: Object.keys(slots).length, empty: Object.values(slots).filter(x => x.media && !PLAN_HASHES.has(x.hash)).length });
}

const right = Math.max(...section.children.map(n => n.x + n.width)) + 200;
const bottom = Math.max(...section.children.map(n => n.y + n.height)) + 200;
section.resizeWithoutConstraints(Math.max(section.width, right), Math.max(section.height, bottom));

return { section: section.id, nodes: count, results, warnings: [...new Set(warnings)] };
