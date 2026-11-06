// Picks at most one provider per task to maximise hours saved within a budget.
// This is a multiple-choice knapsack solved with dynamic programming over cents,
// so the plan is provably optimal for the inputs (no LLM guessing on the math).

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function overlaps(a, b) {
  return a.day === b.day && a.start < b.start + b.length && b.start < a.start + a.length;
}

function scoreOption(opt, prefs) {
  // Hours saved is the main objective. Small bonuses act as tie-breakers so that
  // a better-rated or greener option wins when time saved is about equal.
  let score = opt.hoursSaved;
  score += (opt.rating - 4) * 0.15;
  if (prefs.sustainable && opt.sustainable) score += 0.4;
  if (opt.conflict) score -= 0.5;
  return score;
}

/**
 * @param {object} args
 * @param {Array} args.options   provider options (with effective `price`)
 * @param {Array<string>} args.tasks task ids the user wants help with
 * @param {number} args.budget   dollars
 * @param {object} args.preferences { sustainable, minRating }
 * @param {Array} args.busy      blocked calendar slots [{day,start,length,label}]
 * @param {Array<string>} args.locked   option ids that must be included
 * @param {Array<string>} args.excluded option ids that must not be included
 */
function optimize({ options, tasks, budget, preferences = {}, busy = [], locked = [], excluded = [] }) {
  const prefs = { sustainable: false, minRating: 0, ...preferences };
  const taskSet = new Set(tasks);
  const lockedSet = new Set(locked);
  const excludedSet = new Set(excluded);

  const candidates = options
    .filter((o) => taskSet.has(o.task))
    .map((o) => {
      // If a delivery clashes with a fixed commitment, move it to right after it.
      let slot = o.slot;
      let rescheduledFrom = null;
      let clash = busy.find((b) => overlaps(slot, b));
      for (let tries = 0; clash && tries < 4; tries++) {
        const start = clash.start + clash.length;
        if (start + slot.length > 22) break;
        rescheduledFrom = rescheduledFrom || slotLabel(o.slot);
        slot = { ...slot, start };
        clash = busy.find((b) => overlaps(slot, b));
      }
      return { ...o, slot, rescheduledFrom: clash ? null : rescheduledFrom, conflict: clash ? clash.label : null };
    })
    .map((o) => ({
      ...o,
      hoursPerDollar: o.price > 0 ? o.hoursSaved / o.price : 0,
      score: scoreOption(o, prefs),
      eligible: !excludedSet.has(o.id) && (o.rating >= prefs.minRating || lockedSet.has(o.id)),
    }));

  // Group by task. A locked option forces that task's choice.
  const groups = [];
  for (const taskId of taskSet) {
    let opts = candidates.filter((c) => c.task === taskId && c.eligible);
    const lockedOpt = opts.find((c) => lockedSet.has(c.id));
    if (lockedOpt) opts = [lockedOpt];
    if (opts.length) groups.push({ taskId, opts, forced: Boolean(lockedOpt) });
  }

  const cap = Math.max(0, Math.round(budget * 100));
  // dp[c] = best score using exactly up to c cents; choice tracking per group.
  const NEG = -Infinity;
  let dp = new Float64Array(cap + 1).fill(0);
  const picks = []; // picks[g][c] = index of option chosen (-1 = none)

  for (let g = 0; g < groups.length; g++) {
    const { opts, forced } = groups[g];
    const next = new Float64Array(cap + 1).fill(NEG);
    const choice = new Int16Array(cap + 1).fill(-1);
    for (let c = 0; c <= cap; c++) {
      if (!forced && dp[c] > next[c]) {
        next[c] = dp[c];
        choice[c] = -1;
      }
      for (let i = 0; i < opts.length; i++) {
        const cost = Math.round(opts[i].price * 100);
        if (cost > c || dp[c - cost] === NEG) continue;
        const val = dp[c - cost] + opts[i].score;
        if (val > next[c]) {
          next[c] = val;
          choice[c] = i;
        }
      }
    }
    picks.push(choice);
    dp = next;
  }

  // Find best capacity, then walk back.
  let bestC = 0;
  for (let c = 0; c <= cap; c++) if (dp[c] > dp[bestC]) bestC = c;
  const chosenIds = new Set();
  let feasible = dp[bestC] !== NEG;
  if (feasible) {
    let c = bestC;
    for (let g = groups.length - 1; g >= 0; g--) {
      const idx = picks[g][c];
      if (idx >= 0) {
        const opt = groups[g].opts[idx];
        chosenIds.add(opt.id);
        c -= Math.round(opt.price * 100);
      }
    }
  }

  const rows = candidates.map((c) => {
    let status = 'Alternative';
    if (chosenIds.has(c.id)) status = 'Recommended';
    else if (excludedSet.has(c.id)) status = 'Excluded';
    else if (!c.eligible) status = 'Below rating';
    else if (c.price > budget) status = 'Over budget';
    return { ...c, status, slotLabel: slotLabel(c.slot) };
  });

  const chosen = rows.filter((r) => r.status === 'Recommended');
  const spent = round2(chosen.reduce((s, r) => s + r.price, 0));
  const hoursSaved = round2(chosen.reduce((s, r) => s + r.hoursSaved, 0));

  return {
    feasible,
    budget,
    spent,
    remaining: round2(budget - spent),
    hoursSaved,
    hoursPerDollar: spent > 0 ? round2(hoursSaved / spent) : 0,
    rows,
    chosenIds: [...chosenIds],
    busy,
  };
}

function slotLabel(slot) {
  const fmt = (h) => {
    const hr = ((h + 11) % 12) + 1;
    return `${hr}${h < 12 ? 'am' : 'pm'}`;
  };
  return `${DAY_NAMES[slot.day]} ${fmt(slot.start)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { optimize, slotLabel, DAY_NAMES, round2 };
