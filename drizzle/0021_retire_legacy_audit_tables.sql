-- The legacy audit path is gone.
--
-- These two tables were written by the old /api/audit scoring route, which was
-- removed; migration 0014 cleared the scores it had left on leads. Everything
-- that still read them — the prospect tabs, both proposal builders, the public
-- brief, the copilot — now reads the engine's `audit_runs` and `findings`, so
-- nothing writes these and nothing reads them.
--
-- This destroys whatever rows they still hold. That is the point: they held
-- results produced under a different rubric and a different calibration, and
-- leaving them in place is how a reader ends up quoting them again.
DROP TABLE `audit_findings`;--> statement-breakpoint
DROP TABLE `audits`;
