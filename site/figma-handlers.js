// Phil Inge — Figma overrides for components with their own sync (library def
// `sync: "<kind>"`). Injected into the engine's builder by `sc figma script`;
// runs inside use_figma with the builder's helpers (setText, warnings) in scope.

// Colour Palette: the cards and swatches are nested instances (Colour Feature,
// Colour Swatch) whose text is component properties; chip colours are the hexes
async function setPalette(node, d) {
  for (const family of ['Instrument Serif', 'Geist', 'Geist Mono']) {
    try { await figma.loadFontAsync({ family, style: 'Regular' }); } catch (e) { warnings.push(`font ${family}`); }
  }
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 }; };
  const props = (inst, vals) => {
    const p = {};
    for (const [k, v] of Object.entries(inst.componentProperties)) { const b = k.split('#')[0]; if (v.type !== 'VARIANT' && vals[b] !== undefined) p[k] = vals[b]; }
    if (Object.keys(p).length) inst.setProperties(p);
  };
  const txt = async (root, name, s) => { if (s == null) return; const t = root.findOne(n => n.type === 'TEXT' && n.name === name); if (t) await setText(t, { s }); };
  const chips = (row, list) => {
    const items = row ? row.children.filter(n => n.type === 'INSTANCE') : [];
    if (list.length > items.length) warnings.push(`${node.name}: ${list.length} swatches, ${items.length} slots`);
    items.forEach((it, i) => {
      const s = list[i];
      it.visible = !!s;
      if (!s) return;
      props(it, { Name: s.name || '', Hex: s.hex || '', 'Show role': !!s.role, ...(s.role ? { Role: s.role } : {}) });
      const c = rgb(s.hex), sw = it.findOne(n => n.name === 'Swatch');
      if (c && sw) sw.fills = [{ type: 'SOLID', color: c }];
    });
  };
  await txt(node, 'Eyebrow', d.eyebrow);
  await txt(node, 'Footnote', d.footnote);
  const [dark, light] = node.findAll(n => n.type === 'INSTANCE' && n.name === 'Colour Feature');
  if (dark) {
    props(dark, { Title: d.darkTitle, Meta: d.darkMeta, Description: d.darkText });
    await txt(dark, 'Tokens label', d.tokensLabel);
    chips(dark.findOne(n => n.name === 'Token row'), d.tokens || []);
  }
  if (light) {
    props(light, { Title: d.lightTitle, Meta: d.lightMeta, Description: d.lightText });
    await txt(light, 'Ratio', d.ratio);
    await txt(light, 'Ratio label', d.ratioLabel);
  }
  chips(node.findOne(n => n.name === 'Scale'), d.scale || []);
}
HANDLERS.palette = setPalette;
