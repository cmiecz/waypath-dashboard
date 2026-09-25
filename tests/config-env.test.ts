import { afterEach, describe, expect, it } from "vitest";
import {
  env,
  loadConfig,
  normalizeBaseUrl,
} from "../src/config.js";

const KEYS = [
  "DEMO_MODE",
  "BASE_URL",
  "PORT",
  "SESSION_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "GITHUB_WEBHOOK_SECRET",
  "BOT_EVENTS_TOKEN",
  "ALLOWED_GITHUB_USERS",
  "DATABASE_URL",
  "GITHUB_POLL_INTERVAL_MS",
  "CURSOR_API_KEY",
  "NODE_ENV",
] as const;

const saved: Record<string, string | undefined> = {};

function stashEnv(): void {
  for (const key of KEYS) {
    saved[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("env trimming", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("trims env() values", () => {
    stashEnv();
    process.env.GITHUB_TOKEN = "  ghp_example  ";
    expect(env("GITHUB_TOKEN")).toBe("ghp_example");
  });

  it("normalizes BASE_URL by trimming and stripping trailing slash", () => {
    expect(normalizeBaseUrl(" https://waypath-dashboard.onrender.com/ ")).toBe(
      "https://waypath-dashboard.onrender.com",
    );
    expect(normalizeBaseUrl("https://example.com///")).toBe(
      "https://example.com",
    );
  });

  it("loadConfig trims spaced secrets and BASE_URL so OAuth redirect_uri is clean", () => {
    stashEnv();
    process.env.DEMO_MODE = " false ";
    process.env.BASE_URL = " https://waypath-dashboard.onrender.com/ ";
    process.env.SESSION_SECRET = "  session-secret  ";
    process.env.GITHUB_CLIENT_ID = "  oauth-client-id  ";
    process.env.GITHUB_CLIENT_SECRET = "  oauth-client-secret  ";
    process.env.GITHUB_TOKEN = "  ghp_pat  ";
    process.env.BOT_EVENTS_TOKEN = "  bot-token  ";
    process.env.GITHUB_WEBHOOK_SECRET = "  whsec  ";
    process.env.ALLOWED_GITHUB_USERS = " cmiecz , mwaldau71 ";
    process.env.GITHUB_OWNER = " cmiecz ";
    process.env.GITHUB_REPO = " waypathacademics ";
    process.env.CURSOR_API_KEY = "  cursor-key  ";
    process.env.DATABASE_URL = "  postgres://user:pass@host/db  ";

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://waypath-dashboard.onrender.com");
    expect(config.demoMode).toBe(false);
    expect(config.sessionSecret).toBe("session-secret");
    expect(config.githubClientId).toBe("oauth-client-id");
    expect(config.githubClientSecret).toBe("oauth-client-secret");
    expect(config.githubToken).toBe("ghp_pat");
    expect(config.botEventsToken).toBe("bot-token");
    expect(config.githubWebhookSecret).toBe("whsec");
    expect(config.allowedUsers).toEqual(["cmiecz", "mwaldau71"]);
    expect(config.githubOwner).toBe("cmiecz");
    expect(config.githubRepo).toBe("waypathacademics");
    expect(config.cursorApiKey).toBe("cursor-key");
    expect(config.databaseUrl).toBe("postgres://user:pass@host/db");

    // OAuth redirect must not start with a space (which encodes as +)
    const redirectUri = `${config.baseUrl}/auth/github/callback`;
    expect(redirectUri).toBe(
      "https://waypath-dashboard.onrender.com/auth/github/callback",
    );
    expect(encodeURIComponent(redirectUri)).not.toMatch(/^\+/);
    expect(redirectUri.startsWith(" ")).toBe(false);
  });
});
