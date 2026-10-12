// Mobile menu: toggles the full-screen "Mobile Open" layout of the Navigation component.
(function () {
  var header = document.querySelector('.site-header');
  if (!header) return;

  // Hidden at the top of the page, revealed once you scroll
  var REVEAL_AT = 40;
  function onScroll() {
    var show = window.scrollY > REVEAL_AT;
    if (header.classList.contains('is-revealed') !== show) header.classList.toggle('is-revealed', show);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var toggle = header && header.querySelector('.site-header__toggle');
  if (!toggle) return;

  var desktop = window.matchMedia('(min-width: 1024px)');

  function setOpen(open) {
    header.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.documentElement.classList.toggle('nav-locked', open);
  }

  toggle.addEventListener('click', function () {
    setOpen(!header.classList.contains('is-open'));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && header.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  desktop.addEventListener('change', function (e) {
    if (e.matches) setOpen(false);
  });
})();
