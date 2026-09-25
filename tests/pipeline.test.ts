import { describe, expect, it } from "vitest";
import {
  stageFromLabels,
  displayRequestId,
  issueNumberFromPrTitle,
  issueNumbersFromClosingRefs,
  latestOnrenderUrl,
  parseQaResult,
  shortTitle,
  isEscalatedOrBlocked,
} from "../src/pipeline/stages.js";
import { findPrForIssue } from "../src/github/pipeline.js";
import { isUserAllowed, verifyBearerToken, signSession, verifySession } from "../src/config.js";
import { MemoryEventStore } from "../src/events/store.js";

describe("stage mapping", () => {
  it("maps each status label to the right stage", () => {
    expect(stageFromLabels(["status: reported"])).toBe("reported");
    expect(stageFromLabels(["status: being built"])).toBe("being_built");
    expect(stageFromLabels(["status: ready to test"])).toBe("ready_to_test");
    expect(stageFromLabels(["status: needs fix"])).toBe("needs_fix");
    expect(stageFromLabels(["status: qa passed"])).toBe("qa_passed");
    expect(stageFromLabels(["status: ready to merge"])).toBe("ready_to_merge");
  });

  it("defaults unlabeled issues to reported and ignores product-intake", () => {
    expect(stageFromLabels([])).toBe("reported");
    expect(stageFromLabels(["product-intake"])).toBe("reported");
    expect(stageFromLabels(["product-intake", "bug"])).toBe("reported");
    expect(stageFromLabels(["product-intake", "status: ready to test"])).toBe(
      "ready_to_test",
    );
  });

  it("is case-insensitive on labels", () => {
    expect(stageFromLabels(["Status: Ready To Test"])).toBe("ready_to_test");
  });

  it("flags escalated/blocked for needs-Cass counting", () => {
    expect(isEscalatedOrBlocked(["blocked"])).toBe(true);
    expect(isEscalatedOrBlocked(["status: blocked"])).toBe(true);
    expect(isEscalatedOrBlocked(["needs cass"])).toBe(true);
    expect(isEscalatedOrBlocked(["status: reported"])).toBe(false);
  });
});

describe("one-number display and PR linking", () => {
  it("shows only issue number + short title", () => {
    expect(displayRequestId(30, "Lead sources")).toBe("#30 Lead sources");
    expect(displayRequestId(30, "#30 Lead sources")).toBe("#30 Lead sources");
    expect(shortTitle("Fixes #12: Invite reminder")).toMatch(/Invite reminder/i);
  });

  it("parses issue from PR title and closing refs", () => {
    expect(issueNumberFromPrTitle("#30 Lead sources")).toBe(30);
    expect(issueNumberFromPrTitle("Fixes #30: Lead sources")).toBe(30);
    expect(
      issueNumbersFromClosingRefs("Fixes #30\n\nAlso closes #99"),
    ).toEqual([30, 99]);
  });

  it("links PR to issue without exposing PR number as an identifier", () => {
    const pulls = [
      {
        number: 91,
        title: "#30 Lead sources",
        html_url: "https://github.com/cmiecz/waypathacademics/pull/91",
        state: "open",
        body: "Fixes #30",
        created_at: "",
        updated_at: "",
        merged_at: null,
        head: { ref: "x", sha: "y" },
        user: null,
      },
    ];
    const pr = findPrForIssue(30, pulls);
    expect(pr?.number).toBe(91);
    const display = displayRequestId(30, "Lead sources");
    expect(display).toBe("#30 Lead sources");
    expect(display).not.toContain("#91");
    expect(display).not.toMatch(/PR\s*#?91/i);
  });

  it("picks the most recent onrender preview URL", () => {
    const url = latestOnrenderUrl([
      "old https://old.onrender.com/path",
      "newer https://waypath-pr-91.onrender.com and https://waypath-pr-91.onrender.com/login",
    ]);
    expect(url).toBe("https://waypath-pr-91.onrender.com/login");
  });

  it("parses QA PASS / FAIL", () => {
    expect(parseQaResult("QA PASS on preview")).toBe("pass");
    expect(parseQaResult("Result: QA FAIL — SMS broken")).toBe("fail");
    expect(parseQaResult("looking good")).toBe(null);
  });
});

describe("event auth", () => {
  it("rejects missing or wrong bearer tokens", () => {
    const token = "super-secret-bot-token";
    expect(verifyBearerToken(undefined, token)).toBe(false);
    expect(verifyBearerToken("Bearer wrong", token)).toBe(false);
    expect(verifyBearerToken("Token super-secret-bot-token", token)).toBe(
      false,
    );
    expect(verifyBearerToken("Bearer super-secret-bot-token", token)).toBe(
      true,
    );
  });

  it("stores started/finished and tracks open work", async () => {
    const store = new MemoryEventStore();
    await store.add({
      bot: "QA Engineer",
      issue: 30,
      action: "started",
      message: "testing",
    });
    let active = await store.activeStarted();
    expect(active).toHaveLength(1);
    expect(active[0]!.issue).toBe(30);

    await store.add({
      bot: "QA Engineer",
      issue: 30,
      action: "finished",
      message: "done",
    });
    active = await store.activeStarted();
    expect(active).toHaveLength(0);
  });
});

describe("OAuth allowlist", () => {
  it("allows only configured GitHub usernames (case-insensitive)", () => {
    const allowed = ["cmiecz", "mwaldau71"];
    expect(isUserAllowed("cmiecz", allowed)).toBe(true);
    expect(isUserAllowed("CMIECZ", allowed)).toBe(true);
    expect(isUserAllowed("mwaldau71", allowed)).toBe(true);
    expect(isUserAllowed("someone-else", allowed)).toBe(false);
  });

  it("signs and verifies session cookies", () => {
    const secret = "test-session-secret";
    const token = signSession(
      { login: "cmiecz", exp: Date.now() + 60_000 },
      secret,
    );
    const data = verifySession(token, secret);
    expect(data?.login).toBe("cmiecz");
    expect(verifySession(token + "x", secret)).toBe(null);
    expect(verifySession(undefined, secret)).toBe(null);
  });

  it("rejects expired sessions", () => {
    const secret = "test-session-secret";
    const token = signSession(
      { login: "cmiecz", exp: Date.now() - 1000 },
      secret,
    );
    expect(verifySession(token, secret)).toBe(null);
  });
});
