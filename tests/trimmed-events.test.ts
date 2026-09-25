import { describe, expect, it } from "vitest";
import {
  issueNumberFromPrTitle,
  shortTitle,
  extractOnrenderUrls,
  latestOnrenderUrl,
  displayRequestId,
} from "../src/pipeline/stages.js";
import {
  mapRepoEvent,
  issueNumFromUrl,
  findPrForIssue,
} from "../src/github/pipeline.js";
import type { GhPull } from "../src/github/client.js";

describe("null-safe helpers", () => {
  it("accepts null/undefined without throwing", () => {
    expect(issueNumberFromPrTitle(undefined)).toBe(null);
    expect(issueNumberFromPrTitle(null)).toBe(null);
    expect(shortTitle(undefined)).toBe("");
    expect(shortTitle(null)).toBe("");
    expect(extractOnrenderUrls(undefined)).toEqual([]);
    expect(extractOnrenderUrls(null)).toEqual([]);
    expect(issueNumFromUrl(undefined)).toBe(null);
    expect(issueNumFromUrl(null)).toBe(null);
    expect(displayRequestId(30, undefined)).toBe("#30");
  });
});

describe("trimmed GitHub Events API payloads", () => {
  const pulls: GhPull[] = [
    {
      number: 91,
      title: "#30 Lead sources",
      html_url: "https://github.com/cmiecz/waypathacademics/pull/91",
      state: "open",
      body: "Fixes #30",
      created_at: "2026-09-25T10:00:00Z",
      updated_at: "2026-09-25T10:00:00Z",
      merged_at: null,
      head: { ref: "cursor/lead-sources", sha: "abc" },
      user: null,
    },
  ];
  const titleByIssue = new Map([[30, "Lead sources"]]);
  const ctx = {
    titleByIssue,
    pulls,
    owner: "cmiecz",
    repo: "waypathacademics",
  };

  it("handles PullRequestEvent without title/html_url/body", () => {
    const item = mapRepoEvent(
      {
        id: "1",
        type: "PullRequestEvent",
        created_at: "2026-09-25T12:00:00Z",
        actor: { login: "product-architect-bot" },
        payload: {
          action: "opened",
          pull_request: {
            number: 91,
            url: "https://api.github.com/repos/cmiecz/waypathacademics/pulls/91",
            head: { ref: "cursor/lead-sources" },
            base: { ref: "main" },
          },
        },
      },
      ctx,
    );
    expect(item).not.toBeNull();
    expect(item!.issueNumber).toBe(30);
    expect(item!.displayId).toBe("#30 Lead sources");
    expect(item!.url).toBe(
      "https://github.com/cmiecz/waypathacademics/pull/91",
    );
    expect(item!.summary).toContain("Opened fix for review");
    expect(item!.summary).not.toMatch(/#91\b/);
  });

  it("builds html_url from owner/repo/number when PR is unknown", () => {
    const item = mapRepoEvent(
      {
        id: "2",
        type: "PullRequestEvent",
        created_at: "2026-09-25T12:00:00Z",
        actor: { login: "bot" },
        payload: {
          action: "synchronize",
          pull_request: { number: 999 },
        },
      },
      { ...ctx, pulls: [] },
    );
    expect(item).not.toBeNull();
    expect(item!.url).toBe(
      "https://github.com/cmiecz/waypathacademics/pull/999",
    );
    expect(item!.issueNumber).toBe(null);
  });

  it("handles IssuesEvent with missing title and html_url", () => {
    const item = mapRepoEvent(
      {
        id: "3",
        type: "IssuesEvent",
        created_at: "2026-09-25T12:00:00Z",
        actor: { login: "intake-bot" },
        payload: {
          action: "opened",
          issue: {
            number: 30,
            url: "https://api.github.com/repos/cmiecz/waypathacademics/issues/30",
          },
        },
      },
      ctx,
    );
    expect(item).not.toBeNull();
    expect(item!.displayId).toBe("#30 Lead sources");
    expect(item!.url).toBe(
      "https://github.com/cmiecz/waypathacademics/issues/30",
    );
  });

  it("handles IssueCommentEvent with trimmed issue/comment fields", () => {
    const item = mapRepoEvent(
      {
        id: "4",
        type: "IssueCommentEvent",
        created_at: "2026-09-25T12:00:00Z",
        actor: { login: "qa-engineer-bot" },
        payload: {
          action: "created",
          issue: { number: 30 },
          comment: { body: "QA PASS" },
        },
      },
      ctx,
    );
    expect(item).not.toBeNull();
    expect(item!.displayId).toBe("#30 Lead sources");
    expect(item!.summary).toContain("QA PASS");
    expect(item!.url).toBe(
      "https://github.com/cmiecz/waypathacademics/issues/30",
    );
  });

  it("does not throw when actor is missing", () => {
    expect(() =>
      mapRepoEvent(
        {
          id: "5",
          type: "PushEvent",
          created_at: "2026-09-25T12:00:00Z",
          actor: null,
          payload: { ref: "refs/heads/main", size: 1 },
        },
        ctx,
      ),
    ).not.toThrow();
  });
});

describe("preview URL prefers newer comments over PR body", () => {
  it("lets a later comment URL win", () => {
    const url = latestOnrenderUrl([
      "initial https://waypath-pr-old.onrender.com",
      "PR body still has https://waypath-pr-old.onrender.com",
      "redeployed https://waypath-pr-91.onrender.com",
    ]);
    expect(url).toBe("https://waypath-pr-91.onrender.com");
  });
});

describe("findPrForIssue with safe title", () => {
  it("still links via closing refs", () => {
    const pr = findPrForIssue(30, [
      {
        number: 91,
        title: "Lead sources fix",
        html_url: "https://github.com/cmiecz/waypathacademics/pull/91",
        state: "open",
        body: "Fixes #30",
        created_at: "",
        updated_at: "",
        merged_at: null,
        head: { ref: "x", sha: "y" },
        user: null,
      },
    ]);
    expect(pr?.number).toBe(91);
  });
});
