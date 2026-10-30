// Project header (Figma: Top / Portfolio → interaction annotation on Project Tile).
// The cover starts as a wide strip that fills the rest of the first screen, down
// to the page gutter (Padding/Section/Global) from the bottom edge. On the first
// scroll the header holds still while the cover grows to 16:9 — its bottom edge
// stays put, so it rises over the title and info block, which fade out. Once the
// cover is full size the page scrolls on as normal.
// Skipped for reduced motion, in the editor, and on narrow screens (the cover is
// 16:9 there already).
(function () {
  var section = document.querySelector('section[data-top="portfolio"]');
  if (!section || document.getElementById('sc-edit-data')) return;
  var inner = section.querySelector(':scope > .sc-container');
  var comp = section.querySelector('.sc-component');
  var media = comp && comp.querySelector(':scope > .sc-media');
  var info = media && media.previousElementSibling;
  if (!inner || !media || !info) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var narrow = window.matchMedia('(max-width: 900px)'); // matches the 16:9 cover rule in styles.css

  var run = null; // measurements for the current layout, or null when off

  function reset() {
    section.style.height = '';
    section.classList.remove('is-top-run', 'is-top-fill');
    inner.style.top = '';
    media.style.height = '';
    media.style.marginTop = '';
    info.style.opacity = '';
  }

  function measure() {
    reset();
    run = null;
    if (reduce.matches || narrow.matches) return;
    var m = media.getBoundingClientRect();
    var gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pad-section-global')) || 0;
    // Fill the rest of the first screen (never shorter than the designed strip)
    var startH = Math.max(m.height, window.innerHeight - (m.top + window.scrollY) - gutter);
    var endH = m.width * 9 / 16;
    section.classList.add('is-top-fill');
    media.style.height = startH + 'px';
    var grow = endH - startH;
    if (grow < 8) return; // already 16:9 or taller: just fill
    // The cover grows upward (height up, top up by the same amount), so the
    // header's height doesn't change while it's pinned
    var cs = getComputedStyle(section);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    run = { startH: startH, grow: grow };
    section.style.height = (padY + inner.offsetHeight + grow) + 'px';
    inner.style.top = (inner.getBoundingClientRect().top + window.scrollY) + 'px';
    section.classList.add('is-top-run');
    update();
  }

  function update() {
    if (!run) return;
    var p = Math.min(1, Math.max(0, window.scrollY / run.grow));
    media.style.height = (run.startH + run.grow * p) + 'px';
    media.style.marginTop = (-run.grow * p) + 'px';
    info.style.opacity = String(1 - p);
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking || !run) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; update(); });
  }, { passive: true });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 150);
  });
  reduce.addEventListener('change', measure);

  // Measure once the cover's frame has its final size
  if (document.readyState === 'complete') measure();
  else window.addEventListener('load', measure);
})();
