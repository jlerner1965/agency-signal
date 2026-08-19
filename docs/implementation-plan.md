# Prospect Audit & Proposal Engine — Implementation Plan

Status: **awaiting approval**. No feature code has been written.

## 1. What the repo already gives us

| Capability | Where | Reuse |
| --- | --- | --- |
| Prospect records, pipeline stages, activity log | `leads`, `activities` tables | Extend |
| Multi-page fetch + evidence checks + findings | `lib/site-audit.js`, `lib/website-inspection.ts` | Becomes two of the six modules |
| Weighted deterministic scoring | `analyzeWebsitePages` | Weights move to config |
| Lighthouse/PageSpeed enrichment | `fetchLighthouseSnapshot` | Becomes the technical module's fetcher |
| Google presence scoring from hand-entered fields | `lib/google-presence.js` | Becomes the manual-check path of the Google module |
| Offer catalog, pricing, objections | `lib/sales.js` | Becomes the service menu and pricing config |
| LLM with strict JSON schema, evidence grounding, Draft/Approved/Discarded | `lib/copilot.js`, `ai_runs` | The human-in-the-loop pattern already exists; extend it |
| Public tokenised report and proposal pages | `app/report/[token]`, `app/proposal/[token]` | Deliverable surfaces |
| Screenshot storage in R2 | `lib/audit-screenshots.ts` | Mockup and evidence images |

Conventions to hold to: pure analysis lives in `lib/*.js` with JSDoc types and `node --test` coverage; anything touching a binding lives in `lib/*.ts`; API routes are thin, guarded by `requireDashboardApi()`, and return `Response.json`.

No new framework, ORM, or job runner is proposed. Drizzle + D1 + the existing migration runner cover everything below.

## 2. The constraint that shapes every other decision

The app deploys as a single Cloudflare Worker described by `.openai/hosting.json`, which declares exactly two bindings:

```json
{ "d1": "DB", "r2": "BUCKET" }
```

There is no queue, no Durable Object, no cron trigger, and no browser-rendering binding. Four consequences:

1. **No server-side job queue.** Background work has to be driven by ticks (§6).
2. **No headless Chrome in-process.** Mockup PNGs need an external HTTP service. This is the one hard blocker — see Decision 1.
3. **D1 is SQLite, so there is no JSONB.** Raw payloads are stored as `TEXT`; `json_extract()` indexes the few fields we filter on. This matches the existing `check_summary` / `lighthouse_summary` columns.
4. **Worker subrequest and CPU ceilings.** A 100-page crawl cannot happen in one request, so the crawl module is resumable across ticks (§6).

## 3. Data model

**Keep `leads` as the prospect table.** Renaming it to `prospect` would touch every route, component, type, and the eight existing migrations for no functional gain. `leads` already carries name, website, city, state, industry (`carrier`), status, and notes — the exact fields the spec asks for. Two columns get added: `place_id` and `resolved_website_at`.

New tables, all additive, introduced one migration per phase:

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `audit_runs` | One execution of the module set | `lead_id`, `status`, `started_at`, `finished_at`, `overall_score`, per-category subscores, `cost_cents`, `review_status`, `error` |
| `audit_run_modules` | Per-module state — this *is* the job status surface | `run_id`, `module`, `status` (queued/running/ok/skipped/failed), `attempts`, `message`, `cost_cents`, timestamps |
| `raw_payloads` | Every external response, stored once | `run_id`, `module`, `source`, `request_key`, `fetched_at`, `payload` (TEXT), `bytes` |
| `findings` | Supersedes `audit_findings` | `run_id`, `module`, `category`, `severity`, `title`, `evidence`, `evidence_url`, `evidence_screenshot_key`, `impact` (1–5), `effort` (1–5) |
| `service_lines` | The differentiator's output | `run_id`, `name`, `site_url`, `has_landing_page`, `google_represented`, `source`, `confidence` |
| `recommendations` | | `run_id`, `service_line` (offer id), `rationale`, `finding_ids` (JSON), `status` |
| `proposal_versions` | Versioned drafts against `proposals` | `proposal_id`, `run_id`, `version`, `tier`, `scope_items` (JSON), `status`, `approved_at` |
| `mockups` | | `run_id`, `kind`, `html`, `screenshot_key`, `brand_tokens` (JSON), `status` |

`audit_findings` is not dropped. Existing rows stay readable; new runs write to `findings`, and the report reads whichever the run produced. That keeps every historical audit intact.

**Caching falls out of the model.** A unique index on `raw_payloads(request_key, date(fetched_at))` means the same target is never fetched twice in one day, and a re-score reads stored payloads instead of re-fetching. No separate cache layer.

## 4. Module boundaries

Each module is a pair, following the existing split:

```
lib/audit/<id>/analyze.js    pure: (payloads, context) => { findings, checks, serviceLines? }
lib/audit/<id>/collect.ts    I/O:  (target, ctx) => payloads
```

