-- Data migration. Runs finalised before the confidence gate existed stored a
-- score with no provenance: nothing recorded how much of the rubric was
-- actually verified. Their confidence column defaulted to 0 when it was added,
-- which is the signature. A genuinely scored run always clears the threshold.
UPDATE audit_runs
SET overall_score = NULL,
    visibility_score = NULL,
    conversion_score = NULL,
    technical_score = NULL,
    trust_score = NULL,
    status = 'Complete with gaps',
    error = 'Invalidated: this run finished before the confidence gate existed, so its score has no recorded provenance. Re-run to score this prospect.'
WHERE confidence = 0 AND overall_score IS NOT NULL;
--> statement-breakpoint
-- Clear the headline score such a run wrote, but only where the engine is the
-- only thing that could have written it. The legacy /api/audit endpoint also
-- writes leads.score and its results are not in question here.
UPDATE leads
SET score = 0, last_audit_at = NULL
WHERE id IN (SELECT lead_id FROM audit_runs WHERE error LIKE 'Invalidated:%')
  AND NOT EXISTS (SELECT 1 FROM audits WHERE audits.lead_id = leads.id);
