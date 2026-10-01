// Writes the static site from /content:
//   index.html, projects/index.html, projects/<slug>.html
// Run: node tools/build.js
// Project pages that were generated earlier but no longer have a content file
// are removed (only files carrying the generator marker are ever deleted).

const fs = require('fs');
const path = require('path');
const { ROOT, MARKER, loadSite, renderHome, renderProjects, renderProject } = require('./render');

function write(rel, html) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === html) return false;
  fs.writeFileSync(file, html);
  return true;
}

function build() {
  const { projects } = loadSite();
  const changed = [];
  const out = [
    ['index.html', renderHome()],
    ['projects/index.html', renderProjects()],
    ...projects.map(p => [`projects/${p.slug}.html`, renderProject(p.slug)]),
  ];
  for (const [rel, html] of out) if (write(rel, html)) changed.push(rel);

  // Remove stale generated project pages
  const keep = new Set(projects.map(p => `${p.slug}.html`).concat('index.html'));
  const dir = path.join(ROOT, 'projects');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.html') || keep.has(f)) continue;
    const file = path.join(dir, f);
    if (fs.readFileSync(file, 'utf8').includes(MARKER)) {
      fs.unlinkSync(file);
      changed.push(`projects/${f} (removed)`);
    }
  }
  return changed;
}

module.exports = { build };

if (require.main === module) {
  const changed = build();
  console.log(changed.length ? `Built:\n  ${changed.join('\n  ')}` : 'Nothing changed.');
}
