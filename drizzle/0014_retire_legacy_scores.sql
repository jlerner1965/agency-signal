-- The legacy /api/audit path is gone. Any score it wrote was produced under a
-- different rubric and a different calibration, so it is cleared rather than
-- left to sit alongside engine scores that mean something else.
UPDATE leads
SET score = 0, visibility_score = 0, conversion_score = 0, technical_score = 0, trust_score = 0,
    score_source = '', score_confidence = 0, last_audit_at = NULL
WHERE score_source = 'legacy';
