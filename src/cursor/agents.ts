import type { CursorAgentSummary } from "../pipeline/types.js";

const API_BASE = "https://api.cursor.com";

interface RawAgentListItem {
  id: string;
  name: string;
  status: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  latestRunId?: string;
}

interface RawAgentDetail extends RawAgentListItem {
  repos?: Array<{
    url: string;
    startingRef?: string;
    prUrl?: string;
  }>;
  git?: {
    branches?: Array<{ branchName?: string; name?: string } | string>;
  };
}

interface RawRun {
  id: string;
  status: string;
}

/**
 * Official Cloud Agents API (v1): https://cursor.com/docs/cloud-agent/api/endpoints
 * Auth: Basic with API key as username (empty password), or Bearer.
 */
export async function fetchCursorAgents(opts: {
  apiKey: string;
  repoUrl: string;
  limit?: number;
}): Promise<CursorAgentSummary[]> {
  const { apiKey, repoUrl, limit = 20 } = opts;
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const listRes = await fetch(
    `${API_BASE}/v1/agents?limit=${limit}&includeArchived=false`,
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`Cursor API ${listRes.status}: ${text.slice(0, 200)}`);
  }
  const listJson = (await listRes.json()) as { items?: RawAgentListItem[] };
  const items = listJson.items ?? [];

  const normalizedRepo = normalizeRepo(repoUrl);
  const summaries: CursorAgentSummary[] = [];

  // Fetch details for a small set (repos/branches not on list items)
  for (const item of items.slice(0, limit)) {
    let detail: RawAgentDetail = item;
    try {
      const dRes = await fetch(`${API_BASE}/v1/agents/${item.id}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (dRes.ok) detail = (await dRes.json()) as RawAgentDetail;
    } catch {
      // keep list item
    }

    const repo = detail.repos?.[0];
    const agentRepo = repo?.url ? normalizeRepo(repo.url) : null;
    if (agentRepo && agentRepo !== normalizedRepo) {
      continue;
    }

    let latestRunStatus: string | null = null;
    if (item.latestRunId) {
      try {
        const rRes = await fetch(
          `${API_BASE}/v1/agents/${item.id}/runs/${item.latestRunId}`,
          { headers: { Authorization: `Basic ${auth}` } },
        );
        if (rRes.ok) {
          const run = (await rRes.json()) as RawRun | { run: RawRun };
          latestRunStatus = "run" in run ? run.run.status : run.status;
        }
      } catch {
        // ignore
      }
    }

    const branch = extractBranch(detail);

    summaries.push({
      id: item.id,
      name: item.name,
      status: item.status,
      url: item.url,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      branch,
      prUrl: repo?.prUrl ?? null,
      repoUrl: repo?.url ?? null,
      latestRunStatus,
    });
  }

  return summaries;
}

function normalizeRepo(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .toLowerCase();
}

function extractBranch(detail: RawAgentDetail): string | null {
  const branches = detail.git?.branches;
  if (branches && branches.length) {
    const first = branches[0];
    if (typeof first === "string") return first;
    return first?.branchName ?? first?.name ?? null;
  }
  return detail.repos?.[0]?.startingRef ?? null;
}
