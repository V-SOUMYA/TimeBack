# TimeBack

**An AI agent that buys back your time.**

Tell TimeBack about your week and your budget, for example *"I have two exams next week and $150. Free up as much time as possible."* It works out which chores are worth handing off and picks the services that save the most **hours per dollar**. It haggles with providers for a better price, fits everything around your fixed commitments, and books it all in one **PayPal** checkout.

Most shopping tools optimize for the lowest price. TimeBack optimizes for **time saved per dollar**, because when you're busy, time is what you're really buying.

Built for *Build What's Next with PayPal and AI*.

---

## What it does

1. **Understands your week.** You write in plain English. The AI agent turns it into a structured request: budget, tasks worth delegating, tasks you want to keep, fixed commitments like exams, and preferences like greener options or minimum ratings.
2. **Builds the best plan.** An exact optimizer (multiple-choice knapsack) picks at most one provider per task to maximize hours saved within budget. The AI handles the language and the reasoning; the math is exact, so the plan can't be "hallucinated."
3. **Schedules around your life.** If a delivery clashes with an exam, TimeBack moves it to right after the exam and marks it "↻ moved."
4. **Lets you steer in the grid.** Every option is a row in an AG Grid. Tick or untick to lock or drop an option, change the budget, or toggle "Prefer eco," and the plan re-optimizes instantly. A pinned totals row and a "minutes per dollar" bar show the trade-offs at a glance.
5. **Haggles for you.** Click **Haggle** and your buyer agent negotiates with the provider's seller agent. The seller has a hidden floor price. The agreed price is stored server-side and flows straight into checkout.
6. **Books with PayPal.** One PayPal Orders v2 checkout with a line item per service. After capture, the rows flip to **Booked** and you see how many hours you bought back.

## Pages

| Page | What it does |
|---|---|
| `index.html` (Home) | Landing page with a parallax hero, a "How it works" timeline, feature sections and the request box. "Plan my week" opens the planner with your request. |
| `plan.html` (Planner) | The agent's live plan: free-hours card, AG Grid options, haggling drawer, week view and PayPal checkout. |
| `booked.html` (Booked) | Confirmation after payment: hours bought back, what was booked and when, and the PayPal order details. |

## Design

- **Ombre glass UI:** frosted glass cards over a smoky ombre backdrop, with color blooms inside the stat tiles.
- **Dynamic palette:** each chore category (food, home, errands, travel, study) has its own palette. When a service is in focus in a carousel, the whole page background shifts to its colors.
- **Dot-matrix numerals:** key numbers (free hours, money, ratios) are rendered as LED-style dot grids that morph between values.
- **Coverflow carousels:** 3D card carousels for chores (Home), your picks (Planner) and your booked week (Booked), with a player-style detail bar.
- **Instrument controls:** tick-ruler gauges with a marker, a draggable budget ruler, a live wave line, day pills and an on/off switch.
- **Motion:** parallax phone mockups in the hero, scroll reveals, page transitions, and reduced-motion support.

All UI components live in `public/ui.js` with no dependencies.

## Demo flow (about 2 minutes)

1. Click **Exam week**, then **Plan my week** → "14.2 hours freed for $148."
2. Untick a recommended option → TimeBack picks the next-best one and re-explains.
3. Click **Haggle** on cleaning → watch the agents negotiate ($30 → $26.26).
4. Pay with PayPal (sandbox) → **"14.6 hours bought back."**

---

## Tech stack

| Layer | Tool | How it's used |
|---|---|---|
| Payments | **PayPal Orders v2 API** + **PayPal JS SDK** (sandbox) | Server creates an order with one item per booked service (prices re-derived server-side, including negotiated deals), PayPal Smart Buttons handle approval, server captures the payment. |
| AI | **Anthropic Claude** (Messages API, `claude-sonnet-4-5` by default) | 1) Parses the user's free-text request into a structured plan request. 2) Explains the chosen plan and its trade-offs in plain English. 3) Writes the buyer and seller agents' lines during haggling. |
| Data grid | **AG Grid Community 32** | The main decision UI: custom cell renderers (checkbox picker, value bars, status pills, haggle button, strike-through negotiated prices), value getters, row class rules, pinned totals row, quick filter, column filters, `getRowId` with animated re-sorting on re-plan. |
| Server | Node.js + Express | API, optimizer, negotiation engine, PayPal integration. |
| Hosting | Render (`render.yaml` included) | One-click deploy for the hosted demo. |

### Where the AI is, and where it deliberately isn't

- **AI decides:** what you meant, which tasks fit your situation, when your fixed commitments are, how to explain the plan, and how the agents talk.
- **Code decides:** prices, the optimal plan, and the negotiation's numbers. The seller's floor price is never sent to the client or the model, and checkout prices are always recomputed on the server.

This keeps the experience smart while making sure the money side is correct and can't be manipulated from the browser.

---

## Run it locally

Requirements: Node.js 18+.

```bash
git clone https://github.com/V-SOUMYA/TimeBack.git
cd TimeBack
npm install
cp .env.example .env   # then fill in the keys below (optional)
npm start
```

Open http://localhost:3000.

### Keys (both optional, so judges can run it instantly)

| Variable | Where to get it | Without it |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox) → Apps & Credentials → Sandbox app | Checkout runs in **demo mode** (same flow, simulated order) |
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/) | A **rule-based fallback** parses requests and writes explanations |

The badges in the top-right corner show which mode is active.

### Offline demo mode

If the page can't reach the server (for example you open `public/index.html` directly), TimeBack switches to an in-browser engine automatically. It uses the same optimizer and negotiation code as the server, a rule-based request parser instead of Claude, and a simulated checkout. Run `npm start` for the full version with Claude and PayPal.

To pay in sandbox, log in with a **sandbox personal account** from the PayPal Developer Dashboard (Testing Tools → Sandbox Accounts).

### Tests

```bash
npm test
```

Checks that the optimizer stays within budget, matches a brute-force optimum, respects locked and excluded options, and that negotiation never goes below the seller's floor.

### Deploy to Render

Push to GitHub, create a new **Blueprint** on Render pointing at this repo (it reads `render.yaml`), then add the three secret env vars.

---

## Project structure

```
server.js            Express API: /api/plan, /api/optimize, /api/negotiate, /api/orders
src/ai.js            Claude calls: request parsing, plan explanation, negotiation lines (+ fallback)
src/paypal.js        PayPal OAuth, create order, capture order
data/providers.json  Simulated sandbox service providers
public/              Front end: index.html (home), plan.html (planner), booked.html (confirmation),
                     app.js (planner logic), ui.js (dot-matrix, coverflow, rulers, wave, dynamic palette),
                     site.js (page transitions, parallax, scroll reveal)
public/shared/       Code shared by server and browser: optimizer (multiple-choice knapsack +
                     rescheduling), negotiation engine, offline engine, generated catalog
scripts/             build-catalog.js (copies data/providers.json for the browser)
test/                Node test runner tests
```

## Notes

- Service providers are **simulated sandbox merchants** with realistic prices. In production, these would be real local service providers paid through PayPal.
- All payments run in the PayPal **sandbox**. No real money moves.

## Roadmap

- Bryntum Scheduler for a drag-and-drop week view
- Real provider onboarding with PayPal multiparty payouts to each merchant
- Recurring plans ("every exam week") with PayPal vault

## License

MIT, see [LICENSE](LICENSE).
