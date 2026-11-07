// Shared page behaviour: page transitions, scroll reveal, parallax, progress bar.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasVT = 'onpagereveal' in window || CSS.supports('view-transition-name: none');

  // ---- page enter / leave (fallback when cross-document view transitions aren't available) ----
  document.body.classList.add('page-enter');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.hash && url.pathname === location.pathname) return;
    if (hasVT || reduce) return;
    e.preventDefault();
    leaveTo(url.href);
  });
  window.TimeBackNav = { go: (href) => (hasVT || reduce ? (location.href = href) : leaveTo(href)) };
  function leaveTo(href) {
    document.body.classList.add('page-leave');
    setTimeout(() => (location.href = href), 220);
  }
  addEventListener('pageshow', (e) => e.persisted && document.body.classList.remove('page-leave'));

  // ---- active nav link ----
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.includes('#') || a.classList.contains('cta')) return;
    if ((href || 'index.html') === page) a.classList.add('active');
  });

  // ---- scroll reveal ----
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    }),
    { threshold: 0.15 }
  );
  const observe = () => document.querySelectorAll('.reveal:not(.in), .step-card:not(.in), .vis:not(.in)').forEach((el) => io.observe(el));
  observe();
  window.TimeBackReveal = observe;

  // ---- count-ups: <span data-count="14.6" data-decimals="1"> ----
  const cio = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    cio.unobserve(en.target);
    const el = en.target;
    const target = Number(el.dataset.count);
    const dec = Number(el.dataset.decimals || 0);
    const pre = el.dataset.prefix || '';
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 1200);
      el.textContent = pre + (target * (1 - Math.pow(1 - k, 3))).toFixed(dec);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: 0.4 });
  document.querySelectorAll('[data-count]').forEach((el) => cio.observe(el));

  // ---- parallax: data-speed (scroll) and data-depth (mouse) ----
  const layers = [...document.querySelectorAll('[data-speed], [data-depth]')];
  const progress = document.querySelector('.progress');
  const fill = document.querySelector('.steps-line .fill');
  let mx = 0, my = 0, ticking = false;

  function frame() {
    ticking = false;
    const y = scrollY;
    if (!reduce) {
      for (const el of layers) {
        const speed = innerWidth < 960 ? 0 : Number(el.dataset.speed || 0);
        const depth = Number(el.dataset.depth || 0);
        const rect = el.parentElement.getBoundingClientRect();
        const offset = (rect.top + rect.height / 2 - innerHeight / 2) * -speed;
        el.style.transform = `translate3d(${mx * depth}px, ${my * depth + offset}px, 0)`;
      }
    }
    if (progress) {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    }
    if (fill) {
      const box = fill.parentElement.getBoundingClientRect();
      const done = Math.min(1, Math.max(0, (innerHeight * 0.6 - box.top) / box.height));
      fill.style.height = `${done * (box.height - 16)}px`;
    }
  }
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  addEventListener('mousemove', (e) => {
    mx = (e.clientX / innerWidth - 0.5) * 2;
    my = (e.clientY / innerHeight - 0.5) * 2;
    request();
  }, { passive: true });
  frame();
})();