`lib/audit/registry.ts` declares each module as `{ id, label, requires: [...envKeys], optional }`. The runner **skips** a module whose keys are missing, records `status: "skipped"` with the reason, and continues. A module that throws is recorded `failed` with its message. Neither ends the run.

| # | Module | Source | Notes |
| --- | --- | --- | --- |
| 1 | `technical` | PageSpeed mobile + desktop, direct fetches | Core Web Vitals, HTTPS/cert, redirect chain, viewport, render-blocking, image weight/format, broken internal links, 404 handling, favicon, OG/Twitter tags |
| 2 | `onpage` | Crawl | Titles/descriptions/H1s per page, heading hierarchy, alt coverage, link depth, sitemap.xml, robots.txt, canonicals, thin/duplicate pages, and `LocalBusiness` / `MedicalBusiness` / `Service` / `FAQPage` / `Physician` schema validity |
| 3 | `google` | Places API Place Details | Plus the manual-check list for fields the API does not expose |
| 4 | `service-lines` | Crawl + Google + LLM extraction | The differentiator |
| 5 | `conversion` | Crawl | Click-to-call, booking flow step count, forms, above-fold CTA, trust signals, GA4/Plausible/Meta pixel/call tracking |
| 6 | `competitive` | SERP provider | Optional; skipped with no key |

**`robots.txt` is a correction, not just an addition.** The current crawler reads the `<meta robots>` tag but never fetches `/robots.txt`. The new crawler fetches and parses it, honours `Disallow` and `Crawl-delay`, identifies as `AgencySignal-Audit/4.0 (+https://…/crawler)`, throttles to one request at a time per host, and caps at 100 pages.

**Service-line detection (module 4).** The LLM extracts a structured service list from nav, service pages, and body copy — it returns names and source URLs and nothing else. Everything after that is deterministic: the diff against what Google represents (primary category, listed services, review-text topics, site links), the "no dedicated landing page" flag, and the severity assignment. Every service on the site and absent from Google becomes a High finding carrying an explicit revenue frame drawn from the pricing config, never from the model.

**One deliberate narrowing.** The spec asks whether lead forms "actually submit". Submitting a real form writes a fake enquiry into a stranger's CRM and can trigger their sales follow-up. I propose verifying instead that the form has an action endpoint, a method, named required fields, and a reachable handler (HEAD/OPTIONS probe), and stating exactly that in the evidence text. If you want true submission testing, say so and I will implement it against a consent list of domains you nominate.

## 5. External dependencies

| Provider | Used for | Cost shape | Rate limit | Key |
| --- | --- | --- | --- | --- |
| PageSpeed Insights | Module 1 | Free | Per-key daily and per-minute quota; unkeyed requests are throttled hard and already fail silently today | `PAGESPEED_API_KEY` |
| Google Places (Place Details) | Module 3, website resolution | Billed per request against a monthly credit; SKU tier depends on the field mask | Per-project QPS | `GOOGLE_PLACES_API_KEY` |
| Google Places (Text Search) | name + city → `place_id` | Separate, more expensive SKU | Per-project QPS | same key |
| SERP provider (SerpApi or DataForSEO) | Module 6 | Per-search; SerpApi is subscription-priced, DataForSEO pay-as-you-go and slower | Provider-specific | `SERP_PROVIDER`, `SERP_API_KEY` |
| OpenAI Responses API | Extraction and rationale prose | Per token; already wired | Account-level | `OPENAI_API_KEY` |
| Screenshot service | Mockup PNGs | See Decision 1 | — | TBD |

Exact per-unit prices move fast enough that I will read them from each provider's current pricing page during Phase 1 and put them in `lib/audit/cost-config.js` rather than hardcoding numbers from memory. Every module writes its own `cost_cents` from that table; `audit_runs.cost_cents` is the sum and is shown in the run header.

Field masks matter: Places bills by the SKU tier the requested fields fall into, so the mask is pinned in code and reviewed rather than requested wholesale.

Every new key is added to `scripts/setup-credentials.mjs` so `npm run setup` documents and provisions it, per the existing bootstrap.

## 6. Job strategy

With no queue binding, the runner is **tick-driven** and its entire state lives in D1:

- `POST /api/audit-runs` creates the run plus one `audit_run_modules` row per module, all `queued`, and returns immediately.
- `POST /api/audit-runs/:id/tick` claims exactly one `queued` module with a conditional `UPDATE … WHERE status = 'queued'`, so two concurrent ticks can never run the same module twice. It executes that module under a wall-clock budget, writes payloads and findings, marks the module `ok`/`failed`/`skipped`, and returns the run's current state.
- The crawl module is itself resumable: its frontier is a stored payload, and each tick processes a bounded batch of pages until the cap.
- The dashboard polls `tick` while a run is open and renders per-module status. Closing the browser loses nothing — the next tick from any source resumes the run.

`ctx.waitUntil` is not used: it extends work past the response but stays bound to that request's lifetime and offers no retry, no visibility, and no resumption. The tick model gives all three with no new binding and behaves identically locally and hosted.

