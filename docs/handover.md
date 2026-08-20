# AgencySignal — handover

What the system is, how it fits together, and what it does not do. Read the
README first for how to run it.

## Architecture

One Cloudflare Worker, described by `.openai/hosting.json`, which declares
exactly two bindings: `d1` and `r2`. No queue, no Durable Object, no cron, no
browser rendering. That single fact shapes most of what follows.

```
POST /api/audit-runs          creates a run and one row per module, all queued
POST /api/audit-runs/:id/tick claims one module, runs it, returns run state
POST /api/audit-runs/:id/recommendations | /proposal | /mockups
GET  /report/:token  /proposal/:token  /mockup/:token     public, no auth
```

**The runner is tick-driven** (`lib/audit/runner.ts`). There is no queue binding,
so a run is advanced one module per request. The claim is a conditional
`UPDATE … WHERE status = 'Queued'`, so two concurrent ticks cannot run the same
module twice. All state is in D1: a run resumes from any later tick even if the
browser that started it is gone. If a queue binding ever becomes available, it
drops in behind the same interface with no module changes.

**Retries are across ticks.** A 429, a 5xx, or a timeout re-queues the module
with exponential backoff (4s, 8s, 16s, 32s, capped at 60s, four attempts). Only
when the attempts are spent is a check marked unmeasured — and it records *why*:
`retries-exhausted`, `source-unavailable`, `host-unreachable`, or
`not-applicable`. The deadline is computed and compared by SQLite itself;
storing it as an ISO string and comparing against `CURRENT_TIMESTAMP` silently
wedges every retry, because `T` sorts above a space.

**Every external response is stored** in `raw_payloads`, keyed by request and
fetch date. Collectors consult that cache *before* the network, so a re-score
never re-fetches and a retried module does not re-hit the prospect's site. A
payload reused from the cache still belongs to the run that first fetched it, so
a run's payloads are found through `audit_run_modules.payloadIds`, never by
`raw_payloads.run_id`.

## The modules

Each is a pair: `analyze-*.js` is pure and unit-tested, `collect-*.ts` does the
I/O. `lib/audit/registry.js` declares them. A module whose required keys are
missing is skipped with a reason; a module that throws is recorded failed.
Neither ends the run.

| Module | Category | What it does |
| --- | --- | --- |
| `technical` | Technical | PageSpeed mobile and desktop, HTTPS, viewport, favicon, link previews, 404 handling, Core Web Vitals, page weight |
| `service-lines` | Service coverage | **The product.** Reads services from navigation, service pages and structured data; diffs against what Google represents |
| `google` | Trust | Places API for category, NAP consistency, reviews, hours, status, plus the manual-check list |
| `seo` | Visibility | Titles, metas, H1s, hierarchy, alt coverage, canonicals, sitemap, robots, schema validity, a page per service line |
| `conversion` | Conversion | Click-to-call, booking depth, static form analysis, `mailto:` flags, above-fold CTA, trust signals, analytics |

The crawler (`lib/audit/crawl.ts`) is shared. It fetches and parses `robots.txt`
properly — a group naming our agent replaces the wildcard group entirely,
longest match wins with Allow beating Disallow at equal length, wildcards and
`$` anchors are honoured — throttles to one request at a time spaced by any
stated `Crawl-delay`, and crawls service pages first so a truncated crawl still
saw what the audit reasons about.

Crawl payloads are **distilled** before storage. D1 caps a row at 2 MB and 25
pages of raw HTML would blow it, so each page is reduced to its structure plus a
bounded text excerpt. Only the homepage keeps markup, for brand extraction.

## Two guarantees

Both are enforced in `finalizeRun`, and both have tests that fail if they break.

**A site we could not read is never stored as a site that scored badly.** A
blocked or timed-out fetch produces zero checks, a null score, and one finding
that says so explicitly.

**A site we barely measured is never stored as a site that scored well.** Runs
carry a confidence figure — the summed rubric *weight* of verified checks over
total weight, not a check count — and below `minimumConfidence` no score is
reported at all. This was found by running against a real site: PageSpeed
answered 429, six of sixteen checks verified, all six passed, and the run
reported a confident 100.

Only a genuinely scored run may write the prospect's headline score.

## Where things live

| Concern | File |
| --- | --- |
| Category weights, confidence threshold, retry policy, severity defaults | `lib/audit/scoring-config.js` |
| Per-call cost estimates | `lib/audit/cost-config.js` |
| Which modules run and what keys they want | `lib/audit/registry.js` |
| Findings → service menu mapping, and the evidence gate | `lib/audit/recommendations.js` |
| Deliverables, severity bands, minimum engagement, retainer | `config/pricing.json` |
| Band selection and the figure-tracing check | `lib/audit/pricing.js` |
| Proposal opening voice, and the rules enforced against it | `config/voice.md`, `lib/audit/proposal-voice.js` |
| Brand token extraction | `lib/audit/brand.js` |
| Mockup templates | `lib/audit/mockup.js` |
| Which parts a proposal can carry, and when each is offerable | `lib/audit/proposal-sections.js` |

Weights are deliberately ordered: **Service coverage 0.30, Trust 0.25**, then
Conversion 0.20, Visibility 0.15, Technical 0.10. A competent site-builder
template passes most of the technical rubric for free, so a technical score says
little about whether a prospect is worth pitching. A test enforces that the two
differentiating categories stay above every table-stakes one, and that no
category exceeds the cap.

## The evidence rules

- A recommendation citing no stored finding, or an id absent from the run,
  **fails the render** rather than shipping. The model writes only rationale
  prose and must cite finding IDs; a citation it invented is stripped and the
  prose is discarded rather than used.
