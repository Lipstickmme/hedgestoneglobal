/* The live Bitcoin price strip under the nav.

   Reads /api/bank/markets every 30 seconds while the tab is visible and
   flashes the price green or red when it moves. Bitcoin is the only asset, so
   the price stands still in the strip; should more than one ever be listed,
   they scroll past (or can be swiped, for visitors who ask for reduced
   motion). Hidden entirely if no price can be had, rather than showing a
   strip of dashes. */
(function () {
  'use strict';

  var host = document.querySelector('[data-hs-ticker]');
  if (!host) return;
  var track = host.querySelector('[data-hs-ticker-track]');
  var REFRESH_MS = 30000;
  var last = {};
  var timer = null;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // Signed out, a price goes straight to sign-in and on to Bitcoin afterwards,
  // rather than opening a page that would only send them there.
  var signedIn = /(?:^|;\s*)rf_csrf=/.test(document.cookie);
  var dest = function (path) { return signedIn ? path : '/signin?next=' + encodeURIComponent(path); };
  var cta = host.querySelector('.hs-ticker-cta');
  if (cta) cta.setAttribute('href', dest('/invest'));

  var price = function (p) {
    return '$' + Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  function item(a, dupe) {
    var q = a.quote;
    var dir = q.change > 0 ? 'up' : q.change < 0 ? 'down' : 'flat';
    var pct = q.changePct == null ? '' : (q.changePct > 0 ? '+' : '') + q.changePct.toFixed(2) + '%';
    return '<a class="hs-tick ' + dir + '" data-sym="' + esc(a.symbol) + '" href="' + esc(dest('/invest?convert=' + a.symbol)) + '"'
      + (dupe ? ' aria-hidden="true" tabindex="-1"' : '')
      + ' title="' + esc(a.detail + ' - ' + q.source + ', ' + new Date(q.asOf).toLocaleString()) + '">'
      + (window.HSAssets ? window.HSAssets.logo(a.symbol, 20) : '')
      + '<b>' + esc(a.name) + '</b>'
      + '<span class="sym">' + esc(a.symbol) + '</span>'
      + '<span class="px">' + price(q.price) + '</span>'
      + (pct ? '<span class="chg">' + (dir === 'up' ? '&#9650;' : dir === 'down' ? '&#9660;' : '') + ' ' + pct + '</span>' : '')
      + '</a>';
  }

  /** Update prices where they stand, so the scroll does not jump back to the start. */
  function update(priced) {
    priced.forEach(function (a) {
      var q = a.quote;
      var dir = q.change > 0 ? 'up' : q.change < 0 ? 'down' : 'flat';
      var moved = last[a.symbol] != null && last[a.symbol] !== q.price ? (q.price > last[a.symbol] ? 'flash-up' : 'flash-down') : '';
      Array.prototype.forEach.call(track.querySelectorAll('[data-sym="' + a.symbol + '"]'), function (el) {
        var fresh = document.createElement('div');
        fresh.innerHTML = item(a, el.getAttribute('aria-hidden') === 'true');
        el.innerHTML = fresh.firstChild.innerHTML;
        el.className = 'hs-tick ' + dir + (moved ? ' ' + moved : '');
        if (moved) setTimeout(function () { el.classList.remove(moved); }, 1600);
      });
      last[a.symbol] = q.price;
    });
  }

  function render(assets) {
    var priced = assets.filter(function (a) { return a.quote && a.quote.price > 0; });
    if (!priced.length) { host.hidden = true; return; }
    var shown = Array.prototype.map.call(track.querySelectorAll('[data-sym]:not([aria-hidden])'), function (el) { return el.getAttribute('data-sym'); }).join(',');
    if (shown && shown === priced.map(function (a) { return a.symbol; }).join(',')) { update(priced); return; }
    var once = priced.map(function (a) { return item(a, false); }).join('');
    // One price stands still. Several scroll, two copies side by side so the
    // loop has no gap.
    var single = priced.length === 1;
    host.classList.toggle('is-single', single);
    track.innerHTML = single ? once : once + priced.map(function (a) { return item(a, true); }).join('');
    track.style.setProperty('--hs-ticker-duration', Math.max(30, priced.length * 6) + 's');
    priced.forEach(function (a) { last[a.symbol] = a.quote.price; });
    host.hidden = false;
  }

  function load() {
    return fetch('/api/bank/markets', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data && data.assets) render(data.assets); })
      .catch(function () { /* keep showing the last prices */ });
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  load();
  schedule();
}());
