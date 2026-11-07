// TimeBack UI kit: dot-matrix numerals, coverflow carousel, tick rulers,
// dynamic ombre palette. No dependencies.
(function (root) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- dynamic palette ----------------
  // Each category has an ombre palette. Setting it re-tints the page background
  // (CSS custom properties registered with @property animate smoothly).
  const PALETTES = {
    noir: ['#4a4a52', '#2c2c32', '#0c0c0f'],
    grocery: ['#86bdf0', '#d4e9fc', '#2b5680'],
    food: ['#e2579b', '#f3a3c4', '#6d2a52'],
    home: ['#7fae8f', '#cfe4c9', '#2f5244'],
    errands: ['#ec8a4c', '#f7c79b', '#7a3a1c'],
    travel: ['#4b66e6', '#a6b6ff', '#22306e'],
    study: ['#9a78e6', '#d6c6ff', '#45307a'],
    plan: ['#86bdf0', '#cfe4c9', '#2b4766'],
    ready: ['#7fae8f', '#e6f26b', '#2f5244'],
    booked: ['#4b66e6', '#7fe0c3', '#22306e'],
  };
  function setPalette(name) {
    const p = PALETTES[name] || PALETTES.noir;
    const s = document.documentElement.style;
    s.setProperty('--p1', p[0]);
    s.setProperty('--p2', p[1]);
    s.setProperty('--p3', p[2]);
  }

  // ---------------- dot-matrix numerals ----------------
  const FONT = {
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '.': ['0', '0', '0', '0', '0', '0', '1'],
    ',': ['0', '0', '0', '0', '0', '1', '1'],
    ':': ['0', '0', '1', '0', '1', '0', '0'],
    '-': ['000', '000', '000', '111', '000', '000', '000'],
    '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
    '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
    ' ': ['00', '00', '00', '00', '00', '00', '00'],
  };
  const NS = 'http://www.w3.org/2000/svg';

  function layout(text) {
    const chars = [...String(text)].map((c) => FONT[c] || FONT[' ']);
    let x = 0;
    const dots = [];
    chars.forEach((g, ci) => {
      const w = g[0].length;
      g.forEach((row, ry) => [...row].forEach((bit, rx) => dots.push({ x: x + rx, y: ry, on: bit === '1' })));
      x += w + (ci < chars.length - 1 ? 1 : 0);
    });
    return { dots, cols: x };
  }

  // Renders text as an SVG dot grid. Re-uses dots when the layout width matches
  // so changes morph instead of re-mounting.
  function dot(el, text) {
    const { dots, cols } = layout(text);
    let svg = el.querySelector('svg.dm');
    if (!svg || Number(svg.dataset.cols) !== cols || svg.childElementCount !== dots.length) {
      if (svg) svg.remove();
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'dm');
      svg.setAttribute('viewBox', `0 0 ${cols * 10} 70`);
      svg.dataset.cols = cols;
      svg.style.aspectRatio = `${cols * 10} / 70`;
      dots.forEach((d) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', d.x * 10 + 5);
        c.setAttribute('cy', d.y * 10 + 5);
        c.setAttribute('r', 3.3);
        c.style.transitionDelay = reduce ? '0ms' : `${(d.x * 9 + d.y * 4) % 160}ms`;
        svg.appendChild(c);
      });
      el.prepend(svg);
    }
    svg.setAttribute('aria-label', text);
    [...svg.children].forEach((c, i) => c.classList.toggle('on', dots[i].on));
  }

  // Count a dot-matrix number from its previous value to a new one.
  function countDot(el, target, fmt, dur = 900) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = target;
    if (reduce || from === target) return dot(el, fmt(target));
    const t0 = performance.now();
    let last = '';
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const txt = fmt(k === 1 ? target : from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (txt !== last) { dot(el, txt); last = txt; }
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------- tick ruler with triangle marker ----------------
  // <div class="ruler" data-ticks="41"></div>; ruler(el, 0.62)
  function ruler(el, frac) {
    if (!el.querySelector('.ticks')) {
      const n = Number(el.dataset.ticks || 41);
      el.insertAdjacentHTML('afterbegin', `<div class="ticks">${'<i></i>'.repeat(n)}</div><span class="marker"></span>`);
    }
    const f = Math.max(0, Math.min(1, frac));
    el.style.setProperty('--f', f);
    const ticks = el.querySelectorAll('.ticks i');
    const hot = Math.round(f * (ticks.length - 1));
    ticks.forEach((t, i) => t.classList.toggle('hot', Math.abs(i - hot) <= 1));
  }

  // ---------------- coverflow carousel ----------------
  // coverflow(el, items, { render(item) -> html, onFocus(item, i) })
  function coverflow(el, items, opts) {
    el.classList.add('cf');
    el.innerHTML = `<div class="cf-stage">${items.map((it, i) => `<button class="cf-card" data-i="${i}" type="button">${opts.render(it, i)}</button>`).join('')}</div>
      <div class="cf-nav"><button class="cf-prev" type="button" aria-label="Previous">‹</button><div class="cf-dots">${items.map(() => '<i></i>').join('')}</div><button class="cf-next" type="button" aria-label="Next">›</button></div>`;
    const cards = [...el.querySelectorAll('.cf-card')];
    const dots = [...el.querySelectorAll('.cf-dots i')];
    let active = Math.min(opts.start || 0, items.length - 1);
    function paint() {
      cards.forEach((c, i) => {
        const o = i - active;
        const a = Math.abs(o);
        c.style.transform = `translateX(${o * 74}%) translateZ(${-a * 140}px) rotateY(${o * -28}deg) scale(${a ? 0.86 : 1})`;
        c.style.zIndex = 100 - a;
        c.style.opacity = a > 2 ? 0 : 1 - a * 0.22;
        c.style.filter = a ? `blur(${a * 0.8}px) saturate(${1 - a * 0.25})` : 'none';
        c.classList.toggle('active', !a);
        c.tabIndex = a ? -1 : 0;
      });
      dots.forEach((d, i) => d.classList.toggle('on', i === active));
      if (opts.onFocus) opts.onFocus(items[active], active);
    }
    const go = (i) => { active = (i + items.length) % items.length; paint(); };
    cards.forEach((c, i) => c.addEventListener('click', () => (i === active ? opts.onSelect && opts.onSelect(items[i], i) : go(i))));
    el.querySelector('.cf-prev').addEventListener('click', () => go(active - 1));
    el.querySelector('.cf-next').addEventListener('click', () => go(active + 1));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') go(active - 1);
      if (e.key === 'ArrowRight') go(active + 1);
    });
    let sx = null;
    el.addEventListener('pointerdown', (e) => (sx = e.clientX));
    el.addEventListener('pointerup', (e) => {
      if (sx !== null && Math.abs(e.clientX - sx) > 40) go(active + (e.clientX < sx ? 1 : -1));
      sx = null;
    });
    paint();
    return { go, get index() { return active; } };
  }

  // ---------------- category art for cards ----------------
  const ICONS = {
    grocery: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
    food: '<path d="M7 3v8a3 3 0 0 0 3 3v7M10 3v6M13 3v8a3 3 0 0 1-3 3M18 3c-2 2-2 6 0 8v10"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    errands: '<path d="M4 7h16l-1.5 12a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2L4 7zM9 7a3 3 0 0 1 6 0"/>',
    travel: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M10 9l-1-3H7"/>',
    study: '<path d="M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z"/>',
  };
  const icon = (cat) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[cat] || ICONS.home}</svg>`;
  function art(cat) {
    const p = PALETTES[cat] || PALETTES.home;
    return `<div class="art" style="--a1:${p[0]};--a2:${p[1]};--a3:${p[2]}"><span class="art-ic">${icon(cat)}</span></div>`;
  }

  // ---------------- wave line ----------------
  function wave(el, frac) {
    if (!el.querySelector('.wv')) el.innerHTML = '<div class="wv"><svg viewBox="0 0 800 44" preserveAspectRatio="none"><path class="w2" d="M0 22 Q25 32 50 22 Q75 12 100 22 Q125 32 150 22 Q175 12 200 22 Q225 32 250 22 Q275 12 300 22 Q325 32 350 22 Q375 12 400 22 Q425 32 450 22 Q475 12 500 22 Q525 32 550 22 Q575 12 600 22 Q625 32 650 22 Q675 12 700 22 Q725 32 750 22 Q775 12 800 22"/><path class="w1" d="M0 22 Q25 6 50 22 Q75 38 100 22 Q125 6 150 22 Q175 38 200 22 Q225 6 250 22 Q275 38 300 22 Q325 6 350 22 Q375 38 400 22 Q425 6 450 22 Q475 38 500 22 Q525 6 550 22 Q575 38 600 22 Q625 6 650 22 Q675 38 700 22 Q725 6 750 22 Q775 38 800 22"/></svg></div><span class="flat"></span><span class="wm"></span>';
    el.style.setProperty('--f', Math.max(0.08, Math.min(0.95, frac)));
  }

  // ---------------- scroll-scoped palette ----------------
  // Colors only show while a carousel's section is on screen; otherwise the
  // page stays in black glass. zone(el).set(name) records the wanted palette.
  const zones = [];
  function applyZones() {
    const live = zones.find((z) => z.visible && z.name);
    setPalette(live ? live.name : 'noir');
  }
  function zone(el) {
    const z = { el, visible: false, name: null, set(name) { z.name = name; applyZones(); } };
    zones.push(z);
    new IntersectionObserver((entries) => entries.forEach((en) => {
      z.visible = en.isIntersecting;
      applyZones();
    }), { threshold: 0.35 }).observe(el);
    return z;
  }

  root.TimeBackUI = { zone, refreshPalette: applyZones, setPalette, dot, countDot, ruler, coverflow, art, icon, wave, PALETTES };
})(self);
