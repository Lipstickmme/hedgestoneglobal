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
    if (seen.has(el) || el.closest('.hs-home')) return;
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

  // The photo band settles from a slight zoom as it arrives.
  var bands = document.querySelectorAll('.hs-band');
  var bandIo = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); bandIo.unobserve(e.target); }
    });
  }, { threshold: 0.2 });
  bands.forEach(function (b) { bandIo.observe(b); });

  // Figures count up from zero to the number already printed in the page.
  document.querySelectorAll('[data-hs-count]').forEach(function (el) {
    var target = Number(el.getAttribute('data-hs-count')) || 0;
    var start = null;
    var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
    var tick = function (t) {
      if (start === null) start = t;
      var k = Math.min((t - start) / 1400, 1);
      el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    setTimeout(function () { requestAnimationFrame(tick); }, 700);
  });
})();