- A service line that cannot cite its source page and the verbatim text it was
  read from does not appear in the gap table at all.
- When the Google profile lists no services, that is **one** finding about the
  listing plus one about the category — not one per service. Per-service gaps
  are only emitted when Google lists services and a specific one is missing.
  Places `types` are Google's own taxonomy and do not count as a service list.

## What a proposal carries

The parts of the document are chosen before it is built, in **What goes in the
proposal**, and stored on `proposals.sections`. Three rules hold the design
together:

- **A part is offered only when this run holds what fills it.**
  `lib/audit/proposal-sections.js` decides nothing on its own; it is handed
  counts — findings, service lines, priced lines, unverified checks, concept
  pages — and reports what can be offered and, for the rest, why not. An
  unavailable part stays on the list with its reason, because a missing option
  reads as a part that cannot exist.
- **Unticked is not built.** The concepts step is skipped entirely when the
  concepts are not wanted, and a proposal built without them carries no mockup
  links and no opening sentence offering to show one — the voice rules forbid
  referring to a visual the reader cannot reach.
- **An empty column means "everything".** Proposals built before the picker
  existed carry no stored choice, and the document renders every part it has.
  An empty array is a deliberate choice of none of the optional parts, and is
  kept as one.

## The proposal opening

`config/voice.md` defines the voice and, at the bottom, five hard constraints
its author calls "worse than no proposal" if broken. Those are enforced in
`lib/audit/proposal-voice.js` rather than merely asked of the model:

- **No number the audit did not measure.** Every digit in a draft is checked
  against the numbers appearing in the cited findings' own evidence. Counts
  attached to things the audit never measures — calls, leads, competitors,
  revenue — are rejected whether written in digits or in words.
- **No unverified finding, and absence of data is not a finding.** A "could not
  be read" finding is excluded from the opening entirely; a run whose strongest
  finding is missing data produces no opening at all, which the voice file calls
  a signal not to send.
- **No visual that does not exist.** Section three is dropped when the run
  produced no mockup, and any reference to one is rejected.
- **No price outside `config/pricing.json`**, and no implied prior contact.

A model draft is used only if it clears every constraint; otherwise a
deterministic composition runs, which obeys the same rules by construction and
records itself as `composed` rather than `model`. Technical terms are translated
into consequences at the point of use, so the reader never has to look anything
up.

## Pricing

`config/pricing.json` prices deliverables, not packages. Each deliverable
declares what triggers it (`technical_audit`, `service_line_coverage`,
`google_presence`, mapped to audit modules in `lib/audit/pricing.js`) and
carries severity bands with a `min` and `max`. The engine selects exactly one
band per triggered deliverable:

- **Website rebuild** is claimed only on breadth — four or more high-severity
  technical findings across two or more areas. Its band comes from the page
  count, preferring the site's own sitemap over a crawl that may have been
  capped. Below that threshold the same findings are a **technical fix pass**,
  light for one root cause and standard for failures spread across templates.
- **Service pages** are priced per page, and the quantity is the count of
  services the site sells with no page of their own.
- **Google deliverables** are skipped entirely when the profile could not be
  read, so a failed Places lookup is never priced as work.
- The **retainer** is offered alongside the work and never folded into its
  total. Its band steps up when there are service lines still needing content.

The file's own comment says the generator "must never emit a figure absent from
this file". `verifyFigures` enforces it: every band figure must exist in the
file, every line total must be its band times its counted quantity, and the
total must be either the sum of the lines shown or the file's own
`minimum_engagement`. A proposal that fails that check throws rather than
rendering. `display_mode` controls presentation only — the shipped file asks for
`starts_at`, which prints the band minimum.

## Known limitations

- **Blocking rate is unmeasured.** The crawler was never run against real
  small-business sites from the deployed environment. Wix and Squarespace builds,
  JS-rendered navigation, and Cloudflare or Sucuri bot protection are the
  untested cases. Every run records the diagnostics needed to answer this; the
  first five real audits will.
- **The confidence threshold is not calibrated.** 60% is a placeholder. It has
  only ever been exercised with PageSpeed absent. Re-tune it against real runs.
- **Pricing has never been applied to a real prospect.** The band selection is
  covered by fixture tests, but the only live proposals were against pypi.org,
  which triggers one deliverable and no Google or service-line work.
- **Scores have never been produced against a real prospect.** Every live run in
  development was against pypi.org, which is not a service business and correctly
  yields zero service lines.
- **Mockups are template-driven, not model-generated.** Brand tokens are read
  from the prospect's own markup and stylesheets, but the layout is a fixed
  template. It is recognisably theirs; it is not a bespoke design.
- **Brand extraction reads same-origin stylesheets only.** A site serving CSS
  from a third-party CDN falls back to default colours, and says which tokens
  were defaulted.
- **`leads.score` is a single number for a five-category rubric.** Sub-scores are
  stored per category but the prospect list shows only the overall.
- **The `audits`, `audit_findings` and `competitor_audits` tables are legacy.**
  They predate the engine and still back the manual competitor comparison. The
  legacy `/api/audit` scoring path is gone and its scores were cleared by
  migration `0014`.
- **Four lint errors are pre-existing**, in `dashboard.tsx` and
  `prospect-detail.tsx` — React effect patterns in the two largest client
  components. Fixing them means restructuring data fetching in both.

## What this system deliberately does not do

- Send email. There is no sending code anywhere.
- Submit forms. Form assessment is static analysis only, and says so in the
  evidence text.
- Assign a score with the model. The LLM extracts and explains; every number is
  computed by `scoring-config.js`.
- Invent pricing. Tiers come from `config/pricing.json` or the proposal is not
  exportable.
