// Phil Inge — the site's data: content/site.json and the projects, in site order.

const fs = require('fs');
const path = require('path');
const { config } = require('supercomponent/engine');
const CONTENT = config.content;

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadSite() {
  const site = readJSON(path.join(CONTENT, 'site.json'));
  const dir = path.join(CONTENT, 'projects');
  const slugs = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => f.replace(/\.json$/, ''));
  const order = site.projectOrder || [];
  slugs.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const projects = slugs.map(slug => ({ slug, ...readJSON(path.join(dir, slug + '.json')) }));
  return { site, projects };
}

module.exports = { loadSite };
