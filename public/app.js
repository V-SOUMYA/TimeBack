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
const UI = window.TimeBackUI;
const money = (n) => `$${Number(n).toFixed(2)}`;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Talks to the Node server. If the server can't be reached (for example the
// page was opened as a file or through an editor preview), it switches to the
// in-browser engine so everything still works as a demo.
async function api(path, body) {
  if (!state.offline) {
    let res;
    let data;
    try {
      res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      data = await res.json();
    } catch (err) {
      return goOffline(path, body);
    }
    if (res.status === 404 || res.status === 405) return goOffline(path, body);
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  return window.TimeBackOffline.call(path, body || {});
}

function goOffline(path, body) {
  if (!window.TimeBackOffline) throw new Error('Could not reach the TimeBack server.');
  state.offline = true;
  console.info('[TimeBack] Server not reachable, running the in-browser demo engine.');
  return window.TimeBackOffline.call(path, body || {});
}

// ---------- init ----------
async function init() {
  const q = new URLSearchParams(location.search).get('q');
  if (q) $('prompt').value = q.slice(0, 2000);
  state.config = await api('/api/config');
  $('badges').innerHTML = state.config.offline
    ? badge('Offline demo · run npm start for Claude + PayPal', false)
    : [
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
  $('budgetInput').addEventListener('input', (e) => {
    UI.dot($('budgetDm'), `$${e.target.value}`);
    UI.ruler($('budgetRuler'), (e.target.value - 20) / 380);
  });
  $('budgetInput').addEventListener('change', () => replan(true));
  $('ecoToggle').addEventListener('change', () => replan(true));
  $('quickFilter').addEventListener('input', (e) => state.gridApi && state.gridApi.setGridOption('quickFilterText', e.target.value));
  $('resetBtn').addEventListener('click', () => {
    state.locked.clear();
    state.excluded.clear();
    replan(true);
  });
  $('drawerClose').addEventListener('click', () => $('drawer').classList.add('hidden'));
  $('dayPills').addEventListener('click', onDayClick);
  $('weekBars').addEventListener('click', onDayClick);
  $('pickInfo').addEventListener('click', onPickAction);
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
  btn.innerHTML = 'Planning… <span class="plus">⏱</span>';
  $('hcTag').textContent = 'Planning…';
  $('hcTag').className = 'tag busy';
  UI.setPalette('plan');
  $('steps').innerHTML = '';
  $('results').classList.add('loading');
  $('hcAfter').dataset.v = 0;
  if (!auto) $('heroCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  const first = addStep('Reading your week…', true);
  try {
    state.locked.clear();
    state.excluded.clear();
    state.deals = {};
    state.booked = false;
    state.day = null;
    state.picksKey = null;
    state.pickId = null;
    $('receipt').classList.add('hidden');
    const [data] = await Promise.all([api('/api/plan', { text: $('prompt').value }), sleep(700)]);
    try { history.replaceState(null, '', `?q=${encodeURIComponent($('prompt').value)}`); } catch (e) { /* file:// may refuse */ }
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
    if (!auto) setTimeout(() => $('results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 900);
  } catch (err) {
    first.classList.remove('live');
    addStep(err.message).classList.add('err');
    $('hcTag').textContent = 'Error';
    $('hcTag').className = 'tag';
  } finally {
    $('results').classList.remove('loading');
    btn.disabled = false;
    btn.innerHTML = 'Plan my week <span class="plus">+</span>';
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
  const choreTotal = state.request.tasks.reduce((s, t) => s + (selfHours[t] || 0), 0);
  const busyTotal = plan.busy.reduce((s, b) => s + b.length, 0);
  const before = WAKING_HOURS_PER_DAY * 7 - busyTotal - choreTotal;
  const after = before + plan.hoursSaved;
  $('hcBefore').textContent = before.toFixed(0);
  $('hcDelta').textContent = `+${plan.hoursSaved}h`;
  UI.countDot($('hcAfter'), after, (v) => v.toFixed(1), 1100);
  UI.wave($('hcWave'), choreTotal ? 0.15 + 0.8 * Math.min(1, plan.hoursSaved / choreTotal) : 0.15);
  $('hcTag').textContent = state.booked ? 'Booked' : 'Plan ready';
  $('hcTag').className = `tag ${state.booked ? 'booked' : 'ready'}`;
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

  const rate = plan.spent ? (plan.hoursSaved * 60) / plan.spent : 0;
  const haggled = Object.values(state.deals).reduce((s, d) => s + d.saved, 0);
  UI.countDot($('statHours'), plan.hoursSaved, (v) => v.toFixed(1));
  UI.countDot($('statSpent'), plan.spent, (v) => `$${v.toFixed(0)}`);
  UI.countDot($('statRate'), rate, (v) => v.toFixed(1));
  UI.countDot($('statHaggle'), haggled, (v) => `$${v.toFixed(2)}`);
  UI.ruler($('rateRuler'), rate / 12);
  $('statBudget').textContent = `${money(plan.spent)} of ${money(plan.budget)} budget`;
  UI.dot($('budgetDm'), `$${Math.round(plan.budget)}`);
  $('budgetInput').value = plan.budget;
  UI.ruler($('budgetRuler'), (plan.budget - 20) / 380);

  if (explanation) {
    $('explanation').textContent = explanation;
    $('sourcePill').textContent = state.config.aiEnabled ? 'Claude' : 'rules';
  }
  renderWeek(plan);
  renderCart(plan);
  renderHero(plan);
  renderPicks(plan);
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
  if (!window.agGrid) {
    $('grid').innerHTML = '<p class="muted">The options grid needs AG Grid. Run <code>npm install</code> and <code>npm start</code>, then open http://localhost:3000.</p>';
    state.gridApi = { setGridOption() {}, getRowNode() {}, flashCells() {}, refreshCells() {} };
    return;
  }
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
  UI.dot($('vsBuyer'), '--');
  UI.dot($('vsSeller'), row.basePrice.toFixed(0));
  UI.setPalette(categoryOf(row.task));
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
      UI.dot($(line.from === 'buyer' ? 'vsBuyer' : 'vsSeller'), line.price.toFixed(2));
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

// ---------- week view: day pills, bars, day timeline ----------
function renderWeek(plan) {
  const chosen = plan.rows.filter((r) => ['Recommended', 'Booked'].includes(r.status));
  const byDay = DAYS.map((_, d) => ({
    busy: plan.busy.filter((b) => b.day === d),
    handled: chosen.filter((r) => r.slot.day === d),
  }));
  if (state.day === undefined || state.day === null) {
    const first = byDay.findIndex((x) => x.handled.length || x.busy.length);
    state.day = first < 0 ? 0 : first;
  }
  $('dayPills').innerHTML = DAYS.map((d, i) => {
    const n = byDay[i].handled.length;
    return `<button type="button" data-day="${i}" class="${i === state.day ? 'on' : ''}" aria-label="${d}">${d[0]}${n ? `<span class="n">${n}</span>` : ''}</button>`;
  }).join('');
  const maxH = 6;
  $('weekBars').innerHTML = byDay.map((x, i) => {
    const busyH = x.busy.reduce((s, b) => s + b.length, 0);
    const freeH = x.handled.reduce((s, r) => s + r.hoursSaved, 0);
    return `<div class="wb ${i === state.day ? 'on' : ''}" data-day="${i}" title="${DAYS[i]}: ${busyH}h commitments, ${freeH.toFixed(1)}h bought back">
      <i class="b-busy" style="height:${(Math.min(busyH, maxH) / maxH) * 100}%"></i><i class="b-free" style="height:${(Math.min(freeH, maxH) / maxH) * 100}%"></i></div>`;
  }).join('');
  const day = byDay[state.day];
  const items = [
    ...day.busy.map((b) => ({ start: b.start, html: `<li class="busy"><span class="tm">${fmtTime(b.start)}</span><span>${escapeHtml(b.label)}<small>${b.length}h · fixed commitment</small></span><span></span></li>` })),
    ...day.handled.map((r) => ({ start: r.slot.start, html: `<li class="handled"><span class="tm">${fmtTime(r.slot.start)}</span><span>${escapeHtml(r.taskLabel)}<small>${escapeHtml(r.provider)}${r.rescheduledFrom ? ' · moved to avoid a clash' : ''}</small></span><b class="saved">+${r.hoursSaved}h</b></li>` })),
  ].sort((a, b) => a.start - b.start);
  $('dayList').innerHTML = items.length
    ? items.map((x, i) => x.html.replace('<li ', `<li style="--d:${i * 60}ms" `)).join('')
    : '<li class="empty">Nothing booked this day. Enjoy it.</li>';
}

function onDayClick(e) {
  const el = e.target.closest('[data-day]');
  if (!el) return;
  state.day = Number(el.dataset.day);
  renderWeek(state.plan);
}

const fmtTime = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;

// ---------- picks coverflow (dynamic palette) ----------
function categoryOf(taskId) {
  const t = state.config.tasks.find((x) => x.id === taskId);
  return (t && t.category) || 'home';
}

function renderPicks(plan) {
  const chosen = plan.rows.filter((r) => ['Recommended', 'Booked'].includes(r.status));
  const key = chosen.map((r) => `${r.id}:${r.price}:${r.status}`).join('|');
  if (key === state.picksKey) return;
  state.picksKey = key;
  if (!chosen.length) {
    $('picks').innerHTML = '<p class="muted" style="text-align:center;padding:40px 0">No services picked yet. Raise the budget or tick an option.</p>';
    $('pickInfo').innerHTML = '';
    return;
  }
  const keepId = state.pickId;
  const start = Math.max(0, chosen.findIndex((r) => r.id === keepId));
  UI.coverflow($('picks'), chosen, {
    start,
    render: (r) => `${UI.art(categoryOf(r.task))}<div class="cf-meta"><b>${escapeHtml(r.taskLabel)}</b><span>${escapeHtml(r.provider)}</span><span class="bars"><i></i><i></i><i></i><i></i><i></i></span></div>`,
    onFocus: (r) => {
      state.pickId = r.id;
      UI.setPalette(categoryOf(r.task));
      const share = Math.min(100, (r.hoursSaved / (r.selfHours || r.hoursSaved)) * 100);
      $('pickInfo').innerHTML = `<div class="thumb">${UI.art(categoryOf(r.task))}</div>
        <div class="info"><b>${escapeHtml(r.provider)}</b><span>${escapeHtml(r.taskLabel)} · ${escapeHtml(r.slotLabel)} · saves ${r.hoursSaved}h of ${r.selfHours}h · ${r.dealId ? `<s>${money(r.basePrice)}</s> ` : ''}${money(r.price)}</span>
        <div class="track"><i style="width:${share}%"></i></div></div>
        <div class="acts">${r.dealId || state.booked ? '' : `<button class="ghost" data-act="haggle">Haggle</button>`}${state.booked ? '' : `<button class="ghost" data-act="drop">Drop</button>`}</div>`;
    },
  });
}

function onPickAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !state.pickId) return;
  const row = state.plan.rows.find((r) => r.id === state.pickId);
  if (!row) return;
  if (btn.dataset.act === 'haggle') haggle(row);
  if (btn.dataset.act === 'drop') togglePick(row);
}

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
  UI.setPalette('booked');
  render({ plan: state.plan });
  const chosen = state.plan.rows.filter((r) => ['Recommended', 'Booked'].includes(r.status));
  const booking = {
    hoursSaved: state.plan.hoursSaved,
    spent: result.total ?? state.plan.spent,
    haggled: Object.values(state.deals).reduce((s, d) => s + d.saved, 0),
    status: result.status,
    demo: Boolean(result.demo),
    orderId: result.id,
    captureId: result.captureId || null,
    items: chosen
      .sort((x, y) => x.slot.day - y.slot.day || x.slot.start - y.slot.start)
      .map((r) => ({ task: r.taskLabel, provider: r.provider, price: r.price, when: r.slotLabel, hours: r.hoursSaved, deal: Boolean(r.dealId) })),
  };
  try { sessionStorage.setItem('timeback:booking', JSON.stringify(booking)); } catch (e) { /* private mode */ }
  $('hcTag').textContent = 'Booked';
  $('receipt').classList.remove('hidden');
  $('receipt').innerHTML = '<div class="receipt-big">Payment complete</div><p>Opening your confirmation…</p>';
  const href = `booked.html#${encodeURIComponent(JSON.stringify(booking))}`;
  setTimeout(() => (window.TimeBackNav ? window.TimeBackNav.go(href) : (location.href = href)), 700);
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
