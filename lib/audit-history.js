function parseChecks(value) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function compareAudits(current, previous) {
  if (!current || !previous || !current.confidenceScore || !previous.confidenceScore) return null;
  const currentChecks = new Map(parseChecks(current.checkSummary).map((item) => [item.id, item]));
  const previousChecks = new Map(parseChecks(previous.checkSummary).map((item) => [item.id, item]));
  const resolved = []; const regressed = [];
  for (const [id, item] of currentChecks) {
    const before = previousChecks.get(id);
    if (before?.status === "failed" && item.status === "passed") resolved.push(item.label);
    if (before?.status === "passed" && item.status === "failed") regressed.push(item.label);
  }
  const delta = (key) => Number(current[key] || 0) - Number(previous[key] || 0);
  return {
    previousAuditId: previous.id, currentAuditId: current.id, scoreDelta: delta("score"),
    visibilityDelta: delta("visibilityScore"), conversionDelta: delta("conversionScore"),
    technicalDelta: delta("technicalScore"), trustDelta: delta("trustScore"),
    confidenceDelta: delta("confidenceScore"), resolved, regressed,
    previousDate: previous.createdAt, currentDate: current.createdAt,
  };
}
