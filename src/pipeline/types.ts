import type { StageId } from "./stages.js";

export interface BotEvent {
  id: string;
  bot: string;
  issue: number;
  action: "started" | "finished" | "note";
  message: string;
  url?: string;
  createdAt: string; // ISO
}

export interface LinkedPr {
  /** GitHub PR number — used only for building links, never shown as an ID. */
  number: number;
  url: string;
  title: string;
  state: string;
  mergedAt: string | null;
}

export interface RequestCard {
  issueNumber: number;
  title: string;
  /** Single display id: "#30 Lead sources" */
  displayId: string;
  stage: StageId;
  owner: string;
  htmlUrl: string;
  stageEnteredAt: string | null;
  latestActivity: string | null;
  latestActivityAt: string | null;
  reviewUrl: string | null;
  previewUrl: string | null;
  qaResult: "pass" | "fail" | null;
  workingNow: boolean;
  workingBot: string | null;
  escalated: boolean;
  labels: string[];
}

export interface WorkingNowItem {
  bot: string;
  issueNumber: number;
  displayId: string;
  message: string;
  startedAt: string;
  url?: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  actor: string;
  summary: string;
  url: string | null;
  source: "github" | "bot";
  issueNumber: number | null;
  displayId: string | null;
}

export interface ShippedItem {
  issueNumber: number;
  displayId: string;
  title: string;
  htmlUrl: string;
  closedAt: string;
  mergedAt: string | null;
  reviewUrl: string | null;
}

export interface StageCounts {
  reported: number;
  being_built: number;
  ready_to_test: number;
  needs_fix: number;
  qa_passed: number;
  ready_to_merge: number;
  needsCass: number;
  open: number;
  shipped14d: number;
}

export interface CursorAgentSummary {
  id: string;
  name: string;
  status: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  branch: string | null;
  prUrl: string | null;
  repoUrl: string | null;
  latestRunStatus: string | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  demoMode: boolean;
  timezone: "America/New_York";
  counts: StageCounts;
  columns: Record<StageId, RequestCard[]>;
  workingNow: WorkingNowItem[];
  activity: ActivityItem[];
  shipped: ShippedItem[];
  cursorAgents: CursorAgentSummary[] | null;
  cursorAgentsError: string | null;
}
