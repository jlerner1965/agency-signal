function clamp(value, maximum = 100) {
  return Math.max(0, Math.min(maximum, Math.round(Number(value) || 0)));
}

function finding(title, evidence, recommendation, severity = "Medium") {
  return { category: "Google Presence", title, evidence, recommendation, severity };
}

/** A transparent, manually verified Google Business Profile score. */
export function buildGooglePresenceAudit(lead) {
  const reviewed = Boolean(lead.googleReviewedAt || lead.googleProfileUrl || lead.rating || lead.reviewCount);
  if (!reviewed) return { reviewed: false, score: 0, findings: [] };

  const rating = Number(lead.rating) || 0;
  const reviews = clamp(lead.reviewCount, 100000);
  const reviewAge = clamp(lead.googleReviewRecencyDays, 3650);
  const responseRate = clamp(lead.googleResponseRate);
  const photos = clamp(lead.googlePhotoCount, 100000);
  const postAge = clamp(lead.googlePostRecencyDays, 3650);
  const completeness = clamp(lead.googleProfileCompleteness);
  let score = 0;
  score += rating >= 4.5 ? 20 : rating >= 4 ? 15 : rating >= 3.5 ? 8 : rating > 0 ? 3 : 0;
  score += reviews >= 100 ? 20 : reviews >= 50 ? 16 : reviews >= 20 ? 12 : reviews >= 5 ? 6 : reviews > 0 ? 3 : 0;
  score += reviewAge > 0 && reviewAge <= 30 ? 15 : reviewAge <= 90 && reviewAge > 0 ? 8 : reviewAge > 0 ? 3 : 0;
  score += Math.round(responseRate * .15);
  score += Math.round(completeness * .15);
  score += photos >= 20 ? 8 : photos >= 5 ? 4 : photos > 0 ? 2 : 0;
  score += postAge > 0 && postAge <= 30 ? 5 : postAge <= 90 && postAge > 0 ? 2 : 0;
  score += lead.googleNapConsistent ? 2 : 0;

  const findings = [];
  if (!lead.googleProfileUrl) findings.push(finding("Google profile link is not recorded", "The audit does not yet include a verified Google Business Profile URL.", "Find and verify the correct profile before presenting this review.", "High"));
  if (rating && rating < 4.2) findings.push(finding("Star rating trails a strong local benchmark", `The recorded Google rating is ${rating.toFixed(1)} stars.`, "Build a compliant review-request process and address recurring service themes.", rating < 3.8 ? "High" : "Medium"));
  if (reviews < 20) findings.push(finding("Review volume provides limited proof", `${reviews} Google review${reviews === 1 ? " is" : "s are"} recorded.`, "Request reviews consistently after completed customer interactions.", "High"));
  if (!reviewAge || reviewAge > 60) findings.push(finding("Recent review activity is weak", reviewAge ? `The newest recorded review is about ${reviewAge} days old.` : "Review recency has not been verified.", "Create a steady review cadence so prospects see current customer experiences."));
  if (responseRate < 50) findings.push(finding("Owner response coverage is low", `${responseRate}% of reviews are recorded as having an owner response.`, "Respond professionally to positive and negative reviews, prioritizing recent feedback."));
  if (completeness < 80) findings.push(finding("Profile information is incomplete", `Profile completeness is recorded at ${completeness}%.`, "Complete services, description, hours, attributes, booking links, and other applicable fields.", completeness < 50 ? "High" : "Medium"));
  if (photos < 10) findings.push(finding("The profile needs stronger visual proof", `${photos} business photos are recorded.`, "Add current exterior, interior, team, service, and work-example photos."));
  if (!postAge || postAge > 60) findings.push(finding("Google updates are inactive", postAge ? `The newest recorded Google post is about ${postAge} days old.` : "No recent Google post has been recorded.", "Publish useful offers, updates, proof, or service information at least monthly.", "Low"));
  if (!lead.googleNapConsistent) findings.push(finding("Business information consistency is unverified", "Name, address, and phone consistency has not been confirmed.", "Compare the profile against the website and major directories, then correct mismatches."));

  return { reviewed: true, score: clamp(score), findings };
}
