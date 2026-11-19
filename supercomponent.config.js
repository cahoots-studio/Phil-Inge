// Phil Inge — Supercomponent project settings. The engine reads this file;
// commands run from this folder (npm run build / edit / tokens / figma).

module.exports = {
  name: 'Phil Inge',
  site: './site',                   // page templates: routes(), layout(), figma pages
  library: 'library',               // this site's own components (Top, Gallery, Portfolio…)
  placeholder: 'assets/placeholder.jpg',

  // Tag colours: Figma variant → CSS modifier (tag--orange…). This site's own five.
  tags: {
    colors: { Orange: 'orange', Purple: 'violet', Yellow: 'yellow', Pink: 'pink', Green: 'green' },
    fallback: 'orange',
  },

  // Media slots that are fields of a page's document (a project's cover image)
  mediaFields: ['cover'],

  // What the editor's Publish button commits, besides the built pages
  publish: ['content', 'assets'],

  // Figma project file (Supercomponent — PI-IV): where `npm run figma` builds page frames
  figma: {
    fileKey: 'lku8ICcBCPYcllZIIjVi3u',
    pageId: '2001:448',              // Design
    bgFrom: '2001:449',              // Home frame: page fill + variable modes to copy
    section: 'Site — synced from code',
    width: 1728,
    sets: {
      Top: '2057:3995', Gallery: '2103:496', Media: '443:446', Headline: '443:369', Text: '443:382',
      Tag: '2021:748', Footer: '452:196', Navigation: '455:318', 'Project Tile': '2024:829',
      // Portfolio specialty components (Style Guide → Portfolio)
      'Exploded View': '2344:575',
      'Colour Palette': '2349:562',
    },
    css: ['css/styles.css'],         // where the $token aliases are defined
    handlers: 'site/figma-handlers.js',
  },
};
