import type { EventStore } from "../events/store.js";
import type { GitHubClient, GhIssue, GhPull, GhComment } from "./client.js";
import {
  STAGES,
  displayRequestId,
  stageFromLabels,
  stageOwner,
  issueNumberFromPrTitle,
  issueNumbersFromClosingRefs,
  latestOnrenderUrl,
  parseQaResult,
  isEscalatedOrBlocked,
  shortTitle,
  type StageId,
} from "../pipeline/stages.js";
import type {
  ActivityItem,
  BotEvent,
  CursorAgentSummary,
  DashboardSnapshot,
  RequestCard,
  ShippedItem,
  StageCounts,
  WorkingNowItem,
} from "../pipeline/types.js";

function issueNumFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/\/issues\/(\d+)/) || url.match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function githubIssueUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}

function githubPullUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}

function htmlUrlFromApiOrFallback(
  htmlUrl: string | null | undefined,
  apiUrl: string | null | undefined,
  fallback: string,
): string {
  if (htmlUrl) return htmlUrl;
  if (apiUrl && !apiUrl.includes("api.github.com")) return apiUrl;
  return fallback;
}

function findPrForIssue(
  issueNumber: number,
  pulls: GhPull[],
): GhPull | null {
  for (const pr of pulls) {
    if (issueNumberFromPrTitle(pr.title) === issueNumber) return pr;
    if (issueNumbersFromClosingRefs(pr.body).includes(issueNumber)) return pr;
  }
  return null;
}

function stageEnteredAt(
  events: Array<{ event: string; created_at: string; label?: { name: string } }>,
  stageLabel: string,
): string | null {
  const target = stageLabel.toLowerCase();
  let latest: string | null = null;
  for (const e of events) {
    if (e.event === "labeled" && e.label?.name?.toLowerCase() === target) {
      latest = e.created_at;
    }
  }
  return latest;
}

