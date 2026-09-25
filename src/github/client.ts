export interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  state_reason: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: Array<{ name: string } | string>;
  user: { login: string } | null;
  body: string | null;
  pull_request?: { url: string } | null;
}

export interface GhPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  head: { ref: string; sha: string };
  user: { login: string } | null;
}

export interface GhComment {
  id: number;
  body: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
}

export interface GhEvent {
  id: string;
  type: string;
  created_at: string;
  actor: { login: string };
  payload: Record<string, unknown>;
  repo?: { name: string };
}

export interface GhTimelineItem {
  event: string;
  created_at: string;
  actor?: { login: string } | null;
  label?: { name: string };
  commit_id?: string;
  source?: { issue?: { pull_request?: boolean; number?: number; html_url?: string } };
  html_url?: string;
}

type CacheEntry = {
  etag?: string;
  data: unknown;
  fetchedAt: number;
};

export class GitHubClient {
  private cache = new Map<string, CacheEntry>();
  private rateRemaining: number | null = null;

  constructor(
    private token: string,
    private owner: string,
    private repo: string,
  ) {}

  get repoFullName(): string {
    return `${this.owner}/${this.repo}`;
  }

  getRateRemaining(): number | null {
    return this.rateRemaining;
  }

  private async request<T>(
    path: string,
    opts: { accept?: string; etagKey?: string } = {},
  ): Promise<T> {
    const url = path.startsWith("http")
      ? path
      : `https://api.github.com${path}`;
    const headers: Record<string, string> = {
      Accept: opts.accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "waypath-dashboard",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const cacheKey = opts.etagKey ?? url;
    const cached = this.cache.get(cacheKey);
    if (cached?.etag) headers["If-None-Match"] = cached.etag;

    const res = await fetch(url, { headers });
    const rem = res.headers.get("x-ratelimit-remaining");
    if (rem) this.rateRemaining = Number(rem);

    if (res.status === 304 && cached) {
      return cached.data as T;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub ${res.status} ${url}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as T;
    const etag = res.headers.get("etag") ?? undefined;
    this.cache.set(cacheKey, { etag, data, fetchedAt: Date.now() });
    return data;
  }

  private async requestAllPages<T>(
    path: string,
    maxPages = 5,
  ): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = path.startsWith("http")
      ? path
      : `https://api.github.com${path}`;
    let page = 0;
    while (nextUrl && page < maxPages) {
      page += 1;
      const requestUrl: string = nextUrl;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "waypath-dashboard",
      };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const res: Response = await fetch(requestUrl, { headers });
      const rem = res.headers.get("x-ratelimit-remaining");
      if (rem) this.rateRemaining = Number(rem);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
      }
      const chunk = (await res.json()) as T[];
      results.push(...chunk);
      const linkHeader: string | null = res.headers.get("link");
      nextUrl = null;
      if (linkHeader) {
        const nextPart = linkHeader
          .split(",")
          .find((part: string) => part.includes('rel="next"'));
        if (nextPart) {
          const match = nextPart.match(/<([^>]+)>/);
          if (match?.[1]) nextUrl = match[1];
        }
      }
    }
    return results;
  }

  labelNames(issue: GhIssue): string[] {
    return issue.labels.map((l) => (typeof l === "string" ? l : l.name));
  }

  async listOpenIssues(): Promise<GhIssue[]> {
    return this.requestAllPages<GhIssue>(
      `/repos/${this.owner}/${this.repo}/issues?state=open&per_page=100&sort=updated`,
    ).then((items) => items.filter((i) => !i.pull_request));
  }

  async listRecentlyClosedIssues(sinceIso: string): Promise<GhIssue[]> {
    const items = await this.requestAllPages<GhIssue>(
      `/repos/${this.owner}/${this.repo}/issues?state=closed&per_page=100&sort=updated`,
      3,
    );
    return items.filter(
      (i) =>
        !i.pull_request &&
        i.closed_at &&
        i.closed_at >= sinceIso &&
        (i.state_reason === "completed" || i.state_reason == null),
    );
  }

  async listPulls(state: "open" | "closed" | "all" = "open"): Promise<GhPull[]> {
    return this.requestAllPages<GhPull>(
      `/repos/${this.owner}/${this.repo}/pulls?state=${state}&per_page=100&sort=updated`,
      3,
    );
  }

  async listIssueComments(issueNumber: number): Promise<GhComment[]> {
    return this.requestAllPages<GhComment>(
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments?per_page=100`,
      2,
    );
  }

  async listPrComments(prNumber: number): Promise<GhComment[]> {
    // Issue comments endpoint covers PR conversation comments
    return this.listIssueComments(prNumber);
  }

  async listIssueTimeline(issueNumber: number): Promise<GhTimelineItem[]> {
    return this.requestAllPages<GhTimelineItem>(
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/timeline?per_page=100`,
      2,
    );
  }

  async listIssueEvents(issueNumber: number): Promise<
    Array<{
      id: number;
      event: string;
      created_at: string;
      actor: { login: string } | null;
      label?: { name: string };
    }>
  > {
    return this.requestAllPages(
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/events?per_page=100`,
      2,
    );
  }

  async listRepoEvents(): Promise<GhEvent[]> {
    return this.request<GhEvent[]>(
      `/repos/${this.owner}/${this.repo}/events?per_page=50`,
      { etagKey: `events:${this.owner}/${this.repo}` },
    );
  }

  async listRecentIssueComments(sinceIso: string): Promise<
    Array<GhComment & { issue_url: string }>
  > {
    const comments = await this.requestAllPages<
      GhComment & { issue_url: string }
    >(
      `/repos/${this.owner}/${this.repo}/issues/comments?per_page=100&sort=updated&direction=desc&since=${encodeURIComponent(sinceIso)}`,
      2,
    );
    return comments;
  }
}
