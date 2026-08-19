# AgencySignal

AgencySignal takes one business and produces a client-ready package: a scored
audit of its website and Google presence, a proposal derived from what the audit
found, and brand-matched mockups of the redesign — each served at a stable public
URL, and none of it exportable until a person approves it.

## The premise

Google flattens a multi-service business into one category. A clinic offering
functional medicine, hormone therapy, aesthetics, and an education arm appears as
"Medical clinic" and competes for one set of searches. The audit is built to find
that: it reads every service the website sells, reads what the Google profile
represents, and reports the difference.

Everything else — technical checks, on-page SEO, conversion paths — is supporting
evidence, and is weighted accordingly.

## Running an audit

1. Add a business (name and website are enough), or import a CSV.
2. Open it and press **Run website audit**, or use the **Audit engine** tab for
   per-module detail.
3. The run advances one module at a time. Nothing is lost if you close the tab —
   the whole run lives in the database and resumes on the next tick.
4. When it finishes, **Build report, proposal and mockups** produces the package.

Every artifact is a draft. Nothing in this system sends anything to a prospect.

Pricing is deliverable-based. The audit decides which deliverables are triggered
and which severity band each falls in; no figure reaches a proposal that is not
in `config/pricing.json`, and the only arithmetic performed is a per-unit band
times a counted quantity, then a sum.

### What a run produces

- A **score out of 100**, but only when enough of the rubric could actually be
  verified. Below that threshold the run reports "not scored" and says why. A
  site that could not be read is reported as unread, never as a low score.
- **Findings** ranked by impact over effort, so the top of the list is the
  fastest meaningful win.
- A **service-line gap table**: what the site sells, where each line was read
  from with the text quoted, whether it has its own page, and whether Google
  represents it. A line that cannot cite its source does not appear.
- **Checks that could not run**, listed explicitly. An omitted check reads as a
  pass, so nothing is omitted.
- **Crawl diagnostics** — final status, robots.txt fetchability, pages reached
  against pages attempted, and any blocking responses with their server headers.

## Configuration

| File | Controls |
| --- | --- |
| `lib/audit/scoring-config.js` | Category weights, the confidence threshold below which no score is reported, severity-to-impact defaults, and the retry policy. |
| `lib/audit/cost-config.js` | Estimated per-call costs, used for reporting what a run cost. |
| `lib/audit/registry.js` | Which modules run, in what order, and which API keys each one wants. |
| `config/pricing.json` | Deliverables, their severity bands, the hourly rate, the minimum engagement, and the retainer. `display_mode` decides whether a figure prints as a starting price, a firm number, or a range. |
| `config/voice.md` | The voice the proposal's opening is written in, and the hard constraints enforced against every draft. |

## Local development

Requirements: Node.js 22.13 or newer, npm, and a Linux environment with `flock`,
`curl`, and GNU `timeout`.

```bash
npm run setup     # dependencies, a login, both API keys, and the database
npm run dev
```

`npm run setup` prompts for a login email and password, and for both API keys.
Pass them directly to skip the prompts:

```bash
npm run setup -- --email you@example.com --password 'a long passphrase' \
  --owner 'Your Name' --pagespeed-key KEY --places-key KEY
```

It writes `.dev.vars`, which is git-ignored and read by the local Worker, and
prints the same values for the hosted runtime. The password itself is never
stored. Re-run `npm run auth:credentials` to rotate the login or add a key later.

### API keys

| Key | Needed for | Cost |
| --- | --- | --- |
| `PAGESPEED_API_KEY` | Lighthouse scores and Core Web Vitals | Free. 25k/day, 400 per 100s. Without it PageSpeed throttles to 429 in a batch and those checks report as not measured. |
| `GOOGLE_PLACES_API_KEY` | Reading the Google Business Profile | Billed per request; the field mask is pinned in code because Google bills by SKU tier. Without it the gap table cannot be built. |
| `OPENAI_API_KEY` | Optional. Writes recommendation rationale prose. | Per token. Without it the rationale is assembled from the findings themselves. |

### Other commands

```bash
npm run build        # production build
npm test             # build plus the full test suite
npm run lint
npm run db:generate  # after editing db/schema.ts
npm run db:migrate   # apply migrations to the local database
```

The hosted runtime applies the migrations packaged into `dist/.openai/drizzle`
on deploy. `npm run db:migrate` applies the same files locally and is safe to
re-run.

## Directories

```text
app/                Pages and API routes
config/             Pricing tiers and the proposal voice sample
db/                 Drizzle schema and D1 access
docs/               Handover notes and the original implementation plan
drizzle/            Generated and hand-written migrations
lib/audit/          The audit engine: runner, modules, config, deliverables
lib/                Shared types and helpers
scripts/            Setup, install, build, migration, and validation helpers
tests/              Node test-runner suites
worker/             Cloudflare Worker entry point
```

## Boundaries

- Only public data is used. The crawler honours `robots.txt`, throttles to one
  request at a time, and identifies itself honestly.
- Forms are assessed by static analysis only. No request is issued that could
  write a record into a prospect's system, and the evidence text says so.
- There is no email-sending code anywhere in this repository. Outreach is a
  person copying text out of the dashboard.
- Fields the Places API does not expose for a profile we do not own become an
  explicit manual-check list; a person's entered values feed the same checks.