export async function buildDashboard(opts: {
  github: GitHubClient | null;
  events: EventStore;
  demoMode: boolean;
  demoSnapshot?: DashboardSnapshot;
  cursorAgents: CursorAgentSummary[] | null;
  cursorAgentsError: string | null;
}): Promise<DashboardSnapshot> {
  if (opts.demoMode && opts.demoSnapshot) {
    return {
      ...opts.demoSnapshot,
      cursorAgents: opts.cursorAgents,
      cursorAgentsError: opts.cursorAgentsError,
      generatedAt: new Date().toISOString(),
    };
  }
  if (!opts.github) {
    throw new Error("GitHub client required when DEMO_MODE is false");
  }

  const github = opts.github;
  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sinceActivity = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [openIssues, closedIssues, openPulls, closedPulls, botEvents, activeStarted, repoEvents, recentComments] =
    await Promise.all([
      github.listOpenIssues(),
      github.listRecentlyClosedIssues(since14),
      github.listPulls("open"),
      github.listPulls("closed"),
      opts.events.list(300),
      opts.events.activeStarted(),
      github.listRepoEvents().catch(() => [] as Awaited<ReturnType<GitHubClient["listRepoEvents"]>>),
      github.listRecentIssueComments(sinceActivity).catch(() => []),
    ]);

  const allPulls = [...openPulls, ...closedPulls];

  // Prefetch comments & label events for open issues (bounded concurrency)
  const issueExtras = new Map<
    number,
    {
      comments: GhComment[];
      prComments: GhComment[];
      labelEvents: Array<{ event: string; created_at: string; label?: { name: string } }>;
      pr: GhPull | null;
    }
  >();

  const queue = openIssues.slice(0, 80);
  const concurrency = 6;
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const issue = queue[i]!;
      const pr = findPrForIssue(issue.number, allPulls);
      const [comments, prComments, labelEvents] = await Promise.all([
        github.listIssueComments(issue.number).catch(() => [] as GhComment[]),
        pr
          ? github.listPrComments(pr.number).catch(() => [] as GhComment[])
          : Promise.resolve([] as GhComment[]),
        github.listIssueEvents(issue.number).catch(() => []),
      ]);
      issueExtras.set(issue.number, {
        comments,
        prComments,
        labelEvents,
        pr,
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const columns = Object.fromEntries(STAGES.map((s) => [s.id, [] as RequestCard[]])) as Record<
    StageId,
    RequestCard[]
  >;

  const titleByIssue = new Map<number, string>();
  for (const issue of openIssues) titleByIssue.set(issue.number, issue.title);
  for (const issue of closedIssues) titleByIssue.set(issue.number, issue.title);

  const activeByIssue = new Map<number, BotEvent>();
  for (const e of activeStarted) {
    activeByIssue.set(e.issue, e);
  }

  for (const issue of openIssues) {
    try {
      const labels = github.labelNames(issue);
      const stage = stageFromLabels(labels);
      const extras = issueExtras.get(issue.number);
      const pr = extras?.pr ?? findPrForIssue(issue.number, allPulls);
      const stageDef = STAGES.find((s) => s.id === stage)!;
      const entered =
        extras?.labelEvents
          ? stageEnteredAt(extras.labelEvents, stageDef.githubLabel)
          : null;

      // Bodies first (older), then comments in chronological order so the latest
      // onrender URL from a comment wins over a stale URL left in the PR body.
      const commentsChrono = [
        ...(extras?.comments ?? []),
        ...(extras?.prComments ?? []),
      ].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const previewUrl = latestOnrenderUrl([
        issue.body,
        pr?.body,
        ...commentsChrono.map((c) => c.body),
      ]);

      let qaResult: "pass" | "fail" | null = null;
      const prCommentsChrono = [...(extras?.prComments ?? [])].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      for (const c of prCommentsChrono) {
        const r = parseQaResult(c.body);
        if (r) qaResult = r;
      }

      const issueComments = extras?.comments ?? [];
      const latestComment = [
        ...issueComments,
        ...(extras?.prComments ?? []),
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];

      const latestBot = botEvents.find((e) => e.issue === issue.number);
      let latestActivity: string | null = null;
      let latestActivityAt: string | null = null;
      if (latestBot && latestComment) {
        if (
          new Date(latestBot.createdAt) >= new Date(latestComment.created_at)
        ) {
          latestActivity = `${latestBot.bot}: ${latestBot.message}`;
          latestActivityAt = latestBot.createdAt;
        } else {
          latestActivity = `${latestComment.user?.login ?? "someone"}: ${snippet(latestComment.body)}`;
          latestActivityAt = latestComment.created_at;
        }
      } else if (latestBot) {
        latestActivity = `${latestBot.bot}: ${latestBot.message}`;
        latestActivityAt = latestBot.createdAt;
      } else if (latestComment) {
        latestActivity = `${latestComment.user?.login ?? "someone"}: ${snippet(latestComment.body)}`;
        latestActivityAt = latestComment.created_at;
      }

      const working = activeByIssue.get(issue.number);

      const card: RequestCard = {
        issueNumber: issue.number,
        title: issue.title,
        displayId: displayRequestId(issue.number, issue.title),
        stage,
        owner: stageOwner(stage),
        htmlUrl: issue.html_url,
        stageEnteredAt: entered ?? issue.created_at,
        latestActivity,
        latestActivityAt,
        reviewUrl: pr ? pr.html_url : null,
        previewUrl,
        qaResult,
        workingNow: Boolean(working),
        workingBot: working?.bot ?? null,
        escalated: isEscalatedOrBlocked(labels),
        labels,
      };
      columns[stage].push(card);
    } catch (err) {
      console.error("[pipeline] skipped issue", issue.number, err);
    }
  }

  for (const stage of STAGES) {
    columns[stage.id].sort((a, b) => {
      const at = a.stageEnteredAt ? new Date(a.stageEnteredAt).getTime() : 0;
      const bt = b.stageEnteredAt ? new Date(b.stageEnteredAt).getTime() : 0;
      return at - bt;
    });
  }

  const workingNow: WorkingNowItem[] = activeStarted.map((e) => ({
    bot: e.bot,
    issueNumber: e.issue,
    displayId: displayRequestId(
      e.issue,
      titleByIssue.get(e.issue) ?? (shortTitle(e.message) || `Issue ${e.issue}`),
    ),
    message: e.message,
    startedAt: e.createdAt,
    url: e.url,
  }));

  const activity = mergeActivity({
    botEvents,
    repoEvents,
    recentComments,
    titleByIssue,
    pulls: allPulls,
    owner: github.ownerName,
    repo: github.repoName,
  });

  const shipped: ShippedItem[] = [];
  for (const issue of closedIssues) {
    if (issue.state_reason === "not_planned") continue;
    const pr = findPrForIssue(issue.number, closedPulls);
    shipped.push({
      issueNumber: issue.number,
      displayId: displayRequestId(issue.number, issue.title),
      title: issue.title,
      htmlUrl: issue.html_url,
      closedAt: issue.closed_at!,
      mergedAt: pr?.merged_at ?? issue.closed_at,
      reviewUrl: pr?.html_url ?? null,
    });
  }
  shipped.sort(
    (a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime(),
  );

  const counts = computeCounts(columns, shipped.length);

  return {
    generatedAt: new Date().toISOString(),
    demoMode: false,
    timezone: "America/New_York",
    counts,
    columns,
    workingNow,
    activity: activity.slice(0, 80),
    shipped: shipped.slice(0, 40),
    cursorAgents: opts.cursorAgents,
    cursorAgentsError: opts.cursorAgentsError,
  };
}

export function computeCounts(
  columns: Record<StageId, RequestCard[]>,
  shipped14d: number,
): StageCounts {
  const counts: StageCounts = {
    reported: columns.reported.length,
    being_built: columns.being_built.length,
    ready_to_test: columns.ready_to_test.length,
    needs_fix: columns.needs_fix.length,
    qa_passed: columns.qa_passed.length,
    ready_to_merge: columns.ready_to_merge.length,
    needsCass: 0,
    open: 0,
    shipped14d,
  };
  let open = 0;
  let needsCass = columns.ready_to_merge.length;
  for (const stage of STAGES) {
    open += columns[stage.id].length;
    for (const card of columns[stage.id]) {
      if (card.escalated && stage.id !== "ready_to_merge") needsCass += 1;
    }
  }
  counts.open = open;
  counts.needsCass = needsCass;
  return counts;
}

function snippet(body: string | null | undefined, max = 120): string {
  if (!body) return "";
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

function mergeActivity(opts: {
  botEvents: BotEvent[];
  repoEvents: Array<{
    id: string;
    type: string;
    created_at: string;
    actor: { login: string };
    payload: Record<string, unknown>;
  }>;
  recentComments: Array<{
    id: number;
    body: string;
    html_url: string;
    created_at: string;
    user: { login: string } | null;
    issue_url: string;
  }>;
  titleByIssue: Map<number, string>;
  pulls: GhPull[];
  owner: string;
  repo: string;
}): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const e of opts.botEvents) {
    try {
      const displayId = displayRequestId(
        e.issue,
        opts.titleByIssue.get(e.issue) ?? `Issue ${e.issue}`,
      );
      items.push({
        id: `bot-${e.id}`,
        at: e.createdAt,
        actor: e.bot,
        summary: `${e.action}: ${e.message}`,
        url: e.url ?? null,
        source: "bot",
        issueNumber: e.issue,
        displayId,
      });
    } catch (err) {
      console.error("[activity] skipped bot event", e.id, err);
    }
  }

  for (const c of opts.recentComments) {
    try {
      const num = issueNumFromUrl(c.issue_url) ?? issueNumFromUrl(c.html_url);
      const displayId = num
        ? displayRequestId(num, opts.titleByIssue.get(num) ?? `Issue ${num}`)
        : null;
      items.push({
        id: `comment-${c.id}`,
        at: c.created_at,
        actor: c.user?.login ?? "unknown",
        summary: snippet(c.body),
        url: c.html_url,
        source: "github",
        issueNumber: num,
        displayId,
      });
    } catch (err) {
      console.error("[activity] skipped comment", c.id, err);
    }
  }

  for (const ev of opts.repoEvents) {
    try {
      const mapped = mapRepoEvent(ev, {
        titleByIssue: opts.titleByIssue,
        pulls: opts.pulls,
        owner: opts.owner,
        repo: opts.repo,
      });
      if (mapped) items.push(mapped);
    } catch (err) {
      console.error("[activity] skipped repo event", ev.id, ev.type, err);
    }
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

type TrimmedPr = {
  number?: number;
  title?: string | null;
  html_url?: string | null;
  url?: string | null;
  merged?: boolean;
  body?: string | null;
};

type TrimmedIssue = {
  number?: number;
  title?: string | null;
  html_url?: string | null;
  url?: string | null;
};

/** Exported for tests — maps one GitHub Events API item defensively. */
export function mapRepoEvent(
  ev: {
    id: string;
    type: string;
    created_at: string;
    actor?: { login?: string } | null;
    payload: Record<string, unknown>;
  },
  ctx: {
    titleByIssue: Map<number, string>;
    pulls: GhPull[];
    owner: string;
    repo: string;
  },
): ActivityItem | null {
  const actor = ev.actor?.login ?? "unknown";
  if (ev.type === "PullRequestEvent") {
    const payload = ev.payload as {
      action?: string;
      pull_request?: TrimmedPr;
    };
    const pr = payload.pull_request;
    if (!pr?.number) return null;
    const full = ctx.pulls.find((p) => p.number === pr.number);
    const title =
      pr.title ?? full?.title ?? ctx.titleByIssue.get(pr.number) ?? "";
    const htmlUrl = htmlUrlFromApiOrFallback(
      pr.html_url,
      pr.url,
      full?.html_url ?? githubPullUrl(ctx.owner, ctx.repo, pr.number),
    );
    const issueNum =
      issueNumberFromPrTitle(title) ??
      (full ? issueNumberFromPrTitle(full.title) : null) ??
      (full ? issueNumbersFromClosingRefs(full.body)[0] ?? null : null) ??
      issueNumbersFromClosingRefs(pr.body)[0] ??
      null;
    const displayTitle =
      (issueNum ? ctx.titleByIssue.get(issueNum) : undefined) ??
      (title || (issueNum ? `Issue ${issueNum}` : ""));
    const displayId = issueNum
      ? displayRequestId(issueNum, displayTitle)
      : null;
    const merged = Boolean(pr.merged ?? full?.merged_at);
    let summary = `PR ${payload.action ?? "updated"}`;
    if (payload.action === "closed" && merged) summary = "Merged fix";
    else if (payload.action === "opened") summary = "Opened fix for review";
    else if (payload.action === "closed") summary = "Closed PR without merge";
    return {
      id: `ghe-${ev.id}`,
      at: ev.created_at,
      actor,
      summary: displayId ? `${summary} · ${displayId}` : summary,
      url: htmlUrl,
      source: "github",
      issueNumber: issueNum,
      displayId,
    };
  }
  if (ev.type === "IssuesEvent") {
    const payload = ev.payload as {
      action?: string;
      issue?: TrimmedIssue;
    };
    const issue = payload.issue;
    if (!issue?.number) return null;
    const title =
      issue.title ??
      ctx.titleByIssue.get(issue.number) ??
      `Issue ${issue.number}`;
    const displayId = displayRequestId(issue.number, title);
    const htmlUrl = htmlUrlFromApiOrFallback(
      issue.html_url,
      issue.url,
      githubIssueUrl(ctx.owner, ctx.repo, issue.number),
    );
    return {
      id: `ghe-${ev.id}`,
      at: ev.created_at,
      actor,
      summary: `Issue ${payload.action ?? "updated"} · ${displayId}`,
      url: htmlUrl,
      source: "github",
      issueNumber: issue.number,
      displayId,
    };
  }
  if (ev.type === "PushEvent") {
    const payload = ev.payload as {
      ref?: string;
      size?: number;
      commits?: Array<{ message: string }>;
    };
    const branch = (payload.ref ?? "").replace("refs/heads/", "");
    const n = payload.size ?? payload.commits?.length ?? 0;
    return {
      id: `ghe-${ev.id}`,
      at: ev.created_at,
      actor,
      summary: `Pushed ${n} commit${n === 1 ? "" : "s"} to ${branch}`,
      url: null,
      source: "github",
      issueNumber: null,
      displayId: null,
    };
  }
  if (ev.type === "IssueCommentEvent") {
    const payload = ev.payload as {
      action?: string;
      issue?: TrimmedIssue;
      comment?: {
        html_url?: string | null;
        url?: string | null;
        body?: string | null;
      };
    };
    if (!payload.issue?.number) return null;
    const title =
      payload.issue.title ??
      ctx.titleByIssue.get(payload.issue.number) ??
      `Issue ${payload.issue.number}`;
    const displayId = displayRequestId(payload.issue.number, title);
    const commentUrl = htmlUrlFromApiOrFallback(
      payload.comment?.html_url,
      payload.comment?.url,
      githubIssueUrl(ctx.owner, ctx.repo, payload.issue.number),
    );
    return {
      id: `ghe-${ev.id}`,
      at: ev.created_at,
      actor,
      summary: `Commented on ${displayId}: ${snippet(payload.comment?.body, 80)}`,
      url: commentUrl,
      source: "github",
      issueNumber: payload.issue.number,
      displayId,
    };
  }
  return null;
}

export { findPrForIssue, displayRequestId, issueNumFromUrl };
