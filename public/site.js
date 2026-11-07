// Shared page behaviour: transitions, scroll reveal, dot-matrix count-ups,
// parallax (scroll + mouse), progress bar, active nav.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasVT = CSS.supports && CSS.supports('view-transition-name: none');

  // ---- page enter / leave fallback ----
  document.body.classList.add('page-enter');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || (url.hash && url.pathname === location.pathname)) return;
    if (hasVT || reduce) return;
    e.preventDefault();
    leaveTo(url.href);
  });
  function leaveTo(href) {
    document.body.classList.add('page-leave');
    setTimeout(() => (location.href = href), 220);
  }
  window.TimeBackNav = { go: (href) => (hasVT || reduce ? (location.href = href) : leaveTo(href)) };
  addEventListener('pageshow', (e) => e.persisted && document.body.classList.remove('page-leave'));

  // ---- active nav ----
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.includes('#') || a.classList.contains('cta')) return;
    if (href === page) a.classList.add('active');
  });

  // ---- reveal + dot-matrix count-ups ----
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    io.unobserve(en.target);
    en.target.classList.add('in');
    if (en.target.dataset.dot !== undefined && window.TimeBackUI) {
      const el = en.target;
      const dec = Number(el.dataset.decimals || 0);
      const pre = el.dataset.prefix || '';
      TimeBackUI.countDot(el, Number(el.dataset.dot), (v) => pre + v.toFixed(dec), 1400);
    }
    if (en.target.dataset.ruler !== undefined && window.TimeBackUI) TimeBackUI.ruler(en.target, Number(en.target.dataset.ruler));
  }), { threshold: 0.2 });
  const observe = () => document.querySelectorAll('.reveal:not(.in), [data-dot]:not(.in), [data-ruler]:not(.in)').forEach((el) => {
    if (el.dataset.dot !== undefined && window.TimeBackUI) TimeBackUI.dot(el, (el.dataset.prefix || '') + (0).toFixed(Number(el.dataset.decimals || 0)));
    if (el.dataset.ruler !== undefined && window.TimeBackUI) TimeBackUI.ruler(el, 0);
    io.observe(el);
  });
  observe();
  window.TimeBackReveal = observe;

  // ---- parallax ----
  const layers = [...document.querySelectorAll('[data-speed], [data-depth]')];
  const progress = document.querySelector('.progress');
  let mx = 0, my = 0, ticking = false;
  function frame() {
    ticking = false;
    if (!reduce) {
      for (const el of layers) {
        const speed = innerWidth < 1000 ? 0 : Number(el.dataset.speed || 0);
        const depth = innerWidth < 1000 ? 0 : Number(el.dataset.depth || 0);
        const tilt = Number(el.dataset.tilt || 0);
        const rect = el.parentElement.getBoundingClientRect();
        const offset = (rect.top + rect.height / 2 - innerHeight / 2) * -speed;
        el.style.transform = `translate3d(${mx * depth}px, ${my * depth + offset}px, 0) rotate(${tilt + mx * depth * 0.08}deg)`;
      }
    }
    if (progress) {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
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
