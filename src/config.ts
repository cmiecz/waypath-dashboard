import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    if (process.env.DEMO_MODE === "true" && fallback === undefined) {
      // Allow missing secrets in demo mode for local UI screenshots
      return `demo-${name.toLowerCase()}`;
    }
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function loadConfig() {
  const demoMode = (process.env.DEMO_MODE ?? "false").toLowerCase() === "true";
  const allowedUsers = (process.env.ALLOWED_GITHUB_USERS ?? "cmiecz,mwaldau71")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);

  const port = Number(process.env.PORT ?? 10000);
  const baseUrl = (process.env.BASE_URL ?? `http://localhost:${port}`).replace(
    /\/$/,
    "",
  );

  return {
    port,
    baseUrl,
    demoMode,
    nodeEnv: process.env.NODE_ENV ?? "development",
    sessionSecret: process.env.SESSION_SECRET || (demoMode ? "demo-session-secret-change-me" : required("SESSION_SECRET")),
    githubClientId: process.env.GITHUB_CLIENT_ID || (demoMode ? "demo-client-id" : ""),
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET || (demoMode ? "demo-client-secret" : ""),
    allowedUsers,
    githubToken: process.env.GITHUB_TOKEN || "",
    githubOwner: process.env.GITHUB_OWNER || "cmiecz",
    githubRepo: process.env.GITHUB_REPO || "waypathacademics",
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
    botEventsToken: process.env.BOT_EVENTS_TOKEN || (demoMode ? "demo-bot-token" : required("BOT_EVENTS_TOKEN")),
    databaseUrl: process.env.DATABASE_URL || "",
    pollIntervalMs: Number(process.env.GITHUB_POLL_INTERVAL_MS ?? 45_000),
    cursorApiKey: process.env.CURSOR_API_KEY || "",
    timezone: "America/New_York" as const,
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function isUserAllowed(
  login: string,
  allowedUsers: string[] = loadConfig().allowedUsers,
): boolean {
  return allowedUsers.includes(login.trim().toLowerCase());
}

export function signSession(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof data.exp === "number" && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function verifyBearerToken(
  header: string | undefined,
  expectedToken: string,
): boolean {
  if (!header || !expectedToken) return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const provided = m[1]!;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(a, b);
}

export function verifyGithubWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function newId(): string {
  return randomBytes(12).toString("hex");
}
