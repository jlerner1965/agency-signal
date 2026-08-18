# AgencySignal

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

Install and start the development server:

```bash
npm ci
npm run dev
```

Create a production build:

```bash
npm run build
```

Configure `AGENCYSIGNAL_LOGIN_EMAIL`, `AGENCYSIGNAL_PASSWORD_SALT`,
`AGENCYSIGNAL_PASSWORD_HASH`, and `AGENCYSIGNAL_SESSION_SECRET` in the hosted
runtime. Keep every authentication value out of the repository. Passwords are
verified with PBKDF2-SHA-256 at the runtime's maximum supported iteration count
and are never stored in plaintext.

Generate a new database migration after editing `db/schema.ts`:

```bash
npm run db:generate
```

## Important directories

```text
app/                Application pages and API routes
db/                 Drizzle schema and D1 access
drizzle/            Generated database migrations
lib/                Shared types, CSV/search utilities, and server helpers
public/             Static assets
scripts/            Installation, build, and validation helpers
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
