// Autoplaying videos: pause them for people who've asked for reduced motion,
// and only play the ones that are on screen.
(function () {
  var videos = document.querySelectorAll('video[autoplay]');
  if (!videos.length) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function stopAll() {
    videos.forEach(function (v) { v.pause(); v.removeAttribute('autoplay'); });
  }
  if (reduce.matches) { stopAll(); return; }
  reduce.addEventListener('change', function (e) { if (e.matches) stopAll(); });

  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (reduce.matches) return;
      if (e.isIntersecting) { var p = e.target.play(); if (p && p.catch) p.catch(function () {}); }
      else e.target.pause();
    });
  }, { rootMargin: '200px 0px' });
  videos.forEach(function (v) { io.observe(v); });
})();
