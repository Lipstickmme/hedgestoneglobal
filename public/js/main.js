'use strict';

/* =========================================================================
   Rockfield National Bank shared frontend for the public site.
   Exposes helpers on window.ROCKFIELD (window.MERKEL remains as an alias for
   the page scripts that came with the template), drives shared UI
   (nav, hero slideshow, reveals, counters, contact form) and hydrates the
   home page. Data comes from the Express API with seed-data fallbacks.
   ========================================================================= */

(function () {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* No fallback list of services here any more. The four that used to sit in
     this file were the engineering practice this was built from - structural
     frames, drainage, HVAC, BIM - and they were shipped to every visitor's
     browser long after the bank stopped having anything to do with them.
     /api/services serves the real ones; if it cannot be reached the section
     stays empty, which is better than a bank offering seismic detailing. */
  const FALLBACK_PROJECTS = [
    { id: 'meridian-logistics', name: 'Meridian Logistics', sector: 'Business banking', location: 'Columbus, OH', year: 2025, metric: '2 days', metricLabel: 'cut from payroll settlement', image: '/assets/img/story-logistics.png', blurb: 'Same-day ACH origination took two days out of a payroll run for 640 drivers.' },
    { id: 'harrow-street', name: 'Harrow Street Residences', sector: 'Commercial lending', location: 'Columbus, OH', year: 2024, metric: '$14.2m', metricLabel: 'construction facility', image: '/assets/img/story-property.png', blurb: 'A construction facility drawn against surveyed progress rather than a fixed calendar.' },
    { id: 'field-and-vine', name: 'Field & Vine Grocers', sector: 'Merchant services', location: 'Dublin, OH', year: 2025, metric: 'Next day', metricLabel: 'card settlement', image: '/assets/img/story-retail.png', blurb: 'Next-business-day settlement across nine stores, reconciled against the operating account automatically.' },
    { id: 'ellis-household', name: 'The Ellis household', sector: 'Personal banking', location: 'Columbus, OH', year: 2026, metric: '4.35%', metricLabel: 'APY on savings', image: '/assets/img/story-personal.png', blurb: 'Round-ups and an automatic sweep the day after payday, with nothing to remember.' }
  ];

  function projectCard(p) {
    return `
      <a class="card" href="/projects/${esc(p.id)}" data-reveal>
        <div class="thumb"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" /></div>
        <div class="card-body">
          <div class="meta"><span class="sector">${esc(p.sector)}</span><span>${esc(p.year)}</span></div>
          <h3>${esc(p.name)}</h3>
          <div class="loc">${esc(p.location)}</div>
          <p>${esc(p.blurb)}</p>
          <div class="metric"><b>${esc(p.metric)}</b><span>${esc(p.metricLabel)}</span></div>
        </div>
      </a>`;
  }

  /* Reveal on scroll (idempotent; safe to re-run after injecting content).
     Siblings inside one section arrive in sequence rather than all at once,
     which is the difference between a page that animates and one that lurches. */
  function observeReveals() {
    const els = $$('[data-reveal]:not(.in)');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const section = el.closest('.chapter, section, header') || document.body;
        const peers = $$('[data-reveal]', section);
        const step = Math.min(peers.indexOf(el), 5);
        el.style.setProperty('--reveal-delay', (step * 90) + 'ms');
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });
    els.forEach((el) => io.observe(el));
  }

  /* Bank contact details ---------------------------------------------------
     The address and the telephone numbers are not built into the pages: they
     are per-deployment, set by an operator at the staff console, and served
     from /api/site. Until one is set the page shows the phrase it was built
     with ("our fraud line") or leaves the row out altogether, so nothing ever
     reads as a blank or an invented number. */
  const site = { email: '', phone: '', address: '', hours: '', fraudPhone: '', internationalPhone: '' };

  const telHref = (value) => 'tel:' + String(value).replace(/[^+\d]/g, '');

  function applySite(values) {
    Object.assign(site, values);
    $$('[data-site]').forEach((el) => {
      const key = el.getAttribute('data-site');
      const value = values[key];
      if (!value) return;
      el.textContent = value;
      if (el.tagName === 'A') {
        if (key === 'email') el.href = 'mailto:' + value;
        if (key === 'phone' || key === 'fraudPhone' || key === 'internationalPhone') el.href = telHref(value);
      }
    });
    // Every contact detail is optional. A row appears only once there is
    // something to put in it, so an unset detail is absent rather than a
    // label with a blank beside it.
    //
    // Visibility only: the text is the business of the [data-site] pass above,
    // which is why a <dt> label carrying this marker keeps its own words.
    $$('[data-site-row]').forEach((row) => {
      row.hidden = !values[row.getAttribute('data-site-row')];
    });
  }

  async function hydrateSite() {
    try {
      applySite(await fetchJSON('/api/site'));
    } catch (e) {
      /* the built-in values stand */
    }
  }

  // ROCKFIELD is the name to use. MERKEL is kept as an alias because the page
  // scripts this site inherited from the template still reach for it.
  window.ROCKFIELD = { $, $$, esc, fetchJSON, reduceMotion, projectCard, observeReveals, FALLBACK_PROJECTS, site };
  window.MERKEL = window.ROCKFIELD;

  /* Nav, scroll progress, underlay parallax, chapter rail ----------------- */
  const nav = $('#nav');
  const progress = $('#progress');
  const underlay = $('.underlay-img');
  const chapters = $$('.chapter[data-chapter]');
  let railLinks = [];
  let ticking = false;

  /* The underlay drifts across the whole document rather than with raw scroll,
     so the travel is the same on a short page and a long one. */
  const UNDERLAY_TRAVEL = 70;
  const MEDIA_TRAVEL = 80;
  const media = $$('.chapter-media');

  function frame() {
    ticking = false;
    const doc = document.documentElement;
    const scrolled = doc.scrollTop || window.scrollY || 0;
    const pct = scrolled / (doc.scrollHeight - doc.clientHeight || 1);

    if (nav) nav.classList.toggle('scrolled', scrolled > 24);
    if (progress) progress.style.width = (pct * 100) + '%';
    if (underlay && !reduceMotion) {
      underlay.style.setProperty('--underlay-shift', (-UNDERLAY_TRAVEL * pct).toFixed(1) + 'px');
    }

    /* Artwork drifts against its section: at the top of the section the image
       sits low, at the bottom it has risen, so the picture and the words are
       never travelling at the same speed. */
    if (!reduceMotion) {
      for (let i = 0; i < media.length; i += 1) {
        const layer = media[i];
        const box = layer.parentElement.getBoundingClientRect();
        if (box.bottom < -200 || box.top > window.innerHeight + 200) continue;
        const progress = (window.innerHeight - box.top) / (window.innerHeight + box.height);
        layer.style.setProperty('--media-shift', ((progress - 0.5) * MEDIA_TRAVEL).toFixed(1) + 'px');
      }
    }

    if (railLinks.length) {
      const middle = scrolled + window.innerHeight / 2;
      let active = 0;
      chapters.forEach((section, i) => {
        const top = section.offsetTop;
        if (middle >= top) active = i;
      });
      railLinks.forEach((a, i) => a.classList.toggle('is-active', i === active));
    }
  }

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  /* A restrained pointer tilt gives the glass surfaces physical depth without
     changing layout. Touch and reduced-motion users keep the static view. */
  if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    const tiltTargets = $$('.hero-copy, .nav, .service, .project, .leadership-media');
    tiltTargets.forEach((target) => {
      target.addEventListener('pointermove', (event) => {
        const box = target.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width - 0.5;
        const y = (event.clientY - box.top) / box.height - 0.5;
        target.style.setProperty('--tilt-x', `${(-y * 3.5).toFixed(2)}deg`);
        target.style.setProperty('--tilt-y', `${(x * 4.5).toFixed(2)}deg`);
      });
      target.addEventListener('pointerleave', () => {
        target.style.setProperty('--tilt-x', '0deg');
        target.style.setProperty('--tilt-y', '0deg');
      });
    });
  }

  /* Section artwork settles into place as its chapter arrives. */
  function stageChapters() {
    if (!chapters.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      chapters.forEach((c) => c.classList.add('is-onstage'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-onstage'); io.unobserve(e.target); }
      });
    }, { threshold: 0.2 });
    chapters.forEach((c) => io.observe(c));
  }

  /* The rail is built from the sections themselves, so adding a chapter to
     src/site/pages.js adds its marker here with nothing else to update. */
  function buildRail() {
    const rail = $('#chapter-rail');
    if (!rail || !chapters.length) return;
    rail.innerHTML = chapters.map((section) => `
      <a href="#${esc(section.id)}" title="${esc(section.dataset.chapter)}">
        <span class="label">${esc(section.dataset.chapter)}</span>
        <span class="tick"></span>
      </a>`).join('');
    railLinks = $$('a', rail);
  }

  const toggle = $('#navtoggle');
  const links = $('#navlinks');
  if (toggle && links) {
    const setSheet = (open) => {
      links.classList.toggle('open', open);
      nav.classList.toggle('open-sheet', open);
      // The page behind a full-screen sheet must not scroll under it.
      document.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', () => setSheet(!links.classList.contains('open')));
    $$('#navlinks a').forEach((a) => a.addEventListener('click', () => setSheet(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && links.classList.contains('open')) setSheet(false);
    });
  }

  /* Hero slideshow ------------------------------------------------------- */
  function setupSlides() {
    const wrap = $('#hero-slides');
    if (!wrap) return;
    const slides = $$('.slide', wrap);
    const dots = $$('#hero-dots .dot');
    if (slides.length <= 1) return;
    const DURATION = 5500;
    let idx = 0, timer = null;
    const go = (n) => {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => { stop(); if (!reduceMotion) timer = setInterval(() => go(idx + 1), DURATION); };
    dots.forEach((d) => d.addEventListener('click', () => { go(Number(d.dataset.slide)); start(); }));
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    start();
  }

  /* Counters ------------------------------------------------------------- */
  function runCounters() {
    const nums = $$('[data-count]');
    if (!nums.length) return;
    const animate = (el) => {
      const target = Number(el.dataset.count) || 0;
      const suffix = el.dataset.suffix || '';
      if (reduceMotion) { el.textContent = target + suffix; return; }
      const dur = 1400, start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / dur);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (!('IntersectionObserver' in window)) { nums.forEach(animate); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { animate(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.6 });
    nums.forEach((el) => io.observe(el));
  }

  /* Home hydration: services + featured projects ------------------------- */
  async function hydrateHome() {
    const svcGrid = $('#services-grid');
    if (svcGrid) {
      let services = [];
      try { const d = await fetchJSON('/api/services'); services = d.services || services; } catch (e) {}
      svcGrid.innerHTML = services.map((s, i) => `
        <article class="service" data-reveal>
          <div class="num">${String(i + 1).padStart(2, '0')}</div>
          <div class="code">${esc(s.code || 'S-' + (i + 1))}</div>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.summary)}</p>
          <ul>${(s.capabilities || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        </article>`).join('');
    }
    const featured = $('#featured-projects');
    if (featured) {
      let projects = FALLBACK_PROJECTS;
      try { const d = await fetchJSON('/api/projects'); projects = d.projects || projects; } catch (e) {}
      featured.innerHTML = projects.slice(0, 3).map(projectCard).join('');
    }
    observeReveals();
  }

  /* Contact form --------------------------------------------------------- */

  /** Wire every enquiry form on the page. Both post to the same endpoint, so
      both land in `enquiries` and appear on the client services desk at /admin. */
  function setupForms() {
    $$('[data-contact-form]').forEach(setupForm);
  }

  function setupForm(form) {
    if (!form || form.dataset.wired) return;
    form.dataset.wired = '1';
    const statusEl = $('[data-form-status]', form);
    const btn = $('[data-submit]', form);
    // `form.elements.namedItem` rather than `form.name`, which is the form's
    // own name attribute and would shadow the field of the same name.
    const field = (n) => form.elements.namedItem(n);
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const setErr = (name, msg) => {
      const errEl = form.querySelector(`[data-err="${name}"]`);
      const field = errEl ? errEl.closest('.field') : null;
      if (errEl) errEl.textContent = msg || '';
      if (field) field.classList.toggle('invalid', !!msg);
    };
    const validate = () => {
      let ok = true;
      const name = field('name').value.trim(), email = field('email').value.trim(), message = field('message').value.trim();
      if (name.length < 2) { setErr('name', 'Please enter your name.'); ok = false; } else setErr('name', '');
      if (!EMAIL_RE.test(email)) { setErr('email', 'Enter a valid email.'); ok = false; } else setErr('email', '');
      if (message.length < 10) { setErr('message', 'A little more detail, please.'); ok = false; } else setErr('message', '');
      return ok;
    };
    ['name', 'email', 'message'].forEach((n) => {
      field(n).addEventListener('blur', validate);
      field(n).addEventListener('input', () => {
        const errEl = form.querySelector(`[data-err="${n}"]`);
        if (errEl && errEl.textContent) validate();
      });
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      statusEl.className = 'form-status';
      if (!validate()) { statusEl.className = 'form-status bad'; statusEl.textContent = 'Please correct the highlighted fields.'; return; }
      const payload = {
        name: field('name').value.trim(), email: field('email').value.trim(),
        company: field('company').value.trim(), service: field('service').value,
        message: field('message').value.trim(), website: field('website') ? field('website').value : ''
      };
      btn.disabled = true;
      const original = btn.innerHTML;
      btn.innerHTML = 'Sending';
      try {
        const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { form.reset(); statusEl.className = 'form-status ok'; statusEl.textContent = data.message || 'Thank you. Your enquiry has reached our client services team.'; }
        else if (res.status === 422 && data.fields) { Object.entries(data.fields).forEach(([k, v]) => setErr(k, v)); statusEl.className = 'form-status bad'; statusEl.textContent = 'Please correct the highlighted fields.'; }
        else if (res.status === 429) { statusEl.className = 'form-status bad'; statusEl.textContent = 'Too many attempts. Please wait a moment and try again.'; }
        else { statusEl.className = 'form-status bad'; statusEl.textContent = data.message || `Something went wrong. Please email ${site.email}.`; }
      } catch (err) { statusEl.className = 'form-status bad'; statusEl.textContent = `Network error. Please email ${site.email}.`; }
      finally { btn.disabled = false; btn.innerHTML = original; }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();
    hydrateSite();
    buildRail();
    stageChapters();
    setupSlides();
    runCounters();
    setupForms();
    hydrateHome();
    observeReveals();
    frame();
  });
})();
