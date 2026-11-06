// AI layer. Uses the Anthropic Messages API when ANTHROPIC_API_KEY is set.
// Without a key, a rule-based fallback keeps the app fully runnable for judges.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function callClaude(system, user, maxTokens = 1200) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content.map((c) => c.text || '').join('').trim();
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in model output');
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- 1. Understand the request ----------

const PARSE_SYSTEM = `You are TimeBack, an agent that helps busy people buy back their time.
Turn the user's message into a JSON plan request. Reply with JSON only, no prose.
Schema:
{
  "budget": number (USD, default 100 if not given),
  "tasks": string[] (ids from the task list that are worth delegating for this person),
  "preferences": { "sustainable": boolean, "minRating": number (0-5) },
  "busy": [{ "day": 0-6 (0=Mon), "start": 0-23, "length": hours, "label": string }],
  "goal": string (one short sentence restating what the user wants)
}
Rules:
- Only use task ids from the provided list.
- Include tasks the user mentions, plus ones that clearly help their situation.
- Leave out tasks the user says they want to do themselves.
- Put exams, classes, shifts and other fixed events into "busy" with sensible times if not given (exams are usually 9am-12pm).
- sustainable=true if the user mentions eco, green, sustainable or environment.`;

async function parseRequest(text, catalog) {
  if (!aiEnabled()) return fallbackParse(text, catalog);
  const taskList = catalog.tasks.map((t) => `- ${t.id}: ${t.label} (~${t.selfHours}h if done yourself)`).join('\n');
  try {
    const out = await callClaude(PARSE_SYSTEM, `Task list:\n${taskList}\n\nUser message:\n${text}`, 800);
    const parsed = extractJson(out);
    return sanitizeRequest(parsed, catalog, 'claude');
  } catch (err) {
    console.warn('[ai] parse failed, using fallback:', err.message);
    return fallbackParse(text, catalog);
  }
}

function sanitizeRequest(p, catalog, source) {
  const validTasks = new Set(catalog.tasks.map((t) => t.id));
  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).filter((t) => validTasks.has(t));
  const busy = (Array.isArray(p.busy) ? p.busy : [])
    .map((b) => ({
      day: clamp(parseInt(b.day, 10), 0, 6),
      start: clamp(parseInt(b.start, 10), 0, 23),
      length: clamp(Number(b.length) || 1, 1, 12),
      label: String(b.label || 'Busy').slice(0, 40),
    }))
    .filter((b) => Number.isFinite(b.day) && Number.isFinite(b.start));
  return {
    budget: clamp(Number(p.budget) || 100, 1, 5000),
    tasks: tasks.length ? tasks : catalog.tasks.map((t) => t.id),
    preferences: {
      sustainable: Boolean(p.preferences && p.preferences.sustainable),
      minRating: clamp(Number(p.preferences && p.preferences.minRating) || 0, 0, 5),
    },
    busy,
    goal: String(p.goal || 'Free up as much time as possible.').slice(0, 200),
    source,
  };
}

function fallbackParse(text, catalog) {
  const lower = text.toLowerCase();
  const money = lower.match(/\$\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:dollars|usd|bucks)/);
  const budget = money ? Number(money[1] || money[2]) : 100;

  const excludedByUser = catalog.tasks.filter((t) =>
    t.keywords.some((k) => new RegExp(`(?:not|don't|dont|no|myself|own|keep doing|i'll do)[^.]{0,25}${k}|${k}[^.]{0,25}myself`).test(lower))
  );
  let tasks = catalog.tasks.filter((t) => t.keywords.some((k) => lower.includes(k))).map((t) => t.id);
  if (tasks.length < 3) tasks = catalog.tasks.map((t) => t.id);
  tasks = tasks.filter((id) => !excludedByUser.some((t) => t.id === id));

  const busy = [];
  const examCount = (lower.match(/exam|final|midterm|test/g) || []).length;
  if (examCount) {
    [1, 3].forEach((day, i) => busy.push({ day, start: 9, length: 3, label: `Exam ${i + 1}` }));
  }
  return {
    budget,
    tasks,
    preferences: { sustainable: /eco|green|sustainab|environment/.test(lower), minRating: 0 },
    busy,
    goal: 'Free up as much time as possible within budget.',
    source: 'rules',
  };
}

// ---------- 2. Explain the plan ----------

