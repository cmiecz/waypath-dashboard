import { describe, expect, it, beforeAll, afterAll } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import { mountRoutes } from "../src/routes/api.js";
import { MemoryEventStore } from "../src/events/store.js";
import { SnapshotService } from "../src/github/snapshot.js";
import type { AppConfig } from "../src/config.js";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    baseUrl: "http://localhost:0",
    demoMode: true,
    nodeEnv: "test",
    sessionSecret: "test-secret",
    githubClientId: "id",
    githubClientSecret: "secret",
    allowedUsers: ["cmiecz", "mwaldau71"],
    githubToken: "",
    githubOwner: "cmiecz",
    githubRepo: "waypathacademics",
    githubWebhookSecret: "whsec",
    botEventsToken: "bot-token-abc",
    databaseUrl: "",
    pollIntervalMs: 60_000,
    cursorApiKey: "",
    timezone: "America/New_York",
    ...overrides,
  };
}

describe("POST /api/events auth", () => {
  let server: Server;
  let base: string;
  let store: MemoryEventStore;

  beforeAll(async () => {
    const config = testConfig();
    store = new MemoryEventStore();
    const snapshot = new SnapshotService(config, store);
    // Don't start polling in tests
    await snapshot.refresh("test");

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    mountRoutes(app, {
      config,
      events: store,
      snapshot,
      eventBackend: "memory",
      publicDir: path.join(__dirname, "../public"),
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns 401 without a bearer token", async () => {
    const res = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bot: "QA Engineer",
        issue: 1,
        action: "note",
        message: "hi",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and stores the event", async () => {
    const res = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer bot-token-abc",
      },
      body: JSON.stringify({
        bot: "QA Engineer",
        issue: 30,
        action: "started",
        message: "Testing",
        url: "https://example.onrender.com",
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; event: { issue: number } };
    expect(json.ok).toBe(true);
    expect(json.event.issue).toBe(30);
    const listed = await store.list(10);
    expect(listed.some((e) => e.issue === 30)).toBe(true);
  });
});
