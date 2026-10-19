/* The platform's name, as the staff console has it.

   The pages are built ahead of time with the default name in them. When staff
   set a different one under Settings, Platform name, this swaps it in wherever
   the built name appears as words: headings, sentences, the tab title, alt
   text, and the name beside the logo mark, which is type rather than artwork
   precisely so that it can change.

   main.js (public pages) and core.js (signed in) call HSName.apply(name) with
   what the server says. The last name seen is kept in this browser so the next
   page shows it straight away rather than flashing the built one first. */
(function () {
  'use strict';

  var BUILT = 'Hedgestone Finance';
  var KEY = 'hs_bank_name';
  var current = BUILT;
  var observer = null;

  function remember(name) {
    try {
      if (name === BUILT) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, name);
    } catch (e) { /* private window: the swap still happens, just later */ }
  }

  function stored() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  // Safe to run twice on the same words, even when the new name contains the
  // old one ("Hedgestone Finance Ltd"): the new name is stepped over.
  function swapText(text, from, to) {
    if (text.indexOf(from) === -1) return text;
    if (to.indexOf(from) === -1) return text.split(from).join(to);
    return text.split(to).map(function (part) { return part.split(from).join(to); }).join(to);
  }

  var ATTRS = ['alt', 'aria-label', 'title', 'placeholder', 'content'];

  function swapIn(root, from, to) {
    if (!root) return;
    if (root.nodeType === 3) {
      root.nodeValue = swapText(root.nodeValue, from, to);
      return;
    }
    if (root.nodeType !== 1) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode;
        if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.indexOf(from) === -1 ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
      },
    });
    var hits = [];
    while (walker.nextNode()) hits.push(walker.currentNode);
    hits.forEach(function (node) { node.nodeValue = swapText(node.nodeValue, from, to); });

    var sel = ATTRS.map(function (a) { return '[' + a + '*="' + from.replace(/"/g, '\\"') + '"]'; }).join(',');
    var els = root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : [];
    if (root.matches && root.matches(sel)) els.push(root);
    els.forEach(function (el) {
      ATTRS.forEach(function (a) {
        var v = el.getAttribute(a);
        if (v && v.indexOf(from) !== -1) el.setAttribute(a, swapText(v, from, to));
      });
    });
  }

  // The name beside the mark: the first word set large, the rest small and
  // spaced beneath it, the way the old artwork had HEDGESTONE over GLOBAL
  // BANK. One word is just the one line.
  function paintBrand(name) {
    var words = String(name).split(/\s+/).filter(Boolean);
    Array.prototype.forEach.call(document.querySelectorAll('[data-brand-name]'), function (el) {
      el.textContent = '';
      var big = document.createElement('b');
      big.textContent = words[0] || name;
      el.appendChild(big);
      if (words.length > 1) {
        var small = document.createElement('small');
        small.textContent = words.slice(1).join(' ');
        el.appendChild(small);
      }
    });
  }

  // Screens that draw themselves after load (the dashboard, the console) can
  // print the built name too; catch those as they arrive.
  function watch() {
    if (observer || !window.MutationObserver || !document.body) return;
    observer = new MutationObserver(function (records) {
      if (current === BUILT) return;
      records.forEach(function (r) {
        if (r.type === 'characterData') swapIn(r.target, BUILT, current);
        else Array.prototype.forEach.call(r.addedNodes, function (n) { swapIn(n, BUILT, current); });
      });
      observer.takeRecords(); // our own edits, not the page's
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function apply(name) {
    var next = String(name || '').trim() || BUILT;
    remember(next);
    if (next === current) return;
    var from = current;
    current = next;
    if (document.body) swapIn(document.body, from, next);
    swapIn(document.head, from, next);
    if (document.title.indexOf(from) !== -1) document.title = swapText(document.title, from, next);
    paintBrand(next);
    if (next !== BUILT) watch();
  }

  window.HSName = { apply: apply, get: function () { return current; } };

  var last = stored();
  if (last) apply(last);
}());
