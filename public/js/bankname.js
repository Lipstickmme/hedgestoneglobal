/* Hedgestone Global - the bank's name, as the staff console has it.

   The pages are built ahead of time with the name in them. When staff set a
   different one under Settings, Bank name, this swaps it in wherever the
   built name appears as words: headings, sentences, the tab title, and alt
   text. The logo images carry the name as artwork and are not touched.

   main.js (public pages) and core.js (online banking) call
   HSName.apply(name) with what the server says. The last name seen is kept
   in this browser so the next page shows it straight away rather than
   flashing the built one first. */
(function () {
  'use strict';

  var BUILT = 'Hedgestone Global Bank';
  var BUILT_SHORT = 'Hedgestone';
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

  // The first word, for the places that print the short name next to the
  // mark (the sidebar's "Hedgestone / Online banking").
  function shortOf(name) {
    return String(name).split(/\s+/)[0] || name;
  }

  // Safe to run twice on the same words, even when the new name contains the
  // old one ("Hedgestone Global Bank Ltd"): the new name is stepped over.
  function swapText(text, from, to) {
    if (text.indexOf(from) === -1) return text;
    if (to.indexOf(from) === -1) return text.split(from).join(to);
    return text.split(to).map(function (part) { return part.split(from).join(to); }).join(to);
  }

  var ATTRS = ['alt', 'aria-label', 'title', 'placeholder'];

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

  function paintShort(name) {
    var short = name === BUILT ? BUILT_SHORT : shortOf(name);
    Array.prototype.forEach.call(document.querySelectorAll('[data-bank-short]'), function (el) {
      el.textContent = short;
    });
  }

  // Screens that draw themselves after load (statements, account details,
  // the console) can print the built name too; catch those as they arrive.
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
    swapIn(document.body, from, next);
    if (document.title.indexOf(from) !== -1) document.title = swapText(document.title, from, next);
    paintShort(next);
    if (next !== BUILT) watch();
  }

  window.HSName = { apply: apply, get: function () { return current; } };

  var last = stored();
  if (last) apply(last);
}());
