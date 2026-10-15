// Navigation (Figma: Navigation component).
// - Hidden at the top of the page, revealed once you scroll.
// - Mouse/trackpad: the slim bar opens into the 3/4-height takeover on hover and closes
//   when the pointer leaves (the free 1/4 below is the escape route). Short delays keep
//   it from flickering on a passing cursor.
// - Touch screens and phones: the toggle button opens and closes it.
// - Keyboard: focusing anything in the header opens it; Escape closes it.
(function () {
  var header = document.querySelector('.site-header');
  if (!header) return;

  var REVEAL_AT = 40;
  function onScroll() {
    var show = window.scrollY > REVEAL_AT;
    if (header.classList.contains('is-revealed') !== show) header.classList.toggle('is-revealed', show);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var toggle = header.querySelector('.site-header__toggle');
  var phone = window.matchMedia('(max-width: 1023.98px)');
  var hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  var OPEN_DELAY = 80;
  var CLOSE_DELAY = 220;
  var timer;

  function setOpen(open) {
    clearTimeout(timer);
    if (header.classList.contains('is-open') === open) return;
    header.classList.toggle('is-open', open);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    // Only the full-screen phone menu locks the page
    document.documentElement.classList.toggle('nav-locked', open && phone.matches);
  }
  function later(open, ms) {
    clearTimeout(timer);
    timer = setTimeout(function () { setOpen(open); }, ms);
  }

  header.addEventListener('mouseenter', function () {
    if (hover.matches && !phone.matches) later(true, OPEN_DELAY);
  });
  header.addEventListener('mouseleave', function () {
    if (hover.matches && !phone.matches) later(false, CLOSE_DELAY);
  });

  header.addEventListener('focusin', function (e) {
    // Keyboard focus only — a tap on the toggle also focuses it
    if (!phone.matches && e.target.matches(':focus-visible')) setOpen(true);
  });
  header.addEventListener('focusout', function (e) {
    if (!header.contains(e.relatedTarget) && !header.matches(':hover')) later(false, CLOSE_DELAY);
  });

  if (toggle) toggle.addEventListener('click', function () {
    setOpen(!header.classList.contains('is-open'));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !header.classList.contains('is-open')) return;
    setOpen(false);
    if (header.contains(document.activeElement)) document.activeElement.blur();
  });

  // Tap outside closes it on touch screens
  document.addEventListener('pointerdown', function (e) {
    if (header.classList.contains('is-open') && !header.contains(e.target)) setOpen(false);
  });

  phone.addEventListener('change', function () { setOpen(false); });
})();
