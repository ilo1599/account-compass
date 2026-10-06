# Account Compass — HEINEKEN challenge prototype

A historical retention copilot: trained inactivity scores, annualised value-at-risk × actionability priorities, representative onboarding, mixed personal visits and calls, geographic route planning, evidence-based simulated agent briefs, human-approved agenda, outcome capture and calendar export. No live LLM, CRM, customer outreach or calendar connection. Rep preferences are local to the browser; agenda and outcomes last only for the current session.

## Run

[Open the live prototype](https://account-compass-retention.ilo1599.chatgpt.site).

For a local preview, from the repository root:

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000.

Serve `dist` using any static HTTP server, then open `index.html`. Leaflet 1.9.4 is vendored with its licence; no install or API keys are needed. First-use onboarding asks for a dataset city base, visit days, car/public transport, radius, working hours and visit duration. Example: São Paulo/SP, Tuesday + Thursday, car, 50 km, 09:00–17:00, 45-minute visits. Start with Weekly brief → inspect an account → review Visit map → adjust the plan → approve → Agenda → record an outcome, next step and follow-up date. Editing preferences or revising an approved plan explicitly clears the session's agenda/outcomes after confirmation. Reload keeps preferences but clears appointments.

Calendar downloads include contact and travel blocks, historical September 2018 dates and floating local times. Inspect before importing into a real calendar. Follow-up reminders use 10:00 and are not conflict-optimised. They are distinguishable from the route schedule and remain a simple queue.

The app uses real derived records for 2,583 established account areas, of which 2,580 have valid coordinates. Account IDs denote zip-code aggregates as directed by the challenge dataset, not actual bars/shops or identified buyers. Coordinates are postal-area centres; rep bases are median city coordinates with accent variants merged. City/state, categories, aggregate histories, metrics and bounded sanitised review excerpts are shipped. Original raw reviews, personal customer IDs and postal-code columns are excluded.

## Reproduce the model

Install `model/requirements.txt` in a Python environment, then:

```sh
python model/train.py --data /absolute/path/heineken_challenge_dataset
python model/enrich.py --data /absolute/path/heineken_challenge_dataset
node test/priorities.mjs
node test/smoke.mjs
node test/planner.mjs
node test/rep.mjs
```

Training writes `model/model.json` and `dist/data.js`; enrichment writes `dist/context.js`, independently of fitted predictions. The raw dataset is intentionally excluded from the Site source. Generated metadata includes source checksums. The source is reproducible but underlying data must be supplied separately.

Target: no product-backed purchase in the next 90 days. At each snapshot, accounts need 10+ purchases and 180 days of history. Final order status is deliberately not used because status-change timestamps are unavailable. This predicts inactivity, not confirmed permanent churn.

Train: September–November 2017 snapshots (1,265 rows), labels completed before the February 2018 validation snapshot. Select feature set and fit sigmoid calibration: 28 February 2018 (1,235 accounts), outcomes through 29 May. Exploratory evaluation: 31 May 2018 (1,962 accounts), outcomes through 29 August. Score: 31 August 2018, frozen fitted parameters. Repeated accounts across periods simulate existing-account deployment. Deliveries and reviews enter contextual evidence only when their actual timestamps are known.

Four candidate feature sets were compared on February validation AUC. Selected: recency, usual purchase cadence, recency/cadence, recent and previous 90-day order counts, relative order-count change. Penalised logistic regression is implemented with NumPy; transformed features are standardised using training parameters, then a sigmoid calibrator is fitted on validation predictions. The selected model obtained May ROC-AUC 0.746, Brier 0.106 and top-risk-decile inactivity rate 52.8% versus 14.7% overall (3.58× lift). Recency alone achieved 0.753 AUC. May data was inspected during development: these are exploratory metrics, not an untouched final test. A new unseen period, reliability checks, seasonal analysis and real-outlet mapping are required before use in production. Top-decile metrics are for the complete eligible test cohort, not the filtered weekly contact plan.

Monetary values are displayed in Brazilian reais (R$), using Brazilian number formatting. Historical monthly baseline uses days 91–180 before the snapshot divided by three; if absent, last-180-day spend divided by six. Annualised account value = monthly baseline ×12. Annualised value at risk = frozen 90-day inactivity risk × historical monthly baseline ×12. This is an illustrative annual run rate assuming historical spending continues, not a 12-month risk forecast, profit estimate or guaranteed recoverable revenue. Annualisation alone preserves ordering. The prevention queue includes all established accounts with a purchase in the last 90 days, without a minimum risk cutoff; 90+ days inactive remain separate win-back candidates. Territory, rep capacity and explicit deferral determine the weekly contacts. Smaller/new accounts still need a separate cold-start process. The raw generated data retains monthly baseline/exposure fields; the interface and exports provide explicit annual values.

`dist/priorities.js` is the shared planning layer. Default score = annualised value at risk × actionability weight. Apply ×1.25 once if any of: the known average rating in the recent 90-day review window is ≤2/5 (with a dated latest review); any known delivery on recent 90-day purchases was late; or a regular category disappeared (existing rule: ≥3 previous-window purchases, none recently). It is an OR rule, not repeated boosts per issue. Apply ×0.6 when recency is strictly above 4× the actual median cadence. Both combine to ×0.75 when applicable. Missing/old/future rating evidence does not receive the recent-review boost. The weights and silence threshold are editable browser preferences, disabled for an approved plan until the rep revises it. They are heuristics, not save probabilities or measured intervention effects. Setting both weights to 1 restores plain exposure ranking without the cutoff.

Cards and full briefs show raw annual exposure separately from the weighted planning score and explain the adjustments. Visit eligibility and travel-effort ordering use the same policy. Advice aligns service/category remedies to the qualifying issue; safe comments remain available as supporting evidence, including dated older comments. Rep-confirmed explanations can override the suggested conversation plan without changing the frozen model prediction. A randomised pilot against usual account management is needed to estimate incremental retained contribution after offer/travel costs.

## Mixed outreach and routes

The selected base state is the rep's territory. The radius is great-circle distance from the approximate city base. Visits are proposed for the territory's top 30% of prevention candidates by planning score, provided they have coordinates, fit the radius, and fit a selected visit day including a return trip. The rep can prefer a call or a visit per account; a visit preference never bypasses reach or workday constraints. Others are called first; out-of-reach accounts include a local-rep coordination suggestion, not an automatic assignment to an invented person.

Visits are sequenced by planning score divided by meeting-plus-next-leg time, a greedy heuristic with explicit feasibility checks, not a claimed optimal vehicle-routing solution or learned intervention model. Calls take 30 minutes, use free workday slots, and never overlap travel, meetings or lunch (12:00–13:00). Visits use the rep's chosen duration. Unscheduled contacts block approval. Approval is idempotent and freezes the plan. No second set of appointments is appended silently.

For car plans the browser requests a selected-coordinate duration/distance matrix and route shapes from the OSRM public demo server. Calls are serialised, spaced at least 1.15 seconds apart, cached in memory, limited to 20 selected contacts plus base, and have 10-second timeouts. Road times include 20% buffer plus 10 minutes per leg; no live traffic is used. A failed service falls back to distance × 1.35 at 35 km/h plus 10 minutes. Public transport is explicitly an estimate: distance × 1.45 at 22 km/h plus 15 minutes per leg. No timetables or verified transit routes are invented. Solid map lines are retrieved road geometry; dashed lines are geographic connections. The map retains ordered stop lists if the map library cannot load.

OSRM's free public server is restricted to reasonable non-commercial demonstration use and has no uptime guarantee. This challenge prototype should switch to a dedicated routing provider before commercial use. OpenStreetMap tiles load only for the map currently being viewed, with visible attribution and default browser caching; there is no prefetch/bulk tile download. Local vendored library assets avoid CDN dependence for rendering. Missing/invalid coordinates force calls.

References: https://project-osrm.org/docs/v26.5.0/http, https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server, https://operations.osmfoundation.org/policies/tiles/.

## Customer comments and translation

Account briefs show up to the two latest safe Portuguese comment excerpts, plus an additional latest negative comment when available (otherwise the next latest comment). Excerpts are dated, scored and capped at 350 characters. Address-bearing comments are omitted; email addresses, links, long identifiers and phone-like sequences are filtered. These are excerpts, not full verbatim raw reviews, and filtering is heuristic. No comment submitted after the historical cutoff is shown.

English issue tags use Portuguese keyword rules on scores of 3 or lower and are labelled possible issues. Counts/first/latest dates cover safe written comments submitted in the past 180 days; delivery counts independently use known deliveries on purchases in that period. These cannot prove why an account declined, whether a complaint remains unresolved, or that one individual experienced every order in an aggregate area.

Translation is requested explicitly per displayed excerpt through MyMemory's GET endpoint (Portuguese → English). UTF-8 chunks stay below 500 bytes, responses are cached for the session, timeouts/quota errors keep the Portuguese original visible, and machine output is escaped as text. No API key, contact email or raw review identifier is transmitted. The UI explains the excerpt is sent to MyMemory; this is optional machine translation, not an LLM agent. Service quality and free limits can vary. References: https://mymemory.translated.net/doc/spec.php and https://mymemory.translated.net/doc/usagelimits.php.

## Simulated agent

Weekly brief now presents ranked action cards with a next step, an evidence summary, a ready-to-use opener and a target conversation outcome. The highest-priority account's next step and opener appear in the opening brief. Each card retains risk, account value, visit/call timing and channel controls, with a copy button and a link to the full action brief. Detailed briefs put the action plan ahead of supporting reviews and purchase history, adding diagnostic questions and three practical next steps. The same deterministic advice is shared across the weekly plan, account brief, agenda rationale, calendar export and read-only agent payload through `dist/actions.js`. Service remedies are conditional on confirming the issue and approved policy; no claim is made that an intervention will prevent churn.

Cause and negotiation layer: `dist/commercial.js` adds explicit hypotheses, supporting evidence, customer questions and practical remedies. Historical service signals and category gaps are separated from unobserved stock, demand and competitor-price explanations. A cause can be recorded by the rep in the current session; this updates advice without changing model scores or ranking. These are transparent rules, not trained causal attribution or intervention-lift estimates.

User-selected demo commercial assumptions are editable: 5% opening discount, 10% ceiling and R$100 cap per order. Terms apply to one agreed order and require actual commercial review. A calculator uses an editable historical average basket as a reference; discount = min(basket × rate, cap), rounded to cents. It shows effective rate and net basket revenue. Optional rep-entered gross margin allows a gross-profit check; zero or negative gross profit blocks draft copying. The dataset contains no cost/margin, competitor-price or intervention-outcome fields, so profitability and retention lift are not inferred. Alternatives include verified service correction/replacement or credit review, smaller/split replenishment and relevant product/substitute trials, with feasibility and costs to confirm.

Weekly cards surface possible cause and conditional offer; the full brief adds the calculator and a copyable draft. Drafts may be added to an approved contact's agenda note without marking them accepted. Causes and terms entered for an account stay in-session; demo limits persist in this browser. Agenda, calendar and read-only agent payload share the same live advice. Existing copied/recorded notes are historical drafts and must be reviewed if limits change. Follow-through measures fulfilment and actual subsequent purchases, not offer acceptance as proof of retention. Verification: `node test/commercial.mjs`, `node test/rep.mjs`, `node test/smoke.mjs`.

Briefs and suggested actions are deterministic and grounded in account records. Warning rules expose cadence breaks, purchase/spend decline, known service issues, comment themes and regular-category gaps. Causes remain hypotheses; no automatic discounts are offered. Approval schedules in-app contact briefs and travel blocks only. Outcomes do not retrain the historical model. A production version would require persistent, authorised CRM/calendar integrations, auditing, real outlet addresses and outcome-based intervention testing.

Two read-only WebMCP tools share the visible interface's state: `read_weekly_retention_plan` (including channel decisions and schedule) and `open_account_brief`. Feature detection allows ordinary browsers without WebMCP support. No tool submits a plan, contacts a customer or calls the translation service silently. Unknown-account validation and the unsupported-browser path are covered by the smoke test; routing tests cover geography, missing locations, transit, unavailable routes, time bounds, no overlaps and capacity overflow.

## Hosting

Published via Sites. For GitHub Pages migration, copy the contents of `dist` to the repository publishing root or `/docs`, and select that directory in Pages settings. The app uses relative asset URLs and requires no server process, secrets or LLM spend. Do not upload the original ZIP or raw-data directory to a public repository.
