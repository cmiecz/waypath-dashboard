import {
  STAGES,
  displayRequestId,
  assignmentTextForCard,
  waitingOnNamesFromLabels,
  type StageId,
} from "../pipeline/stages.js";
import { computeCounts } from "../github/pipeline.js";
import type {
  ActivityItem,
  BotEvent,
  CursorAgentSummary,
  DashboardSnapshot,
  RequestCard,
  ShippedItem,
  WorkingNowItem,
} from "../pipeline/types.js";

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

function hoursAgo(n: number): string {
  return minutesAgo(n * 60);
}

function daysAgo(n: number): string {
  return hoursAgo(n * 24);
}

function card(
  partial: Omit<RequestCard, "displayId" | "assignmentText" | "waitingOn"> & {
    displayId?: string;
    assignmentText?: string;
    waitingOn?: string[];
  },
): RequestCard {
  const labels = partial.labels ?? [];
  return {
    ...partial,
    displayId:
      partial.displayId ?? displayRequestId(partial.issueNumber, partial.title),
    assignmentText:
      partial.assignmentText ?? assignmentTextForCard(partial.stage, labels),
    waitingOn: partial.waitingOn ?? waitingOnNamesFromLabels(labels),
  };
}

export function buildDemoSnapshot(): DashboardSnapshot {
  const columns = Object.fromEntries(STAGES.map((s) => [s.id, [] as RequestCard[]])) as Record<
    StageId,
    RequestCard[]
  >;

  columns.reported = [
    card({
      issueNumber: 42,
      title: "Parent weekly digest email",
      stage: "reported",
      owner: "Product Architect",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/42",
      stageEnteredAt: hoursAgo(5),
      latestActivity: "Intake: Filed from product intake form",
      latestActivityAt: hoursAgo(5),
      reviewUrl: null,
      previewUrl: null,
      qaResult: null,
      workingNow: false,
      workingBot: null,
      escalated: false,
      labels: ["status: reported"],
    }),
  ];

  columns.waiting_on_input = [
    card({
      issueNumber: 35,
      title: "Advisor dashboard filter presets",
      stage: "waiting_on_input",
      owner: "input",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/35",
      stageEnteredAt: hoursAgo(8),
      latestActivity:
        "Product Architect: Plan ready — need Cass and Matt to confirm scope",
      latestActivityAt: hoursAgo(8),
      reviewUrl: null,
      previewUrl: null,
      qaResult: null,
      workingNow: false,
      workingBot: null,
      escalated: false,
      labels: [
        "status: waiting on input",
        "waiting on: matt",
        "waiting on: cass",
      ],
    }),
  ];

  columns.being_built = [
    card({
      issueNumber: 38,
      title: "Calendar sync timezone edge case",
      stage: "being_built",
      owner: "Product Architect",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/38",
      stageEnteredAt: hoursAgo(2),
      latestActivity: "Product Architect: Building fix via Cursor cloud agent",
      latestActivityAt: minutesAgo(18),
      reviewUrl: null,
      previewUrl: null,
      qaResult: null,
      workingNow: true,
      workingBot: "Product Architect",
      escalated: false,
      labels: ["status: being built"],
    }),
  ];

  columns.ready_to_test = [
    card({
      issueNumber: 30,
      title: "Lead sources",
      stage: "ready_to_test",
      owner: "QA Engineer",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/30",
      stageEnteredAt: hoursAgo(1),
      latestActivity: "QA Engineer: Starting preview walkthrough",
      latestActivityAt: minutesAgo(10),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/91",
      previewUrl: "https://waypath-pr-91.onrender.com",
      qaResult: null,
      workingNow: true,
      workingBot: "QA Engineer",
      escalated: false,
      labels: ["status: ready to test"],
    }),
    card({
      issueNumber: 27,
      title: "Student roster CSV export",
      stage: "ready_to_test",
      owner: "QA Engineer",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/27",
      stageEnteredAt: hoursAgo(3),
      latestActivity: "Product Architect: Preview is up — ready for QA",
      latestActivityAt: hoursAgo(3),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/88",
      previewUrl: "https://waypath-pr-88.onrender.com",
      qaResult: null,
      workingNow: false,
      workingBot: null,
      escalated: false,
      labels: ["status: ready to test"],
    }),
  ];

  columns.needs_fix = [
    card({
      issueNumber: 22,
      title: "Enrollment confirmation SMS",
      stage: "needs_fix",
      owner: "Product Architect",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/22",
      stageEnteredAt: hoursAgo(6),
      latestActivity:
        "QA Engineer: QA FAIL — SMS not sent for international numbers",
      latestActivityAt: hoursAgo(6),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/79",
      previewUrl: "https://waypath-pr-79.onrender.com",
      qaResult: "fail",
      workingNow: false,
      workingBot: null,
      escalated: false,
      labels: ["status: needs fix"],
    }),
  ];

  columns.qa_passed = [
    card({
      issueNumber: 19,
      title: "Advisor notes rich text",
      stage: "qa_passed",
      owner: "Release Engineer",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/19",
      stageEnteredAt: hoursAgo(4),
      latestActivity: "QA Engineer: QA PASS on preview",
      latestActivityAt: hoursAgo(4),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/74",
      previewUrl: "https://waypath-pr-74.onrender.com",
      qaResult: "pass",
      workingNow: false,
      workingBot: null,
      escalated: false,
      labels: ["status: qa passed"],
    }),
  ];

  columns.ready_to_merge = [
    card({
      issueNumber: 15,
      title: "Campus map pin accuracy",
      stage: "ready_to_merge",
      owner: "Cass",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/15",
      stageEnteredAt: hoursAgo(1.5),
      latestActivity: "Release Engineer: Release verdict — ship it",
      latestActivityAt: hoursAgo(1.5),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/70",
      previewUrl: "https://waypath-pr-70.onrender.com",
      qaResult: "pass",
      workingNow: false,
      workingBot: null,
      escalated: false,
      labels: ["status: ready to merge"],
    }),
  ];

  const workingNow: WorkingNowItem[] = [
    {
      bot: "QA Engineer",
      issueNumber: 30,
      displayId: "#30 Lead sources",
      message: "Testing preview walkthrough",
      startedAt: minutesAgo(10),
      url: "https://waypath-pr-91.onrender.com",
    },
    {
      bot: "Product Architect",
      issueNumber: 38,
      displayId: "#38 Calendar sync timezone edge case",
      message: "Building fix via Cursor cloud agent",
      startedAt: minutesAgo(18),
    },
  ];

  const activity: ActivityItem[] = [
    {
      id: "demo-1",
      at: minutesAgo(4),
      actor: "QA Engineer",
      summary: "started: Testing preview walkthrough",
      url: "https://waypath-pr-91.onrender.com",
      source: "bot",
      issueNumber: 30,
      displayId: "#30 Lead sources",
    },
    {
      id: "demo-2",
      at: minutesAgo(12),
      actor: "product-architect-bot",
      summary:
        "Commented on #30 Lead sources: Preview ready at https://waypath-pr-91.onrender.com",
      url: "https://github.com/cmiecz/waypathacademics/issues/30",
      source: "github",
      issueNumber: 30,
      displayId: "#30 Lead sources",
    },
    {
      id: "demo-3",
      at: minutesAgo(18),
      actor: "Product Architect",
      summary: "started: Building fix via Cursor cloud agent",
      url: null,
      source: "bot",
      issueNumber: 38,
      displayId: "#38 Calendar sync timezone edge case",
    },
    {
      id: "demo-4",
      at: hoursAgo(1.5),
      actor: "Release Engineer",
      summary: "note: Release verdict — ship it · #15 Campus map pin accuracy",
      url: "https://github.com/cmiecz/waypathacademics/pull/70",
      source: "bot",
      issueNumber: 15,
      displayId: "#15 Campus map pin accuracy",
    },
    {
      id: "demo-5",
      at: hoursAgo(4),
      actor: "qa-engineer-bot",
      summary: "Commented: QA PASS on preview",
      url: "https://github.com/cmiecz/waypathacademics/pull/74",
      source: "github",
      issueNumber: 19,
      displayId: "#19 Advisor notes rich text",
    },
    {
      id: "demo-6",
      at: daysAgo(2),
      actor: "cmiecz",
      summary: "Merged fix · #12 Invite reminder cadence",
      url: "https://github.com/cmiecz/waypathacademics/pull/65",
      source: "github",
      issueNumber: 12,
      displayId: "#12 Invite reminder cadence",
    },
  ];

  const shipped: ShippedItem[] = [
    {
      issueNumber: 12,
      displayId: "#12 Invite reminder cadence",
      title: "Invite reminder cadence",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/12",
      closedAt: daysAgo(2),
      mergedAt: daysAgo(2),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/65",
    },
    {
      issueNumber: 9,
      displayId: "#9 Faculty office hours filter",
      title: "Faculty office hours filter",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/9",
      closedAt: daysAgo(5),
      mergedAt: daysAgo(5),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/58",
    },
    {
      issueNumber: 5,
      displayId: "#5 Onboarding checklist copy",
      title: "Onboarding checklist copy",
      htmlUrl: "https://github.com/cmiecz/waypathacademics/issues/5",
      closedAt: daysAgo(11),
      mergedAt: daysAgo(11),
      reviewUrl: "https://github.com/cmiecz/waypathacademics/pull/44",
    },
  ];

  const cursorAgents: CursorAgentSummary[] = [
    {
      id: "bc-demo-0001",
      name: "Fix calendar sync timezone edge case",
      status: "ACTIVE",
      url: "https://cursor.com/agents/bc-demo-0001",
      createdAt: minutesAgo(20),
      updatedAt: minutesAgo(2),
      branch: "cursor/calendar-tz-fix",
      prUrl: null,
      repoUrl: "https://github.com/cmiecz/waypathacademics",
      latestRunStatus: "RUNNING",
    },
    {
      id: "bc-demo-0002",
      name: "Lead sources intake mapping",
      status: "IDLE",
      url: "https://cursor.com/agents/bc-demo-0002",
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(1),
      branch: "cursor/lead-sources-30",
      prUrl: "https://github.com/cmiecz/waypathacademics/pull/91",
      repoUrl: "https://github.com/cmiecz/waypathacademics",
      latestRunStatus: "FINISHED",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    demoMode: true,
    timezone: "America/New_York",
    counts: computeCounts(columns, shipped.length),
    columns,
    workingNow,
    activity,
    shipped,
    cursorAgents,
    cursorAgentsError: null,
  };
}

export function buildDemoBotEvents(): BotEvent[] {
  return [
    {
      id: "demo-evt-1",
      bot: "QA Engineer",
      issue: 30,
      action: "started",
      message: "Testing preview walkthrough",
      url: "https://waypath-pr-91.onrender.com",
      createdAt: minutesAgo(10),
    },
    {
      id: "demo-evt-2",
      bot: "Product Architect",
      issue: 38,
      action: "started",
      message: "Building fix via Cursor cloud agent",
      createdAt: minutesAgo(18),
    },
    {
      id: "demo-evt-3",
      bot: "Release Engineer",
      issue: 15,
      action: "note",
      message: "Release verdict — ship it",
      url: "https://github.com/cmiecz/waypathacademics/pull/70",
      createdAt: hoursAgo(1.5),
    },
    {
      id: "demo-evt-4",
      bot: "QA Engineer",
      issue: 19,
      action: "finished",
      message: "QA PASS on preview",
      createdAt: hoursAgo(4),
    },
  ];
}
