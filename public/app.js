/* global agGrid, paypal */
const state = {
  config: null,
  request: null,
  plan: null,
  locked: new Set(),
  excluded: new Set(),
  deals: {}, // optionId -> { dealId, price, saved }
  booked: false,
  gridApi: null,
};

const EXAMPLES = [
  'I have two exams next week and $150. Help me free up as much time as possible. I\'d like greener options if they\'re close in price, and I want to keep doing my own commute.',
  'Work deadline Thursday, $80 to spend. I hate laundry and cleaning.',
  'New parent, no sleep, $250 budget. Food and home stuff please, only well-rated services.',
];

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toFixed(2)}`;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- init ----------
async function init() {
  setupReveal();
  try {
    state.config = await api('/api/config');
  } catch (err) {
    $('hcTag').textContent = 'Offline';
    $('steps').innerHTML = '<li class="err">Can\'t reach the TimeBack server. Run <code>npm install</code> and <code>npm start</code>, then open http://localhost:3000.</li>';
    return;
  }
  $('badges').innerHTML = [
    badge(state.config.aiEnabled ? `AI: ${state.config.model}` : 'AI: rules fallback', state.config.aiEnabled),
    badge(state.config.paypalEnabled ? 'PayPal sandbox' : 'PayPal demo mode', state.config.paypalEnabled),
  ].join('');

  $('examples').innerHTML = EXAMPLES.map((e, i) => `<button class="chip" data-i="${i}">${['Exam week', 'Work crunch', 'New parent'][i]}</button>`).join('');
  $('examples').addEventListener('click', (e) => {
    const i = e.target.dataset.i;
    if (i !== undefined) {
      $('prompt').value = EXAMPLES[i];
      plan();
    }
  });

  $('planBtn').addEventListener('click', () => plan());
  $('budgetInput').addEventListener('change', () => replan(true));
  $('ecoToggle').addEventListener('change', () => replan(true));
  $('quickFilter').addEventListener('input', (e) => state.gridApi && state.gridApi.setGridOption('quickFilterText', e.target.value));
  $('resetBtn').addEventListener('click', () => {
    state.locked.clear();
    state.excluded.clear();
    replan(true);
  });
  $('drawerClose').addEventListener('click', () => $('drawer').classList.add('hidden'));
  $('demoPay').addEventListener('click', demoCheckout);

  createGrid();
  if (state.config.paypalEnabled) loadPayPal();
  // Show a real plan straight away so there's never an empty screen.
  plan({ auto: true });
}

function badge(text, on) {
  return `<span class="badge ${on ? 'on' : ''}">${text}</span>`;
}

// ---------- planning ----------
async function plan({ auto = false } = {}) {
  const btn = $('planBtn');
  btn.disabled = true;
  btn.textContent = 'Planning…';
  $('hcTag').textContent = 'Planning…';
  $('hcTag').className = 'hc-tag busy';
  $('steps').innerHTML = '';
  const first = addStep('Reading your week…', true);
  try {
    state.locked.clear();
    state.excluded.clear();
    state.deals = {};
    state.booked = false;
    $('receipt').classList.add('hidden');
    const [data] = await Promise.all([api('/api/plan', { text: $('prompt').value }), sleep(700)]);
    first.classList.remove('live');
    first.textContent = 'Read your week';

    const req = data.request;
    const p = data.plan;
    const exams = req.busy.length;
    const optionCount = p.rows.length;
    const moved = p.rows.filter((r) => r.status === 'Recommended' && r.rescheduledFrom).length;
    const steps = [
      `Budget ${money(req.budget)}${exams ? ` · ${exams} fixed commitment${exams > 1 ? 's' : ''} found` : ''}`,
      `${req.tasks.length} chores worth handing off`,
      `Compared ${optionCount} providers on hours per dollar`,
      moved ? `Moved ${moved} booking${moved > 1 ? 's' : ''} around your commitments` : 'Everything fits around your commitments',
      `Best plan: ${p.chosenIds.length} services for ${money(p.spent)}`,
    ];
    for (const text of steps) {
      await sleep(260);
      addStep(text);
    }

    state.request = req;
    $('budgetInput').value = req.budget;
    $('ecoToggle').checked = req.preferences.sustainable;
    render(data);
    $('results').classList.remove('hidden');
    if (!auto) $('results').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    first.classList.remove('live');
    addStep(err.message).classList.add('err');
    $('hcTag').textContent = 'Error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Plan my week';
  }
}

function addStep(text, live = false) {
  const li = document.createElement('li');
  li.textContent = text;
  if (live) li.classList.add('live');
  $('steps').appendChild(li);
  return li;
}

// ---------- hero card: free hours before -> after ----------
const WAKING_HOURS_PER_DAY = 15; // 7am to 10pm
function renderHero(plan) {
  if (!state.request || !state.config) return;
  const selfHours = Object.fromEntries(state.config.tasks.map((t) => [t.id, t.selfHours]));
  const chosen = plan.rows.filter((r) => ['Recommended', 'Booked'].includes(r.status));
  const choreTotal = state.request.tasks.reduce((s, t) => s + (selfHours[t] || 0), 0);
  const busyByDay = Array(7).fill(0);
  plan.busy.forEach((b) => (busyByDay[b.day] += b.length));
  const busyTotal = busyByDay.reduce((a, b) => a + b, 0);

  const before = WAKING_HOURS_PER_DAY * 7 - busyTotal - choreTotal;
  const after = before + plan.hoursSaved;
  countTo($('hcBefore'), before);
  countTo($('hcAfter'), after);
  countTo($('ringVal'), plan.hoursSaved, (v) => v.toFixed(1));
  const C = 2 * Math.PI * 52;
  const share = choreTotal ? Math.min(1, plan.hoursSaved / choreTotal) : 0;
  $('ringProg').style.strokeDashoffset = String(C * (1 - share));
  $('hcDelta').innerHTML = plan.hoursSaved
    ? `<b>+${plan.hoursSaved} hours</b> for ${money(plan.spent)} · ${((plan.hoursSaved * 60) / Math.max(plan.spent, 1)).toFixed(1)} min per dollar`
    : 'Raise the budget to buy back time';
  $('hcTag').textContent = state.booked ? 'Booked' : 'Plan ready';
  $('hcTag').className = `hc-tag ${state.booked ? 'booked' : 'ready'}`;

  // Two rows of seven day-bars: before and after. Bar height = hours (6h = full).
  const chorePerDay = choreTotal / 7;
  const savedPerDay = Math.min(plan.hoursSaved / 7, chorePerDay);
  const pct = (h) => `${Math.min(100, (h / 6) * 100)}%`;
  const row = (label, after) => {
    const cells = DAYS.map((d, i) => `<div class="sd"><div class="sb">
        <i class="seg busy" style="--i:${i}" data-h="${pct(busyByDay[i])}"></i>
        <i class="seg chore" style="--i:${i}" data-h="${pct(after ? chorePerDay - savedPerDay : chorePerDay)}"></i>
        ${after ? `<i class="seg freed" style="--i:${i + 3}" data-h="${pct(savedPerDay)}"></i>` : ''}
      </div><span>${d[0]}</span></div>`).join('');
    return `<div class="srow"><span class="slabel">${label}</span><div class="sdays">${cells}</div></div>`;
  };
  const strip = $('strip');
  if (!strip.children.length) strip.innerHTML = row('Before', false) + row('After', true);
  else {
    // Update in place so bars animate between plans instead of re-mounting.
    const tmp = document.createElement('div');
    tmp.innerHTML = row('Before', false) + row('After', true);
    const next = tmp.querySelectorAll('.seg');
    strip.querySelectorAll('.seg').forEach((el, i) => next[i] && (el.dataset.h = next[i].dataset.h));
  }
  requestAnimationFrame(() => requestAnimationFrame(() => strip.querySelectorAll('.seg').forEach((el) => (el.style.height = el.dataset.h))));
}

function countTo(el, target, fmt = (v) => v.toFixed(Number.isInteger(target) ? 0 : 1), dur = 900) {
  const start = Number(el.dataset.v || 0);
  if (start === target) { el.textContent = fmt(target); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const v = start + (target - start) * (1 - Math.pow(1 - k, 3));
    el.textContent = fmt(k === 1 ? target : v);
    if (k < 1) requestAnimationFrame(step);
  };
  el.dataset.v = target;
  requestAnimationFrame(step);
  if (start && start !== target) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

async function replan(explain = false) {
  if (!state.request || state.booked) return;
  state.request = {
    ...state.request,
    budget: Number($('budgetInput').value) || state.request.budget,
    preferences: { ...state.request.preferences, sustainable: $('ecoToggle').checked },
  };
  const data = await api('/api/optimize', {
    request: state.request,
    locked: [...state.locked],
    excluded: [...state.excluded],
    dealIds: Object.values(state.deals).map((d) => d.dealId),
    explain,
  });
  render(data);
}

function render({ plan, explanation, request }) {
  state.plan = plan;
  if (request) state.request = request;
  const rows = [...plan.rows].sort((a, b) =>
    a.taskLabel.localeCompare(b.taskLabel) || rank(a.status) - rank(b.status) || b.hoursPerDollar - a.hoursPerDollar
  );
  if (state.booked) rows.forEach((r) => r.status === 'Recommended' && (r.status = 'Booked'));
  const prev = state.prevStatus || {};
  state.gridApi.setGridOption('rowData', rows);
  const changed = rows.filter((r) => prev[r.id] && prev[r.id] !== r.status).map((r) => state.gridApi.getRowNode(r.id)).filter(Boolean);
  if (changed.length) state.gridApi.flashCells({ rowNodes: changed, flashDuration: 700, fadeDuration: 900 });
  state.prevStatus = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  state.gridApi.setGridOption('pinnedBottomRowData', [totalsRow(plan)]);

  countTo($('statHours'), plan.hoursSaved, (v) => `${v.toFixed(1)}h`);
  countTo($('statSpent'), plan.spent, money);
  $('statBudget').textContent = `of ${money(plan.budget)}`;
  countTo($('statRate'), plan.spent ? (plan.hoursSaved * 60) / plan.spent : 0, (v) => v.toFixed(1));
  const haggled = Object.values(state.deals).reduce((s, d) => s + d.saved, 0);
  countTo($('statHaggle'), haggled, money);

  if (explanation) {
    $('explanation').textContent = explanation;
    $('sourcePill').textContent = state.config.aiEnabled ? 'Claude' : 'rules';
  }
  renderWeek(plan);
  renderCart(plan);
  renderHero(plan);
}

const rank = (s) => ({ Booked: 0, Recommended: 0, Alternative: 1, 'Over budget': 2, 'Below rating': 3, Excluded: 4 }[s] ?? 5);

function totalsRow(plan) {
  return {
    id: 'totals',
    taskLabel: 'Total (chosen)',
    provider: `${plan.chosenIds.length} services`,
    price: plan.spent,
    hoursSaved: plan.hoursSaved,
    hoursPerDollar: plan.spent ? plan.hoursSaved / plan.spent : 0,
    isTotal: true,
  };
}

// ---------- AG Grid ----------
function createGrid() {
  const columnDefs = [
    {
      headerName: '',
      field: 'status',
      colId: 'pick',
      width: 52, minWidth: 52,
      cellClass: 'center-cell',
      pinned: 'left',
      sortable: false,
      filter: false,
      cellRenderer: (p) => {
        if (p.data.isTotal) return '';
        const checked = ['Recommended', 'Booked'].includes(p.data.status);
        const disabled = state.booked ? 'disabled' : '';
        return `<input type="checkbox" class="pick" ${checked ? 'checked' : ''} ${disabled} aria-label="Include ${p.data.provider}">`;
      },
      onCellClicked: (p) => togglePick(p.data),
    },
    { headerName: 'Task', field: 'taskLabel', minWidth: 150, flex: 1, filter: 'agTextColumnFilter', tooltipField: 'taskLabel' },
    {
      headerName: 'Provider',
      field: 'provider',
      minWidth: 170,
      flex: 1.2,
      tooltipField: 'provider',
      cellRenderer: (p) => (p.data.isTotal ? `<b>${p.value}</b>` : `${p.value}${p.data.sustainable ? ' <span class="eco" title="Sustainable option">🌱</span>' : ''}`),
    },
    {
      headerName: 'Price',
      field: 'price',
      width: 112,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      cellRenderer: (p) => {
        if (p.data.isTotal) return `<b>${money(p.value)}</b>`;
        if (p.data.dealId) return `<span class="strike">${money(p.data.basePrice)}</span> <b class="deal-price">${money(p.value)}</b>`;
        return money(p.value);
      },
    },
    {
      headerName: 'Hours',
      field: 'hoursSaved',
      width: 84,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => `${Number(p.value).toFixed(1)}h`,
      cellClass: (p) => (p.data.isTotal ? 'bold' : ''),
    },
    {
      headerName: 'Min per $',
      field: 'hoursPerDollar',
      colId: 'value',
      width: 130,
      sort: null,
      filter: 'agNumberColumnFilter',
      headerTooltip: 'Minutes of your life saved per dollar spent. TimeBack optimizes for this, not for the cheapest price.',
      valueGetter: (p) => (p.data.hoursPerDollar || 0) * 60,
      cellRenderer: (p) => {
        const v = p.value || 0;
        const pct = Math.min(100, (v / 12) * 100);
        return `<div class="bar"><div class="bar-fill" style="width:${pct}%"></div><span>${v.toFixed(1)}</span></div>`;
      },
    },
    {
      headerName: 'Rating',
      field: 'rating',
      width: 84,
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value ? `★ ${p.value.toFixed(1)}` : ''),
    },
    {
      headerName: 'When',
      field: 'slotLabel',
      width: 140,
      cellRenderer: (p) => {
        if (p.data.conflict) return `${p.value} <span class="warn" title="Overlaps ${p.data.conflict}">⚠ ${p.data.conflict}</span>`;
        if (p.data.rescheduledFrom) return `${p.value} <span class="moved" title="Moved from ${p.data.rescheduledFrom} to avoid a clash">↻ moved</span>`;
        return p.value || '';
      },
    },
    {
      headerName: 'Status',
      field: 'status',
      width: 128,
      filter: 'agTextColumnFilter',
      cellRenderer: (p) => (p.data.isTotal ? '' : `<span class="status s-${p.value.replace(/\s/g, '-').toLowerCase()}">${p.value === 'Recommended' ? '✓ Picked' : p.value}</span>`),
    },
    {
      headerName: '',
      colId: 'haggle',
      width: 100,
      cellClass: 'center-cell',
      sortable: false,
      filter: false,
      cellRenderer: (p) => {
        if (p.data.isTotal) return '';
        if (p.data.dealId) return `<span class="saved">−${money(p.data.negotiatedSaving)}</span>`;
        if (state.booked) return '';
        return `<button class="haggle">Haggle</button>`;
      },
      onCellClicked: (p) => {
        if (!p.data.isTotal && !p.data.dealId && !state.booked) haggle(p.data);
      },
    },
  ];

  state.gridApi = agGrid.createGrid($('grid'), {
    columnDefs,
    rowData: [],
    getRowId: (p) => p.data.id,
    defaultColDef: { sortable: true, resizable: true, filter: true, floatingFilter: false, enableCellChangeFlash: true },
    rowClassRules: {
      'row-chosen': (p) => ['Recommended', 'Booked'].includes(p.data && p.data.status),
      'row-muted': (p) => ['Over budget', 'Below rating', 'Excluded'].includes(p.data && p.data.status),
    },
    getRowStyle: (p) => (p.node.rowPinned ? { fontWeight: 600, background: 'var(--soft)' } : undefined),
    animateRows: true,
    tooltipShowDelay: 200,
    suppressCellFocus: true,
    domLayout: 'autoHeight',
  });
}

function togglePick(row) {
  if (state.booked || row.isTotal) return;
  const chosen = row.status === 'Recommended';
  if (chosen) {
    state.locked.delete(row.id);
    state.excluded.add(row.id);
  } else {
    // Locking one option for a task replaces any other lock for that task.
    state.plan.rows.filter((r) => r.task === row.task).forEach((r) => state.locked.delete(r.id));
    state.excluded.delete(row.id);
    state.locked.add(row.id);
  }
  replan(true);
}

// ---------- negotiation ----------
async function haggle(row) {
  $('drawer').classList.remove('hidden');
  $('drawerTitle').textContent = `Haggling with ${row.provider}`;
  $('chat').innerHTML = '';
  $('dealSummary').innerHTML = '';
  $('vsSellerName').textContent = row.provider.split(' ')[0];
  $('vsBuyer').textContent = '–';
  $('vsSeller').textContent = money(row.basePrice);
  try {
    const typing = showTyping('buyer');
    const [deal] = await Promise.all([api('/api/negotiate', { optionId: row.id }), sleep(700)]);
    typing.remove();
    for (const [i, line] of deal.transcript.entries()) {
      if (i > 0) {
        const t = showTyping(line.from);
        await sleep(650);
        t.remove();
      }
      $(line.from === 'buyer' ? 'vsBuyer' : 'vsSeller').textContent = money(line.price);
      const el = document.createElement('div');
      el.className = `msg ${line.from}`;
      el.innerHTML = `<div class="who">${line.from === 'buyer' ? 'Your agent' : deal.provider}</div><div>${escapeHtml(line.text)}</div><div class="offer">${money(line.price)}</div>`;
      $('chat').appendChild(el);
      $('chat').scrollTop = $('chat').scrollHeight;
    }
    state.deals[row.id] = { dealId: deal.dealId, price: deal.price, saved: deal.saved };
    $('dealSummary').innerHTML = deal.saved > 0
      ? `Deal: <b>${money(deal.price)}</b> (list ${money(deal.listPrice)}). You save <b>${money(deal.saved)}</b>.`
      : `They held firm at <b>${money(deal.price)}</b>.`;
    await replan(true);
  } catch (err) {
    $('chat').innerHTML = `<div class="msg seller">${escapeHtml(err.message)}</div>`;
  }
}

function showTyping(from) {
  const t = document.createElement('div');
  t.className = `typing ${from}`;
  t.innerHTML = '<i></i><i></i><i></i>';
  $('chat').appendChild(t);
  $('chat').scrollTop = $('chat').scrollHeight;
  return t;
}

// ---------- week view ----------
function renderWeek(plan) {
  const startH = 7;
  const endH = 22;
  const span = endH - startH;
  const chosen = plan.rows.filter((r) => ['Recommended', 'Booked'].includes(r.status));
  let html = '<div class="week-grid">';
  html += '<div class="hours">' + Array.from({ length: span / 3 + 1 }, (_, i) => `<span style="top:${((i * 3) / span) * 100}%">${fmtHour(startH + i * 3)}</span>`).join('') + '</div>';
  let n = 0;
  DAYS.forEach((d, day) => {
    html += `<div class="day"><div class="day-name">${d}</div><div class="day-body">`;
    plan.busy.filter((b) => b.day === day).forEach((b) => {
      html += block(b.start, b.length, b.label, 'busy', startH, span, b.label, n++);
    });
    chosen.filter((r) => r.slot.day === day).forEach((r) => {
      html += block(r.slot.start, r.slot.length, `${r.taskLabel.split(' ')[0]} · ${r.provider.split(' ')[0]}`, 'handled', startH, span, `${r.provider}: saves ${r.hoursSaved}h`, n++);
    });
    html += '</div></div>';
  });
  html += '</div>';
  $('week').innerHTML = html;
}

function block(start, length, label, cls, startH, span, title = label, i = 0) {
  const top = ((Math.max(start, startH) - startH) / span) * 100;
  const h = (Math.min(length, span) / span) * 100;
  return `<div class="blk ${cls}" style="top:${top}%;height:${Math.max(h, 6)}%;--i:${i}" title="${escapeHtml(title)}">${escapeHtml(label)}</div>`;
}

const fmtHour = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;

// ---------- checkout ----------
function renderCart(plan) {
  const chosen = plan.rows.filter((r) => ['Recommended', 'Booked'].includes(r.status));
  if (!chosen.length) {
    $('cart').innerHTML = '<p class="muted">Nothing selected yet.</p>';
  } else {
    $('cart').innerHTML = `
      <ul class="cart-list">${chosen.map((r, i) => `<li style="--i:${i}"><span>${escapeHtml(r.taskLabel)}<small>${escapeHtml(r.provider)}</small></span><b>${money(r.price)}</b></li>`).join('')}</ul>
      <div class="cart-total"><span>Total</span><b>${money(plan.spent)}</b></div>
      <div class="cart-hours">Buys back <b>${plan.hoursSaved} hours</b></div>`;
  }
  const canPay = chosen.length > 0 && !state.booked;
  $('paypal-buttons').classList.toggle('hidden', !canPay || !state.config.paypalEnabled);
  $('demoPay').classList.toggle('hidden', !canPay || state.config.paypalEnabled);
}

function orderPayload() {
  return {
    optionIds: state.plan.chosenIds,
    dealIds: Object.values(state.deals).map((d) => d.dealId),
  };
}

function loadPayPal() {
  const s = document.createElement('script');
  s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(state.config.paypalClientId)}&currency=${state.config.currency}&intent=capture`;
  s.onload = () => {
    paypal
      .Buttons({
        style: { layout: 'vertical', shape: 'pill', label: 'pay' },
        createOrder: async () => (await api('/api/orders', orderPayload())).id,
        onApprove: async (data) => {
          const result = await api(`/api/orders/${data.orderID}/capture`, {});
          onBooked(result);
        },
        onError: (err) => alertBox(`PayPal error: ${err.message || err}`),
      })
      .render('#paypal-buttons');
  };
  document.head.appendChild(s);
}

