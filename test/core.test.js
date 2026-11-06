const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../data/providers.json');
const { optimize } = require('../src/optimizer');
const { negotiate } = require('../src/negotiate');

const options = catalog.providers.map((p) => ({ ...p, basePrice: p.price, taskLabel: p.task }));
const allTasks = catalog.tasks.map((t) => t.id);

test('plan stays within budget and picks at most one option per task', () => {
  const plan = optimize({ options, tasks: allTasks, budget: 150 });
  assert.ok(plan.spent <= 150);
  const tasks = plan.rows.filter((r) => r.status === 'Recommended').map((r) => r.task);
  assert.strictEqual(new Set(tasks).size, tasks.length);
  assert.ok(plan.hoursSaved > 10);
});

test('plan is optimal versus brute force on a small case', () => {
  const tasks = ['groceries', 'laundry', 'cleaning', 'errands'];
  const budget = 60;
  const plan = optimize({ options, tasks, budget });
  const groups = tasks.map((t) => [null, ...options.filter((o) => o.task === t)]);
  let best = 0;
  const walk = (i, cost, hours) => {
    if (cost > budget + 1e-9) return;
    if (i === groups.length) { best = Math.max(best, hours); return; }
    for (const o of groups[i]) walk(i + 1, cost + (o ? o.price : 0), hours + (o ? o.hoursSaved : 0));
  };
  walk(0, 0, 0);
  assert.ok(Math.abs(plan.hoursSaved - best) < 0.5, `got ${plan.hoursSaved}, best ${best}`);
});

test('locked and excluded options are respected', () => {
  const plan = optimize({ options, tasks: allTasks, budget: 150, locked: ['la-3'], excluded: ['mp-2'] });
  const chosen = plan.chosenIds;
  assert.ok(chosen.includes('la-3'));
  assert.ok(!chosen.includes('mp-2'));
});

test('negotiation never goes below the seller floor', () => {
  for (const p of catalog.providers) {
    const r = negotiate({ basePrice: p.price, floor: p.floor });
    assert.ok(r.price >= p.floor - 0.01 && r.price <= p.price, `${p.id}: ${r.price}`);
  }
});