`lib/audit/runner.ts` is the seam. If a Cloudflare Queue or Workflow binding becomes available, the queue implementation drops in behind the same interface and the dashboard stops polling — no module changes.

## 7. Scoring

One file: `lib/audit/scoring-config.js`, holding category weights, per-check weights, and severity→impact defaults. The weights currently inlined in `site-audit.js` (`.25 / .30 / .25 / .20`) move here, which is both the requirement and a fix.

Scoring is pure and deterministic and never sees LLM output as a number. Module 4's model call produces a service list; the *count* of gaps enters the score through a fixed rule in the config. Fixture payloads land in `tests/fixtures/` and `tests/scoring.test.mjs` asserts exact subscores and ordering, in the style of the existing suites.

Prioritisation is `impact / effort` descending, ties broken by severity then category weight, so the top of every report is the fastest meaningful win.

## 8. Recommendations and the evidence gate

Rules map finding categories to service lines drawn from the existing `offerCatalog`, extended with the requested menu (site rebuild, local SEO/GBP, service-page content, conversion optimisation, analytics setup, paid search). The mapping is a table in config, not branching in code.

The LLM writes only the rationale prose and must cite `finding_id`s. Before any artifact renders, a pure `validateEvidence(recommendations, findings)` runs: a recommendation citing zero findings, or an id that does not exist in this run, **fails the render** and names the offender. This mirrors the grounding `lib/copilot.js` already does.

## 9. Deliverables

**Audit report.** Extends the existing `/report/:token` page with the prioritised findings list, evidence screenshots, the service-line gap table, and the competitor comparison. Printable to PDF through a print stylesheet — no PDF library, no extra dependency.

**Proposal.** Scope items derive from approved recommendations. Three tiers come from `lib/pricing-config.js` and are never model-generated. Versioned in `proposal_versions`; `status` moves draft → approved. The opening section is written in your voice from a `config/voice.md` sample you supply — without that file the section renders as an editable placeholder rather than an invented voice.

**Mockups.** Brand token extraction runs in-worker: CSS custom properties and linked stylesheets for palette, `og:image`/favicon/header `<img>` for logo, computed font stack for type. The LLM then generates a single-file HTML mockup of a homepage and one service page using those tokens. PNG rendering is the open blocker below.

## 10. Human in the loop

Every artifact carries `status` and `approved_at`. `GET /api/review-queue` lists runs holding anything unapproved. Export and mark-sendable endpoints check approval and return 409 otherwise.

There is no email-sending code anywhere in this repository today, and none will be added. Outreach remains a human copying text out of the dashboard.

## 11. Phases

Each ships end-to-end and pauses for review.

1. **Skeleton** — `audit_runs`, `audit_run_modules`, `raw_payloads`, `findings`; runner and tick endpoint; registry; PageSpeed module wired from input to stored findings; run status UI. *Acceptance: enter a URL, see real stored findings.*
2. **Full audit** — crawler with robots.txt and throttling, modules 2–6, scoring config, findings UI with evidence. *Acceptance: complete scored runs against three real Boulder-area clinic sites; fixture scoring tests pass.*
3. **Recommendations + report** — mapping rules, LLM rationale, evidence gate, exportable report. *Acceptance: a report worth sending as-is.*
4. **Proposal + mockups** — pricing config, versioning, brand extraction, mockup generation and screenshotting. *Acceptance: a full package for one real prospect.*
5. **Review queue + polish** — approval workflow, run history, cost reporting.

Throughout: lint stays at its current 11 problems / 4 errors and `npm test` stays green.

## 12. Decisions I need before Phase 1

**1. Mockup screenshots — the one hard blocker.** Headless Chrome cannot run inside a Cloudflare Worker.
- *Recommended:* Cloudflare Browser Rendering REST API. Same vendor, `/screenshot` takes HTML and returns a PNG, no binding needed — just a Cloudflare account id and API token. Costs a per-request fee and needs Workers Paid.
- *Alternative:* a third-party screenshot API. Simplest, another vendor and key.
- *Cheapest:* ship HTML-only mockups with a print-to-PNG button in the browser. No render cost, but nothing to embed in the report automatically.

**2. `leads` vs `prospect`.** I recommend keeping `leads` and adding `place_id`. Renaming is pure churn across eight migrations and every route.

**3. SERP provider.** SerpApi is faster and simpler; DataForSEO is materially cheaper per search. Either sits behind the same interface. Which account do you already have?

**4. Form submission testing.** I propose probing rather than submitting (§4). Confirm, or nominate consenting domains.

**5. Queue binding.** Can `.openai/hosting.json` carry a Queue or Workflow binding on your hosting plan? If yes, Phase 1 builds the queue runner instead of ticks. If unknown, ticks ship and the seam stays.

**6. Voice sample.** The proposal's opening section needs `config/voice.md` — two or three paragraphs you have actually sent a prospect.
