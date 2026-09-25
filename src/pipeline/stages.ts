export type StageId =
  | "reported"
  | "being_built"
  | "ready_to_test"
  | "needs_fix"
  | "qa_passed"
  | "ready_to_merge";

export interface StageDef {
  id: StageId;
  label: string;
  githubLabel: string;
  owner: string;
  columnTitle: string;
}

export const STAGES: StageDef[] = [
  {
    id: "reported",
    label: "Reported",
    githubLabel: "status: reported",
    owner: "Product Architect",
    columnTitle: "Reported",
  },
  {
    id: "being_built",
    label: "Being built",
    githubLabel: "status: being built",
    owner: "Product Architect",
    columnTitle: "Being built",
  },
  {
    id: "ready_to_test",
    label: "Ready to test",
    githubLabel: "status: ready to test",
    owner: "QA Engineer",
    columnTitle: "Ready to test",
  },
  {
    id: "needs_fix",
    label: "Needs fix",
    githubLabel: "status: needs fix",
    owner: "Product Architect",
    columnTitle: "Needs fix",
  },
  {
    id: "qa_passed",
    label: "QA passed",
    githubLabel: "status: qa passed",
    owner: "Release Engineer",
    columnTitle: "QA passed",
  },
  {
    id: "ready_to_merge",
    label: "Ready to merge",
    githubLabel: "status: ready to merge",
    owner: "Cass",
    columnTitle: "Ready to merge",
  },
];

export const STAGE_BY_ID = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageDef>;

const LABEL_TO_STAGE = new Map(
  STAGES.map((s) => [s.githubLabel.toLowerCase(), s.id]),
);

/** Ignore internal trigger labels when mapping stage. */
export const IGNORED_LABELS = new Set(["product-intake"]);

export function normalizeLabelName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Map GitHub issue labels to a pipeline stage.
 * Missing status labels default to "reported".
 * Explicit status:* labels win; product-intake is ignored.
 */
export function stageFromLabels(labelNames: string[]): StageId {
  for (const raw of labelNames) {
    const name = normalizeLabelName(raw);
    if (IGNORED_LABELS.has(name)) continue;
    const stage = LABEL_TO_STAGE.get(name);
    if (stage) return stage;
  }
  return "reported";
}

export function stageOwner(stage: StageId): string {
  return STAGE_BY_ID[stage].owner;
}

export function displayRequestId(issueNumber: number, title: string): string {
  const short = shortTitle(title);
  return `#${issueNumber} ${short}`;
}

/** Strip leading "#N" / "Fixes #N" style prefixes from titles for display. */
export function shortTitle(title: string): string {
  return title
    .replace(/^#\d+\s*[:\-]?\s*/i, "")
    .replace(/^(fix|closes|close|resolve[sd]?)\s+#\d+\s*[:\-]?\s*/i, "")
    .trim() || title.trim();
}

/** Extract issue number from PR title like "#30 Lead sources" or "Fixes #30: …". */
export function issueNumberFromPrTitle(title: string): number | null {
  const hashFirst = title.match(/^#(\d+)\b/);
  if (hashFirst) return Number(hashFirst[1]);
  const fixes = title.match(/\b(?:fixes|closes|close|resolve[sd]?)\s+#(\d+)\b/i);
  if (fixes) return Number(fixes[1]);
  return null;
}

/** Closing references in PR body: Fixes #30, Closes #30, etc. */
export function issueNumbersFromClosingRefs(body: string | null | undefined): number[] {
  if (!body) return [];
  const re = /\b(?:fix(?:es)?|close[sd]?|resolve[sd]?)\s+#(\d+)\b/gi;
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    nums.add(Number(m[1]));
  }
  return [...nums];
}

const ONRENDER_RE =
  /https?:\/\/[a-z0-9][a-z0-9.-]*\.onrender\.com(?:\/[^\s)>"']*)?/gi;

export function extractOnrenderUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(ONRENDER_RE) ?? [];
  // Prefer unique, most recent last (caller can reverse)
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of found) {
    const clean = url.replace(/[.,;:]+$/, "");
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

export function latestOnrenderUrl(texts: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  for (const text of texts) {
    const urls = extractOnrenderUrls(text);
    if (urls.length) latest = urls[urls.length - 1]!;
  }
  return latest;
}

const QA_PASS_RE = /\bQA\s*PASS\b/i;
const QA_FAIL_RE = /\bQA\s*FAIL\b/i;

export type QaResult = "pass" | "fail" | null;

export function parseQaResult(text: string | null | undefined): QaResult {
  if (!text) return null;
  if (QA_PASS_RE.test(text)) return "pass";
  if (QA_FAIL_RE.test(text)) return "fail";
  return null;
}

export function isEscalatedOrBlocked(labelNames: string[]): boolean {
  return labelNames.some((n) => {
    const l = normalizeLabelName(n);
    return (
      l.includes("escalat") ||
      l.includes("blocked") ||
      l === "needs cass" ||
      l === "status: blocked"
    );
  });
}
