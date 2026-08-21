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
   Successful fetches are cached for the calendar day, so a second run of the
   same site reuses them. Tick **Fetch the sources again** to ignore what
   earlier runs read today — the run still shares one crawl across its own
   modules, so the prospect's site is fetched once, not once per module.
4. When it finishes, tick the findings the proposal should argue from
   (**step 2**), then the parts the document should carry and read the price
   they come to (**step 3**), then press **Build the package**. The button
   names the steps it will run, in order, and sits below both choices because
   it commits to them.

Opening a past run from **Previous runs** shows the package it already has —
its proposal link, its recommendations and its concept pages — so a run that
was already built is not built a second time to get the link back.

Every artifact is a draft. Nothing in this system sends anything to a prospect.

### Choosing what goes in the proposal

**What goes in the proposal** lists the parts a document can carry — the
opening, the audit evidence, the service-line coverage table, the website
mockups, the priced scope, and the checks that could not be run — with what each
would contain for this prospect beside it. Ticked parts are built and included;
unticked ones are not built at all, so leaving the mockups out skips the slowest
step of the build rather than producing pages nobody will see. Ticked and not
yet built, the concept pages are built by the proposal builder itself, so the
document never carries a part list promising pages it does not link.

Rebuilding a run's concept pages keeps their addresses. A proposal stores its
concept links by value, so reissuing them would turn every concept in a document
already sent into a dead link.

A part this prospect has nothing to fill stays on the list, greyed, with the
reason: a missing option reads as a part the tool cannot produce, which is a
different claim from one this run has nothing to put in it. The choice is stored
with the proposal, so the public document shows exactly the parts that were
ticked.

The same picker appears on the **Proposal** tab for a proposal built from the
prospect rather than from a run. Three of the parts are the run's to produce and
say so; the concept mockups are not, and can be included there from the newest
finished run.

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
- **Concept mockups** built from whatever the audit could read of the
  prospect's colours, type and logo — each token that had to fall back to a
  default is recorded with the mockup. The words
  come from a register chosen from evidence the audit already holds — the Google
  category first, then the site's own structured data and copy — because a
  supplier shown a page about practitioners and appointments reads as a template
  with the name swapped in. Where the evidence is thin or contradictory the
  neutral register is used, and the register and its reason are stored with the
  mockup. See `lib/audit/register.js`.

## Required credentials

Every environment variable the audit and proposal paths read, what degrades
without it, and how to set it.

### Sign-in — the app is unusable without these four

| Variable | Read by | Without it |
| --- | --- | --- |
| `AGENCYSIGNAL_LOGIN_EMAIL` | `app/dashboard-auth.ts` | Login always fails; every page and API returns 401. |
| `AGENCYSIGNAL_PASSWORD_SALT` | `app/dashboard-auth.ts` | Same. |
| `AGENCYSIGNAL_PASSWORD_HASH` | `app/dashboard-auth.ts` | Same. |
| `AGENCYSIGNAL_SESSION_SECRET` | `app/dashboard-auth.ts` | Same. Rotating it signs out every existing session. |

`npm run setup` generates all four. The password itself is never stored.

### Audit — two keys, both worth having

| Variable | Read by | Without it |
| --- | --- | --- |
| `PAGESPEED_API_KEY` | `lib/audit/collect-technical.ts` | PageSpeed applies its unkeyed quota and starts returning 429 in a batch. Lighthouse and Core Web Vitals checks retry, then report as not measured. Free, no billing details. |
| `GOOGLE_PLACES_API_KEY` | `lib/audit/places.ts`, via the `google` and `service-lines` collectors | The profile is not read automatically. The gap table still runs from the category and service list entered by hand on the prospect's **Google presence** tab — see below. Billed per request. |

```bash
npm run auth:credentials -- --pagespeed-key KEY --places-key KEY
```

**The Places key is optional.** The service-line gap table — the point of the
tool — compares what the site sells against what the profile represents, and
that comparison runs from either the API or a person's entry. Typing the primary
category into a prospect's **Google presence** tab is enough for the whole
analysis, at no cost.

Two things no key can supply, because the Places API does not return them for a
profile you do not own: the **services section**, and the four activity figures
(recent posts, owner responses, photo count, profile completeness). Both are
entered on the same tab. Until the services section is entered the audit reports
it as not measured — it never claims a profile lists nothing on the strength of
not having looked.

- **PageSpeed:** enable the PageSpeed Insights API in a Google Cloud project and
  create an API key. No billing account is needed.
  https://developers.google.com/speed/docs/insights/v5/get-started
- **Places:** enable **Places API (New)** in the same project, attach a billing
  account, and create a key. Restrict it to that one API. The field mask is
  pinned in `lib/audit/places.ts` because Google bills by the SKU tier the
  requested fields fall into.
  https://console.cloud.google.com/apis/library/places.googleapis.com

For the hosted runtime, set the same names as secrets — `npm run setup` prints
them ready to paste.

### Optional

| Variable | Read by | Without it |
| --- | --- | --- |
| `OPENAI_API_KEY` | `lib/audit/deliverables.ts` | Recommendation rationale and the proposal opening are composed deterministically from the findings instead of written by a model. Both obey the same voice constraints either way. |
| `OPENAI_MODEL` | `lib/audit/deliverables.ts` | Defaults to `gpt-5.4-nano`. |
| `AGENCYSIGNAL_OWNER_NAME` | `lib/runtime-env.ts` | The name on prospect-facing reports falls back to one derived from the login address. |

A missing optional key never fails a run. A missing audit key lowers what the
run covers, and the run says which checks it could not measure and why.

## Configuration

| File | Controls |
| --- | --- |
| `lib/audit/scoring-config.js` | Category weights, the confidence threshold below which no score is reported, severity-to-impact defaults, and the retry policy. |
| `lib/audit/cost-config.js` | Estimated per-call costs, used for reporting what a run cost. |
| `lib/audit/registry.js` | Which modules run, in what order, and which API keys each one wants. |
| `config/pricing.json` | Deliverables, their severity bands, the hourly rate, the minimum engagement, and the retainer. `display_mode` decides whether a figure prints as a starting price, a firm number, or a range. |
| `config/voice.md` | The voice the proposal's opening is written in, and the hard constraints enforced against every draft. |

## Local development

Requirements: Node.js 22.13 or newer, npm, `curl`, and a Unix shell. Linux uses
`flock`, `sha256sum` and GNU `timeout` directly; macOS falls back to a `mkdir`
lock, `shasum`, and an unbounded run, so no Homebrew packages are needed.
Windows needs WSL.

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
stored. Re-run `npm run auth:credentials` to rotate the login, or pass a key flag
on its own to add a key without touching the login:

```bash
npm run auth:credentials -- --pagespeed-key KEY   # login and sessions untouched
npm run auth:credentials                          # rotates the login
```

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

## Deploying

`docs/deploy.md` covers it end to end: the preflight gates and what a pass looks
like, the secrets the runtime needs, which migrations mutate data, and how to
verify a deploy once it is live.

## Directories

```text
app/                Pages and API routes
config/             Pricing tiers and the proposal voice sample
db/                 Drizzle schema and D1 access
docs/               Deployment guide, handover notes, implementation plan
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
