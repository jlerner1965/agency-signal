# AgencySignal

AgencySignal is an evidence-led audit-to-sale workspace for local insurance agencies. It combines prospect tracking, public-homepage auditing, shareable reports, engagement signals, and outreach preparation in one focused application.

## Features

- Persistent agency lead pipeline
- Add and manage prospect records
- Live public-homepage audits
- Deterministic visibility, conversion, technical, and trust scoring
- Evidence-backed findings with recommendations
- Shareable prospect report pages
- Report-view tracking
- Personalized outreach copy
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

Generate a new database migration after editing `db/schema.ts`:

```bash
npm run db:generate
```

## Important directories

```text
app/                Application pages and API routes
db/                 Drizzle schema and D1 access
drizzle/            Generated database migrations
lib/                Shared types, sample data, and server helpers
public/             Static assets
scripts/            Installation, build, and validation helpers
worker/             Cloudflare Worker entry point
```

## Current MVP boundaries

- Website auditing reviews publicly observable homepage evidence.
- Findings should be reviewed by a person before prospect outreach.
- Outreach is copied for approval rather than automatically sent.
- Google Places and Business Profile integrations require separate credentials and are not configured in this repository.
- Sample agencies use fictional contact details and demonstration websites.

## Data and security

The audit endpoint accepts only public HTTP or HTTPS websites. It blocks localhost, private IPv4 ranges, link-local addresses, custom ports, and non-HTML responses. Environment files and generated deployment artifacts are excluded through `.gitignore`.
