# AgencySignal

AgencySignal finds evidence-backed opportunities on business websites and gives a seller a structured workflow to qualify, follow up, propose, and close them.

## AI Sales Copilot

The Close workspace includes five human-reviewed AI actions: sales brief, next action, personalized email, discovery analysis, and proposal narrative. Each result shows the exact saved CRM or audit evidence it used, its confidence, and missing information. AI drafts never send messages, change stages, set prices, or edit records automatically.

Set `OPENAI_API_KEY` as a secret production environment variable to enable generation. `OPENAI_MODEL` is optional and defaults to `gpt-5.4-nano`. API responses use a strict JSON schema and are stored with Draft, Approved, or Discarded status for review history.

AgencySignal is an evidence-led audit-to-sale workspace for growing businesses. It combines prospect imports, public-homepage auditing, shareable opportunity briefs, engagement signals, personalized Gmail outreach, and follow-up management in one focused application.

## Features

- Persistent business lead pipeline
- Prioritized daily action queue for overdue, engaged, audit-ready, and unaudited prospects
- CSV import with common lead-source field mapping and duplicate detection
- Add and manage prospect records
- Live multi-page website audits covering up to five prioritized pages
- Controlled batch auditing for up to ten prospects, processed two at a time with progress and failure visibility
- Deterministic visibility, conversion, technical, and trust scoring
- Evidence-backed findings with recommendations
- Transparent opportunity scoring and recommended service matching
- Five-factor closing readiness scoring: fit, need, intent, urgency, and reachability
- Qualification and discovery records with stage exit requirements
- Prospect-specific discovery call questions and objection-response guidance
- Human-reviewed five-step outreach sequences that pause when a prospect advances
- Defined offer catalog with outcomes, deliverables, pricing, timelines, and proof criteria
- Trackable public proposals with view counts, expiration, and recorded acceptance
- Revenue dashboard covering pipeline value, proposals, wins, close rate, and loss reasons
- Personalized “best evidence” outreach angles and next-action guidance
- Public prospect reports protected by opaque 128-bit links
- Report-view tracking
- Prospect review-request capture
- Email/password protected dashboard and APIs with signed, time-limited sessions
- Personalized outreach copy and prefilled Gmail compose
- Sales notes, follow-up scheduling, and real activity history
- Follow-up and pipeline-stage management
- Responsive desktop and mobile interface

## Technology

- Next.js 16 and React 19
- TypeScript
- Vinext and Cloudflare Workers
- Cloudflare D1
- Drizzle ORM
- Tailwind CSS 4

## Local development

Requirements:

- Node.js 22.13 or newer
- npm
- Linux environment with `flock`, `curl`, and GNU `timeout`

First run — installs dependencies, provisions a dashboard login, and applies the
database migrations to the local Cloudflare D1 database:

```bash
npm run setup
npm run dev
```

`npm run setup` prompts for a login email and password. Pass them directly to
skip the prompts, and add `--owner` to set the name shown on prospect-facing
reports and proposals:

```bash
npm run setup -- --email you@example.com --password 'a long passphrase' --owner 'Your Name'
```

It writes `.dev.vars`, which is git-ignored and read by the local Worker, and
prints the same values for the hosted runtime. The password itself is never
stored; only a PBKDF2-SHA-256 derivation of it is. Re-run
`npm run auth:credentials` at any time to rotate the login — rotating the
session secret signs out existing sessions.

The app is unusable without these four values, so the hosted runtime needs them
as secrets: `AGENCYSIGNAL_LOGIN_EMAIL`, `AGENCYSIGNAL_PASSWORD_SALT`,
`AGENCYSIGNAL_PASSWORD_HASH`, and `AGENCYSIGNAL_SESSION_SECRET`. Keep every
authentication value out of the repository. `AGENCYSIGNAL_OWNER_NAME` is
optional and defaults to a name derived from the login address.

Create a production build:

```bash
npm run build
```

Run the build and the test suite:

```bash
npm test
```

### Database

The hosted runtime applies the migrations packaged into `dist/.openai/drizzle`
on deploy. Local development applies the same files itself:

```bash
npm run db:migrate
```

The command is idempotent and records what it has applied, so it is safe to
re-run after pulling new migrations. After editing `db/schema.ts`, generate a
migration and apply it:

```bash
npm run db:generate
npm run db:migrate
```

If the dashboard reports that the database has no tables, the migrations have
not been applied to that environment yet.

### Optional integrations

| Variable | Effect when unset |
| --- | --- |
| `OPENAI_API_KEY` | The AI Copilot actions return a 503 explaining that a key is required. Everything else works. |
| `OPENAI_MODEL` | Defaults to `gpt-5.4-nano`. |
| `PAGESPEED_API_KEY` | Lighthouse enrichment is attempted unauthenticated and is skipped on failure. Audits still run on the app's own evidence checks. |

## Important directories

```text
app/                Application pages and API routes
db/                 Drizzle schema and D1 access
drizzle/            Generated database migrations
lib/                Shared types, scoring, CSV/search utilities, and server helpers
public/             Static assets
scripts/            Setup, install, build, migration, and validation helpers
tests/              Node test-runner suites
worker/             Cloudflare Worker entry point
```

## Current MVP boundaries

- Website auditing reviews publicly observable evidence from the homepage and up to four prioritized internal pages.
- Findings should be reviewed by a person before prospect outreach.
- Outreach opens as a prefilled Gmail draft for human review and sending; direct API sending requires a separately configured Google OAuth integration.
- Proposal acceptance records approval and contact information; a final service agreement, payment collection, and fulfillment onboarding remain human-controlled.
- Google Places and Business Profile integrations require separate credentials and are not configured in this repository.
- No fictional lead records are seeded. The workspace starts with only real user-imported or manually entered prospects.

## Data and security

The audit endpoint accepts only public HTTP or HTTPS websites. It blocks localhost, private IPv4 ranges, link-local addresses, custom ports, and non-HTML responses. Environment files and generated deployment artifacts are excluded through `.gitignore`.
