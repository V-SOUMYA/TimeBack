// Offline engine: the same API as server.js, running in the browser.
// Used automatically when the page can't reach the TimeBack server
// (for example when index.html is opened directly). Uses the same optimizer
// and negotiation code as the server, a rule-based parser instead of Claude,
// and a simulated PayPal checkout.
(function (root) {
  const catalog = root.TIMEBACK_CATALOG;
  const { optimize, round2 } = root.TimeBackOptimizer;
  const { negotiate } = root.TimeBackNegotiate;
  const taskById = Object.fromEntries(catalog.tasks.map((t) => [t.id, t]));
  const deals = new Map();
  const orders = new Map();
  let seq = 0;
  const uid = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${(seq++).toString(36).toUpperCase()}`;

  function buildOptions(dealIds = []) {
    const negotiated = {};
    for (const id of dealIds) {
      const d = deals.get(id);
      if (d) negotiated[d.optionId] = d;
    }
    return catalog.providers.map((p) => {
      const deal = negotiated[p.id];
      return {
        id: p.id, task: p.task, taskLabel: taskById[p.task].label, selfHours: taskById[p.task].selfHours,
        provider: p.provider, basePrice: p.price, price: deal ? deal.price : p.price,
        dealId: deal ? deal.id : null, negotiatedSaving: deal ? deal.saved : 0,
        hoursSaved: p.hoursSaved, rating: p.rating, sustainable: p.sustainable, slot: p.slot,
      };
    });
  }

  function run(request, extra = {}) {
    return optimize({
      options: buildOptions(extra.dealIds), tasks: request.tasks, budget: request.budget,
      preferences: request.preferences, busy: request.busy, locked: extra.locked || [], excluded: extra.excluded || [],
    });
  }

  function parse(text) {
    const lower = text.toLowerCase();
    const money = lower.match(/\$\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:dollars|usd|bucks)/);
    const budget = money ? Number(money[1] || money[2]) : 100;
    const keep = catalog.tasks.filter((t) =>
      t.keywords.some((k) => new RegExp(`(?:not|don't|dont|no|myself|own|keep doing|i'll do)[^.]{0,25}${k}|${k}[^.]{0,25}myself`).test(lower))
    );
    let tasks = catalog.tasks.filter((t) => t.keywords.some((k) => lower.includes(k))).map((t) => t.id);
    if (tasks.length < 3) tasks = catalog.tasks.map((t) => t.id);
    tasks = tasks.filter((id) => !keep.some((t) => t.id === id));
    const busy = [];
    if (/exam|final|midterm|test/.test(lower)) [1, 3].forEach((day, i) => busy.push({ day, start: 9, length: 3, label: `Exam ${i + 1}` }));
    const deadline = lower.match(/deadline[^.]*?(mon|tue|wed|thu|fri|sat|sun)/);
    if (deadline) busy.push({ day: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(deadline[1]), start: 9, length: 8, label: 'Deadline' });
    return {
      budget: Math.min(5000, Math.max(1, budget)), tasks,
      preferences: { sustainable: /eco|green|sustainab|environment/.test(lower), minRating: /well[- ]rated|good reviews|top rated/.test(lower) ? 4.5 : 0 },
      busy, goal: 'Free up as much time as possible within budget.', source: 'offline',
    };
  }

  function explain(plan) {
    const chosen = plan.rows.filter((r) => r.status === 'Recommended');
    if (!chosen.length) return `Nothing fits a $${plan.budget} budget yet. Try raising it a little.`;
    const best = [...chosen].sort((a, b) => b.hoursPerDollar - a.hoursPerDollar)[0];
    const moved = chosen.find((c) => c.rescheduledFrom);
    let t = `This plan frees about ${plan.hoursSaved} hours for $${plan.spent.toFixed(2)}. `;
    t += `Best value is ${best.provider} for ${best.taskLabel.toLowerCase()}, at ${(best.hoursPerDollar * 60).toFixed(1)} minutes saved per dollar. `;
    if (moved) t += `I moved ${moved.provider} to ${moved.slotLabel} so it doesn't clash with your plans. `;
    if (plan.remaining > 0) t += `You keep $${plan.remaining.toFixed(2)} spare.`;
    return t.trim();
  }

  function line(provider, r, i) {
    const p = `$${r.price.toFixed(2)}`;
    switch (r.type) {
      case 'open': return `Hi! I'm booking ${provider.taskLabel.toLowerCase()} for a busy week. Could you do ${p}?`;
      case 'counter': return `We can't go that low, but I can offer ${p}.`;
      case 'raise': return i % 2 ? `Meeting you partway: ${p}, and I'll leave a review after.` : `I can bundle this with a repeat booking. How about ${p}?`;
      case 'accept': return `Deal at ${p}. Booking it now.`;
      case 'final': return `${p} is the best we can do.`;
      default: return p;
    }
  }

  async function call(path, body) {
    await new Promise((r) => setTimeout(r, 120));
    if (path === '/api/config') {
      return { aiEnabled: false, model: null, paypalEnabled: false, paypalClientId: null, currency: 'USD', offline: true,
        tasks: catalog.tasks.map(({ id, label, selfHours, category }) => ({ id, label, selfHours, category })) };
    }
    if (path === '/api/plan') {
      const request = parse(String(body.text || ''));
      const plan = run(request);
      return { request, plan, explanation: explain(plan) };
    }
    if (path === '/api/optimize') {
      const request = { ...body.request, tasks: body.request.tasks.filter((t) => taskById[t]) };
      const plan = run(request, body);
      return { request, plan, explanation: body.explain ? explain(plan) : null };
    }
    if (path === '/api/negotiate') {
      const base = catalog.providers.find((p) => p.id === body.optionId);
      const option = buildOptions().find((o) => o.id === base.id);
      const result = negotiate({ ...option, floor: base.floor });
      const id = uid('DEAL');
      deals.set(id, { id, optionId: base.id, price: result.price, saved: result.saved });
      return { dealId: id, optionId: base.id, provider: option.provider, listPrice: option.basePrice, price: result.price, saved: result.saved,
        transcript: result.rounds.map((r, i) => ({ ...r, text: line(option, r, i) })) };
    }
    if (path === '/api/orders') {
      const opts = buildOptions(body.dealIds).filter((o) => body.optionIds.includes(o.id));
      const total = round2(opts.reduce((s, o) => s + o.price, 0));
      const hoursSaved = round2(opts.reduce((s, o) => s + o.hoursSaved, 0));
      const id = uid('DEMO');
      orders.set(id, { total, hoursSaved });
      return { id, demo: true, total, hoursSaved };
    }
    const cap = path.match(/^\/api\/orders\/(.+)\/capture$/);
    if (cap) {
      const o = orders.get(decodeURIComponent(cap[1]));
      if (!o) throw new Error('Unknown demo order');
      return { id: cap[1], status: 'COMPLETED', demo: true, total: o.total, captureId: `CAP-${cap[1].slice(5)}` };
    }
    throw new Error(`Offline mode can't handle ${path}`);
  }

  root.TimeBackOffline = { call };
})(self);
