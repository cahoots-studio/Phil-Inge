// Project header (Figma: Top / Portfolio → interaction annotation on Project Tile).
// On the first scroll the header holds still while the cover grows from its wide
// strip to 16:9 and slides up over the title and info block, which fade out.
// Once the cover is full height the page scrolls on as normal.
// Skipped for reduced motion, in the editor, and where the cover is already
// 16:9 (narrow screens).
(function () {
  var section = document.querySelector('section[data-top="portfolio"]');
  if (!section || document.getElementById('sc-edit-data')) return;
  var inner = section.querySelector(':scope > .sc-container');
  var comp = section.querySelector('.sc-component');
  var media = comp && comp.querySelector(':scope > .sc-media');
  var info = media && media.previousElementSibling;
  if (!inner || !media || !info) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var run = null; // measurements for the current layout, or null when off

  function reset() {
    section.style.height = '';
    section.classList.remove('is-top-run');
    inner.style.top = '';
    media.style.height = '';
    media.style.marginTop = '';
    info.style.opacity = '';
  }

  function measure() {
    reset();
    run = null;
    if (reduce.matches) return;
    var m = media.getBoundingClientRect();
    var startH = m.height;
    var endH = m.width * 9 / 16;
    if (endH - startH < 8) return;
    // How far the cover's top travels to reach the top of the info block
    var overlap = m.top - info.getBoundingClientRect().top;
    var cs = getComputedStyle(section);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var h0 = inner.offsetHeight;
    var h1 = h0 + (endH - startH) - overlap;
    var distance = endH - startH + overlap; // scroll length ≈ how far things move
    run = { startH: startH, endH: endH, overlap: overlap, distance: distance };
    // Fixed section height: the header pins for `distance`, then scrolls away
    section.style.height = (padY + Math.max(h0, h1) + distance) + 'px';
    inner.style.top = (inner.getBoundingClientRect().top + window.scrollY) + 'px';
    section.classList.add('is-top-run');
    update();
  }

  function update() {
    if (!run) return;
    var p = Math.min(1, Math.max(0, window.scrollY / run.distance));
    media.style.height = (run.startH + (run.endH - run.startH) * p) + 'px';
    media.style.marginTop = (-run.overlap * p) + 'px';
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
