/* Hedgestone Global - asset badges.

   One small round mark per listed asset, in the asset's own colours, for the
   ticker, the dashboard and the Invest screen. A real logo file dropped into
   public/assets/img/logos/ (SPY.svg, AAPL.png, BTC.webp ...) is picked up by
   the build and used instead - see window.HS_LOGOS, written by
   scripts/build-pages.js into /js/asset-logos.js. */
(function () {
  'use strict';

  var BRAND = {
    SPY: { bg: 'linear-gradient(135deg,#0b3d91,#1f5fbf)', fg: '#fff', text: '500', color: '#1f5fbf' },
    QQQ: { bg: 'linear-gradient(135deg,#5b21b6,#7c3aed)', fg: '#fff', text: '100', color: '#7c3aed' },
    AAPL: { bg: 'linear-gradient(135deg,#1d1d1f,#3a3a3c)', fg: '#fff', text: 'A', color: '#3a3a3c' },
    AMZN: { bg: 'linear-gradient(135deg,#232f3e,#37475a)', fg: '#ff9900', text: 'a', color: '#ff9900' },
    MSFT: { bg: 'linear-gradient(135deg,#0067b8,#2b88d8)', fg: '#fff', text: 'M', color: '#2b88d8' },
    NVDA: { bg: 'linear-gradient(135deg,#5a8f00,#76b900)', fg: '#fff', text: 'N', color: '#76b900' },
    GOOGL: { bg: '#ffffff', fg: '#4285f4', text: 'G', color: '#4285f4', ring: '#dadce0' },
    TSLA: { bg: 'linear-gradient(135deg,#b3121f,#e31937)', fg: '#fff', text: 'T', color: '#e31937' },
    BTC: { bg: 'linear-gradient(135deg,#f7931a,#ffb347)', fg: '#fff', text: '₿', color: '#f7931a' },
    XAU: { bg: 'linear-gradient(135deg,#b8860b,#f5d77a)', fg: '#4a3407', text: 'Au', color: '#c9a227' },
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** The badge for a symbol, as HTML, `size` pixels across. */
  function logo(symbol, size, label) {
    var sym = String(symbol || '').toUpperCase();
    var px = size || 32;
    var file = window.HS_LOGOS && window.HS_LOGOS[sym];
    var title = label ? ' title="' + esc(label) + '"' : '';
    if (file) {
      return '<img class="hs-logo is-file" src="' + esc(file) + '" alt="" width="' + px + '" height="' + px + '" style="--s:' + px + 'px"' + title + ' />';
    }
    var b = BRAND[sym] || { bg: '#e6f4ee', fg: '#0a5a44', text: sym.slice(0, 2), color: '#0b6b50' };
    var len = String(b.text).length;
    var fs = Math.round(px * (len >= 3 ? 0.34 : len === 2 ? 0.4 : 0.5));
    return '<span class="hs-logo" aria-hidden="true"' + title + ' style="--s:' + px + 'px;background:' + b.bg + ';color:' + b.fg + ';font-size:' + fs + 'px' + (b.ring ? ';box-shadow:inset 0 0 0 1px ' + b.ring : '') + '">' + esc(b.text) + '</span>';
  }

  /** The asset's own colour, for allocation bars and legends. */
  function color(symbol) {
    var b = BRAND[String(symbol || '').toUpperCase()];
    return b ? b.color : '#0b6b50';
  }

  window.HSAssets = { logo: logo, color: color };
}());