const EXPLAIN_SYSTEM = `You are TimeBack. Explain a delegation plan to the user in plain, warm English.
Max 90 words. Lead with the total hours freed and money spent.
Mention 1-2 smart trade-offs (e.g. why a pricier option was worth it per hour, or a greener pick).
Mention any delivery TimeBack moved to avoid a clash, or any remaining conflict. No markdown headings, no bullet lists.`;

async function explainPlan(plan, request) {
  const chosen = plan.rows.filter((r) => r.status === 'Recommended');
  if (!aiEnabled()) return fallbackExplain(plan, chosen);
  const summary = {
    goal: request.goal,
    budget: plan.budget,
    spent: plan.spent,
    hoursSaved: plan.hoursSaved,
    chosen: chosen.map((r) => ({
      task: r.taskLabel,
      provider: r.provider,
      price: r.price,
      hoursSaved: r.hoursSaved,
      hoursPerDollar: Number(r.hoursPerDollar.toFixed(3)),
      sustainable: r.sustainable,
      conflict: r.conflict,
      movedFrom: r.rescheduledFrom,
    })),
    skippedTasks: request.tasks.filter((t) => !chosen.some((c) => c.task === t)),
  };
  try {
    return await callClaude(EXPLAIN_SYSTEM, JSON.stringify(summary), 300);
  } catch (err) {
    console.warn('[ai] explain failed, using fallback:', err.message);
    return fallbackExplain(plan, chosen);
  }
}

function fallbackExplain(plan, chosen) {
  if (!chosen.length) return `Nothing fits a $${plan.budget} budget yet. Try raising it a little.`;
  const best = [...chosen].sort((a, b) => b.hoursPerDollar - a.hoursPerDollar)[0];
  const conflicts = chosen.filter((c) => c.conflict);
  let text = `This plan frees about ${plan.hoursSaved} hours for $${plan.spent.toFixed(2)}. `;
  text += `Best value is ${best.provider} for ${best.taskLabel.toLowerCase()}, at ${(best.hoursPerDollar * 60).toFixed(1)} minutes saved per dollar. `;
  if (plan.remaining > 0) text += `You keep $${plan.remaining.toFixed(2)} spare. `;
  if (conflicts.length) text += `Heads up: ${conflicts[0].provider} overlaps with ${conflicts[0].conflict}.`;
  return text.trim();
}

// ---------- 3. Negotiation messages ----------

const NEGOTIATE_SYSTEM = `You write short chat lines for a price negotiation between a buyer agent (TimeBack, acting for a busy student) and a seller agent.
You get the exact numbers for each round. Keep every number exactly as given. One sentence per line, friendly and natural.
Reply with JSON only: { "lines": [ { "from": "buyer"|"seller", "text": string } ] } in the same order as the rounds.`;

async function phraseNegotiation(provider, rounds) {
  const templated = rounds.map((r, i) => ({ from: r.from, text: templateLine(provider, { ...r, round: i }) }));
  if (!aiEnabled()) return templated;
  try {
    const out = await callClaude(
      NEGOTIATE_SYSTEM,
      JSON.stringify({ seller: provider.provider, service: provider.taskLabel, listPrice: provider.basePrice, rounds }),
      600
    );
    const { lines } = extractJson(out);
    if (Array.isArray(lines) && lines.length === rounds.length) {
      return lines.map((l, i) => ({ from: rounds[i].from, text: String(l.text).slice(0, 240) }));
    }
  } catch (err) {
    console.warn('[ai] negotiation phrasing failed, using templates:', err.message);
  }
  return templated;
}

function templateLine(provider, r) {
  const p = `$${r.price.toFixed(2)}`;
  switch (r.type) {
    case 'open':
      return `Hi! I'm booking ${provider.taskLabel.toLowerCase()} for a student during exam week. Could you do ${p}?`;
    case 'counter':
      return `We can't go that low, but I can offer ${p}.`;
    case 'raise':
      return r.round % 2
        ? `Meeting you partway: ${p}, and I'll leave a review after.`
        : `I can bundle this with a repeat booking. How about ${p}?`;
    case 'accept':
      return `Deal at ${p}. Booking it now.`;
    case 'final':
      return `${p} is the best we can do.`;
    default:
      return p;
  }
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

module.exports = { aiEnabled, parseRequest, explainPlan, phraseNegotiation, MODEL };