async function demoCheckout() {
  const order = await api('/api/orders', orderPayload());
  const result = await api(`/api/orders/${order.id}/capture`, {});
  onBooked(result);
}

function onBooked(result) {
  state.booked = true;
  render({ plan: state.plan });
  $('receipt').classList.remove('hidden');
  $('receipt').innerHTML = `
    <div class="receipt-big">${state.plan.hoursSaved} hours bought back</div>
    <p>Payment <b>${result.status}</b>${result.demo ? ' (demo)' : ''} · ${money(result.total ?? state.plan.spent)}</p>
    <p class="muted">PayPal order ${escapeHtml(result.id)}${result.captureId ? ` · capture ${escapeHtml(result.captureId)}` : ''}</p>`;
  state.gridApi.refreshCells({ force: true });
  $('receipt').scrollIntoView({ behavior: 'smooth', block: 'center' });
  confetti();
}

// Small dependency-free confetti burst.
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('confetti');
  const ctx = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#4ff0b0', '#5cc8ff', '#8b6cff', '#ffb547', '#ff6b8b', '#ffc439'];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.55,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 15 - 6,
    s: Math.random() * 6 + 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const tick = (now) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => {
      p.vy += 0.4; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    });
    if (now - t0 < 3200) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(tick);
}

// Fade sections in as they scroll into view.
function setupReveal() {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

// ---------- utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function alertBox(msg) {
  addStep(msg).classList.add('err');
}

init();
