// Exploded View (library/exploded-view.json). Two stages, driven by scroll:
// 1. When the section comes into view, the stacked figure fades in and the intro
//    (eyebrow, headline, paragraph) fades up.
// 2. On the first scroll after that the section holds still while the pieces
//    separate and each piece's explainer replaces the intro. Scrolling back up
//    reverses it.
// Hovering a piece or its text enlarges the piece 10%.
// Static (everything shown, in order) on narrow screens, for reduced motion and
// in the editor.
(function () {
  if (document.getElementById('sc-edit-data')) return;
  var wide = window.matchMedia('(min-width: 768px)');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.querySelectorAll('[data-hook="explode"]').forEach(function (root) {
    var section = root.closest('section');
    var inner = section && section.querySelector(':scope > .sc-container');
    var copy = root.querySelector('[data-hook="explode-copy"]');
    var stack = root.querySelector('[data-hook="explode-stack"]');
    if (!inner || !copy || !stack) return;
    var pairs = [1, 2, 3].map(function (i) {
      return {
        shape: stack.querySelector(':scope > [data-hook="part-' + i + '"]'),
        text: copy.querySelector(':scope > [data-hook="part-' + i + '"]'),
      };
    }).filter(function (p) { return p.shape && p.text; });

    // Hover: a piece and its text light each other up
    pairs.forEach(function (p) {
      [p.shape, p.text].forEach(function (el) {
        el.addEventListener('pointerenter', function () { p.shape.classList.add('is-hot'); });
        el.addEventListener('pointerleave', function () { p.shape.classList.remove('is-hot'); });
      });
    });

    var live = false, top = 0, stage = 0;

    function setStage(n) {
      if (n === stage) return;
      stage = n;
      root.classList.toggle('is-stage-1', n === 1);
      root.classList.toggle('is-stage-2', n === 2);
    }

    function reset() {
      root.classList.remove('is-live', 'is-stage-1', 'is-stage-2');
      section.style.height = '';
      inner.style.position = inner.style.top = '';
      copy.style.height = '';
      pairs.forEach(function (p) { p.text.style.removeProperty('--part-y'); p.text.style.removeProperty('--line-y'); p.text.style.removeProperty('--lead'); });
      stage = 0;
    }

    function layout() {
      reset();
      live = wide.matches && !reduce.matches;
      if (!live) return;
      root.classList.add('is-live');
      // Line each part's headline up with the middle of its piece. The figure's
      // layout is the separated one (stage 1 only translates), so offsets hold.
      // offsetTop/offsetLeft ignore translate and scale, so these are resting positions
      copy.style.height = root.querySelector('[data-hook="explode-figure"]').offsetHeight + 'px';
      var copyBox = copy.getBoundingClientRect();
      var stackBox = stack.getBoundingClientRect();
      var gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap-medium')) || 24;
      pairs.forEach(function (p) {
        var title = p.text.querySelector('.sc-headline') || p.text;
        var mid = stackBox.top - copyBox.top + p.shape.offsetTop + p.shape.offsetHeight / 2;
        var titleMid = title.offsetTop + title.offsetHeight / 2;
        p.text.style.setProperty('--part-y', (mid - titleMid) + 'px');
        p.text.style.setProperty('--line-y', titleMid + 'px');
        var right = stackBox.left + p.shape.offsetLeft + p.shape.offsetWidth;
        p.text.style.setProperty('--lead', Math.max(0, copyBox.left - right - 2 * gap) + 'px');
      });
      // Hold the section still for a short stretch while the pieces separate
      // Centred in the space under the fixed nav bar
      var vh = window.innerHeight;
      var header = document.querySelector('.site-header');
      var nav = header ? header.offsetHeight : 0;
      top = nav + Math.max(0, (vh - nav - inner.offsetHeight) / 2);
      var hold = Math.round(vh * 0.6);
      var cs = getComputedStyle(section);
      section.style.height = (inner.offsetHeight + hold + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + 'px';
      inner.style.position = 'sticky';
      inner.style.top = top + 'px';
      update();
    }

    function update() {
      if (!live) return;
      // Measured each time: content above (e.g. the project header's own scroll
      // effect) can change height after load. past = how far it's been scrolled
      // since the section settled into place.
      var box = section.getBoundingClientRect();
      var past = top - (box.top + parseFloat(getComputedStyle(section).paddingTop));
      var inView = box.top < window.innerHeight * 0.7;
      if (past > 60) setStage(2);
      else if (past < 20) setStage(inView ? 1 : 0);
      else if (stage === 0 && inView) setStage(1);
    }

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; update(); });
    }, { passive: true });
    var timer;
    window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(layout, 150); });
    wide.addEventListener('change', layout);
    reduce.addEventListener('change', layout);
    if (document.readyState === 'complete') layout();
    else window.addEventListener('load', layout);
  });
})();
