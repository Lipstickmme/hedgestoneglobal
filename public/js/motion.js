/* Hedgestone Global - scroll reveals for the marketing pages.
   Marks section content to rise in as it scrolls into view. Nothing is hidden
   until this script has run, and nothing moves for visitors who ask for
   reduced motion. */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  var targets = document.querySelectorAll(
    '.rf-section .rf-eyebrow, .rf-section h2, .rf-section .section-lede, ' +
    '.rf-section .rf-grid > *, .rf-section .rf-card, .rf-section img'
  );
  if (!targets.length) return;

  var seen = new Set();
  targets.forEach(function (el) {
    if (seen.has(el) || el.closest('.hs-hero')) return;
    seen.add(el);
    el.setAttribute('data-hs-reveal', '');
  });
  document.documentElement.classList.add('hs-motion');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      var parent = el.parentElement;
      var peers = parent ? Array.prototype.filter.call(parent.children, function (c) { return c.hasAttribute('data-hs-reveal'); }) : [];
      var step = Math.max(0, Math.min(peers.indexOf(el), 5));
      el.style.setProperty('--hs-delay', (step * 90) + 'ms');
      el.classList.add('is-in');
      io.unobserve(el);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });

  seen.forEach(function (el) { io.observe(el); });
})();
