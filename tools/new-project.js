// Creates content/projects/<slug>.json from the template and rebuilds.
// Run: node tools/new-project.js "Project Name"

const fs = require('fs');
const path = require('path');
const { CONTENT } = require('./render');
const { build } = require('./build');

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('Usage: node tools/new-project.js "Project Name"');
  process.exit(1);
}

const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const file = path.join(CONTENT, 'projects', `${slug}.json`);
if (fs.existsSync(file)) {
  console.error(`content/projects/${slug}.json already exists.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path.join(CONTENT, 'projects', '_template.json'), 'utf8'));
data.title = title;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

const sitePath = path.join(CONTENT, 'site.json');
const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));
site.projectOrder = [...(site.projectOrder || []), slug];
fs.writeFileSync(sitePath, JSON.stringify(site, null, 2) + '\n');

build();
console.log(`Created content/projects/${slug}.json → projects/${slug}.html`);
