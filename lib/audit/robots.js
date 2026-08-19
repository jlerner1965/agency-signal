/**
 * A small robots.txt parser covering what a polite crawler actually needs:
 * the most specific matching group, Disallow/Allow with longest-match wins,
 * and Crawl-delay. Pure, so it is testable without a network.
 */

function parseGroups(text) {
  const groups = [];
  let current = null;
  let expectingAgent = true;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group of rules.
      if (!expectingAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      expectingAgent = true;
      continue;
    }
    if (!current) continue;
    expectingAgent = false;

    if (field === "disallow" || field === "allow") {
      current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "crawl-delay") {
      const delay = Number.parseFloat(value);
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
    }
  }
  return groups;
}

/** Our own token wins over `*`; otherwise the wildcard group applies. */
function selectGroup(groups, userAgentToken) {
  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && token.includes(agent)));
  if (specific.length) return specific;
  return groups.filter((group) => group.agents.includes("*"));
}

function ruleMatches(path, pattern) {
  if (pattern === "") return false;
  // robots.txt wildcards: * matches any run, $ anchors the end.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const anchored = escaped.endsWith("\\$") ? `^${escaped.slice(0, -2)}$` : `^${escaped}`;
  try { return new RegExp(anchored).test(path); } catch { return false; }
}

/**
 * @param {string} text robots.txt body, or "" when it could not be fetched
 * @param {string} userAgentToken our crawler token
 */
export function parseRobots(text, userAgentToken) {
  const groups = selectGroup(parseGroups(text), userAgentToken);
  const rules = groups.flatMap((group) => group.rules);
  const crawlDelay = groups.map((group) => group.crawlDelay).find((delay) => delay !== null) ?? null;

  return {
    crawlDelay,
    ruleCount: rules.length,
    /** Longest matching rule wins; Allow beats Disallow at equal length. */
    isAllowed(pathname) {
      let best = null;
      for (const rule of rules) {
        if (!ruleMatches(pathname, rule.path)) continue;
        if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

/** No robots.txt, or one we could not read, means no restrictions to honour. */
export function permissiveRobots() {
  return { crawlDelay: null, ruleCount: 0, isAllowed: () => true };
}
