function dedupeAdjacent(lines: string[]) {
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped.length > 0 && deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }
  return deduped;
}

function normalizeLines(raw: string) {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""));
}

function trimTrailingBlankLines(lines: string[]) {
  const next = [...lines];
  while (next.length && next[next.length - 1].trim().length === 0) {
    next.pop();
  }
  return next;
}

export function normalizeMissionMarkdown(raw: string, projectName?: string) {
  const lines = normalizeLines(raw.trim());
  const memoryHeadingIndex = lines.findIndex((line) => /^#{1,3}\s*memory\b/i.test(line.trim()));
  const truncated = memoryHeadingIndex >= 0 ? lines.slice(0, memoryHeadingIndex) : lines;

  const filtered = truncated.filter((line) => !/^#{1,3}\s*mission\s*-?\s*$/i.test(line.trim()));
  const compact = trimTrailingBlankLines(dedupeAdjacent(filtered));
  const content = compact.join("\n").trim();

  if (!content) {
    return [
      `# Mission${projectName ? ` - ${projectName}` : ""}`,
      "",
      "## Purpose",
      projectName ? `Build and grow ${projectName}.` : "Define the company purpose and strategy.",
      "",
      "## Strategic North Star",
      "Ship high-leverage improvements that increase customer value and sustainable revenue.",
      "",
      "## Ideal Customer Profile",
      "To be refined from market signal.",
    ].join("\n");
  }

  const withHeading = content.startsWith("#")
    ? content
    : [`# Mission${projectName ? ` - ${projectName}` : ""}`, "", content].join("\n");

  return withHeading;
}

export function normalizeMemoryMarkdown(raw: string) {
  const lines = normalizeLines(raw.trim());
  const missionHeadingIndex = lines.findIndex((line) => /^#{1,3}\s*mission\b/i.test(line.trim()));
  const truncated = missionHeadingIndex >= 0 ? lines.slice(0, missionHeadingIndex) : lines;

  const compact = trimTrailingBlankLines(dedupeAdjacent(truncated));
  const content = compact.join("\n").trim();
  if (!content) {
    return [
      "# Operating Memory",
      "",
      "No major activity recorded yet. This document auto-refreshes from chat, email, tasks, approvals, deploys, and KPI events.",
    ].join("\n");
  }

  return content.startsWith("#") ? content : `# Operating Memory\n\n${content}`;
}

export function limitMarkdownLines(raw: string, maxLines: number) {
  const lines = normalizeLines(raw).filter((line) => line.trim().length > 0);
  const compact = dedupeAdjacent(lines);
  if (compact.length <= maxLines) return compact.join("\n");
  return `${compact.slice(0, maxLines).join("\n")}\n...`;
}
