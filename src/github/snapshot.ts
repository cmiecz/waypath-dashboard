import { EventEmitter } from "node:events";
import type { AppConfig } from "../config.js";
import type { EventStore } from "../events/store.js";
import { GitHubClient } from "./client.js";
import { buildDashboard } from "./pipeline.js";
import { buildDemoSnapshot } from "../demo/sample.js";
import { fetchCursorAgents } from "../cursor/agents.js";
import type { DashboardSnapshot } from "../pipeline/types.js";

export class SnapshotService extends EventEmitter {
  private snapshot: DashboardSnapshot | null = null;
  private refreshing = false;
  private timer: NodeJS.Timeout | null = null;
  private github: GitHubClient | null = null;
  private lastError: string | null = null;

  constructor(
    private config: AppConfig,
    private events: EventStore,
  ) {
    super();
    if (!config.demoMode && config.githubToken) {
      this.github = new GitHubClient(
        config.githubToken,
        config.githubOwner,
        config.githubRepo,
      );
    }
  }

  getSnapshot(): DashboardSnapshot | null {
    return this.snapshot;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  start(): void {
    void this.refresh("startup");
    const interval = Math.max(15_000, this.config.pollIntervalMs);
    this.timer = setInterval(() => {
      void this.refresh("poll");
    }, interval);
    // Avoid keeping the process alive solely for the timer in tests if needed
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(reason: string): Promise<DashboardSnapshot> {
    if (this.refreshing) {
      return this.snapshot ?? (await this.buildOnce());
    }
    this.refreshing = true;
    try {
      const snap = await this.buildOnce();
      this.snapshot = snap;
      this.lastError = null;
      this.emit("update", snap, reason);
      return snap;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      console.error(`[snapshot] refresh failed (${reason}):`, message);
      if (!this.snapshot && this.config.demoMode) {
        this.snapshot = buildDemoSnapshot();
      }
      return this.snapshot!;
    } finally {
      this.refreshing = false;
    }
  }

  private async buildOnce(): Promise<DashboardSnapshot> {
    let cursorAgents = null;
    let cursorAgentsError: string | null = null;

    if (this.config.demoMode) {
      const demo = buildDemoSnapshot();
      return demo;
    }

    if (this.config.cursorApiKey) {
      try {
        cursorAgents = await fetchCursorAgents({
          apiKey: this.config.cursorApiKey,
          repoUrl: `https://github.com/${this.config.githubOwner}/${this.config.githubRepo}`,
          limit: 12,
        });
      } catch (err) {
        cursorAgentsError =
          err instanceof Error ? err.message : "Cursor API error";
      }
    }

    return buildDashboard({
      github: this.github,
      events: this.events,
      demoMode: false,
      cursorAgents,
      cursorAgentsError,
    });
  }
}
