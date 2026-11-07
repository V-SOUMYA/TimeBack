require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const catalog = require('./data/providers.json');
const { optimize, round2 } = require('./public/shared/optimizer');
const { negotiate } = require('./public/shared/negotiate');
const ai = require('./src/ai');
const paypal = require('./src/paypal');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve AG Grid from node_modules so the app works offline and pins the exact version.
app.use('/vendor/ag-grid', express.static(path.join(__dirname, 'node_modules/ag-grid-community')));

const taskById = Object.fromEntries(catalog.tasks.map((t) => [t.id, t]));
const optionById = Object.fromEntries(catalog.providers.map((p) => [p.id, p]));

// Negotiated deals live on the server so the client can't set its own prices.
const deals = new Map(); // dealId -> { optionId, price, saved, created }
const demoOrders = new Map();

function buildOptions(dealIds = []) {
  const negotiated = {};
  for (const id of dealIds) {
    const d = deals.get(id);
    if (d) negotiated[d.optionId] = d;
  }
  return catalog.providers.map((p) => {
    const deal = negotiated[p.id];
    return {
      id: p.id,
      task: p.task,
      taskLabel: taskById[p.task].label,
      selfHours: taskById[p.task].selfHours,
      provider: p.provider,
      basePrice: p.price,
      price: deal ? deal.price : p.price,
      dealId: deal ? deal.id : null,
      negotiatedSaving: deal ? deal.saved : 0,
      hoursSaved: p.hoursSaved,
      rating: p.rating,
      sustainable: p.sustainable,
      slot: p.slot,
    };
  });
}

function runOptimizer(request, extra = {}) {
  return optimize({
    options: buildOptions(extra.dealIds),
    tasks: request.tasks,
    budget: request.budget,
    preferences: request.preferences,
    busy: request.busy,
    locked: extra.locked || [],
    excluded: extra.excluded || [],
  });
}

app.get('/api/config', (_req, res) => {
  res.json({
    aiEnabled: ai.aiEnabled(),
    model: ai.aiEnabled() ? ai.MODEL : null,
    paypalEnabled: paypal.paypalEnabled(),
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
    currency: process.env.CURRENCY || 'USD',
    tasks: catalog.tasks.map(({ id, label, selfHours, category }) => ({ id, label, selfHours, category })),
  });
});

// Natural language -> structured request -> optimal plan -> AI explanation.
app.post('/api/plan', async (req, res) => {
  try {
    const text = String(req.body.text || '').slice(0, 2000);
    if (!text.trim()) return res.status(400).json({ error: 'Tell TimeBack what your week looks like.' });
    const request = await ai.parseRequest(text, catalog);
    const plan = runOptimizer(request);
    const explanation = await ai.explainPlan(plan, request);
    res.json({ request, plan, explanation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Re-plan after the user edits the grid (budget, locks, exclusions, deals).
app.post('/api/optimize', async (req, res) => {
  try {
    const { request, locked, excluded, dealIds, explain } = req.body;
    if (!request || !Array.isArray(request.tasks)) return res.status(400).json({ error: 'Missing request' });
    const clean = {
      ...request,
      budget: Math.max(1, Math.min(5000, Number(request.budget) || 0)),
      tasks: request.tasks.filter((t) => taskById[t]),
    };
    const plan = runOptimizer(clean, { locked, excluded, dealIds });
    const explanation = explain ? await ai.explainPlan(plan, clean) : null;
    res.json({ request: clean, plan, explanation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Buyer agent haggles with a seller agent for one option.
app.post('/api/negotiate', async (req, res) => {
  try {
    const base = optionById[req.body.optionId];
    if (!base) return res.status(404).json({ error: 'Unknown option' });
    const option = buildOptions().find((o) => o.id === base.id);
    const result = negotiate({ ...option, floor: base.floor });
    const lines = await ai.phraseNegotiation(option, result.rounds);
    const id = crypto.randomUUID();
    deals.set(id, { id, optionId: base.id, price: result.price, saved: result.saved, created: Date.now() });
    res.json({
      dealId: id,
      optionId: base.id,
      provider: option.provider,
      listPrice: option.basePrice,
      price: result.price,
      saved: result.saved,
      transcript: result.rounds.map((r, i) => ({ ...r, text: lines[i].text })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Create a PayPal order for the selected options. Prices are re-derived server-side.
app.post('/api/orders', async (req, res) => {
  try {
    const { optionIds, dealIds } = req.body;
    if (!Array.isArray(optionIds) || !optionIds.length) return res.status(400).json({ error: 'Nothing selected' });
    const options = buildOptions(dealIds).filter((o) => optionIds.includes(o.id));
    const items = options.map((o) => ({
      sku: o.id,
      name: `${o.taskLabel} - ${o.provider}`,
      description: `Saves ~${o.hoursSaved}h${o.dealId ? ' (negotiated price)' : ''}`,
      price: o.price,
    }));
    const hoursSaved = round2(options.reduce((s, o) => s + o.hoursSaved, 0));
    const total = round2(items.reduce((s, i) => s + i.price, 0));

    if (!paypal.paypalEnabled()) {
      const id = `DEMO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      demoOrders.set(id, { items, total, hoursSaved });
      return res.json({ id, demo: true, total, hoursSaved });
    }
    const order = await paypal.createOrder(items, hoursSaved);
    res.json({ id: order.id, demo: false, total, hoursSaved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/capture', async (req, res) => {
  try {
    const { id } = req.params;
    if (id.startsWith('DEMO-')) {
      const o = demoOrders.get(id);
      if (!o) return res.status(404).json({ error: 'Unknown demo order' });
      return res.json({ id, status: 'COMPLETED', demo: true, total: o.total, captureId: `DEMO-CAP-${id.slice(5)}` });
    }
    const data = await paypal.captureOrder(id);
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    res.json({
      id: data.id,
      status: data.status,
      demo: false,
      total: capture ? Number(capture.amount.value) : null,
      captureId: capture ? capture.id : null,
      payer: data.payer ? data.payer.email_address : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TimeBack running on http://localhost:${PORT}`);
    console.log(`  AI: ${ai.aiEnabled() ? `Claude (${ai.MODEL})` : 'rule-based fallback (set ANTHROPIC_API_KEY)'}`);
    console.log(`  PayPal: ${paypal.paypalEnabled() ? 'sandbox' : 'demo checkout (set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)'}`);
  });
}

module.exports = app;
