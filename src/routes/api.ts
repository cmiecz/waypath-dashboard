import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";
import {
  isUserAllowed,
  verifyBearerToken,
  verifyGithubWebhookSignature,
} from "../config.js";
import {
  clearSessionCookie,
  exchangeCodeForUser,
  getSessionUser,
  githubAuthorizeUrl,
  requireAuth,
  setSessionCookie,
} from "../auth/session.js";
import type { EventStore } from "../events/store.js";
import type { SnapshotService } from "../github/snapshot.js";

const oauthStates = new Map<string, number>();

function pruneStates(): void {
  const now = Date.now();
  for (const [k, exp] of oauthStates) {
    if (exp < now) oauthStates.delete(k);
  }
}

export function mountRoutes(
  app: Express,
  opts: {
    config: AppConfig;
    events: EventStore;
    snapshot: SnapshotService;
    eventBackend: "postgres" | "memory";
    publicDir: string;
  },
): void {
  const { config, events, snapshot, eventBackend, publicDir } = opts;

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      ok: true,
      demoMode: config.demoMode,
      eventBackend,
      hasSnapshot: Boolean(snapshot.getSnapshot()),
      lastError: snapshot.getLastError(),
    });
  });

  app.get("/login", (req, res) => {
    if (config.demoMode) {
      res.redirect("/");
      return;
    }
    const user = getSessionUser(req, config);
    if (user) {
      res.redirect("/");
      return;
    }
    res.sendFile("login.html", { root: publicDir });
  });

  app.get("/auth/github", (_req, res) => {
    if (config.demoMode) {
      res.redirect("/");
      return;
    }
    if (!config.githubClientId || !config.githubClientSecret) {
      res.status(500).send("GitHub OAuth is not configured");
      return;
    }
    pruneStates();
    const state = randomBytes(16).toString("hex");
    oauthStates.set(state, Date.now() + 10 * 60_000);
    res.redirect(githubAuthorizeUrl(config, state));
  });

  app.get("/auth/github/callback", async (req, res) => {
    try {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      const exp = oauthStates.get(state);
      oauthStates.delete(state);
      if (!code || !exp || exp < Date.now()) {
        res.status(400).send("Invalid OAuth state");
        return;
      }
      const user = await exchangeCodeForUser(code, config);
      if (!isUserAllowed(user.login, config.allowedUsers)) {
        res
          .status(403)
          .send(
            `Access denied. GitHub user @${user.login} is not on the allowlist.`,
          );
        return;
      }
      setSessionCookie(res, user, config);
      res.redirect("/");
    } catch (err) {
      console.error("OAuth callback error", err);
      res.status(500).send("OAuth failed");
    }
  });

  app.post("/auth/logout", (_req, res) => {
    clearSessionCookie(res);
    res.redirect(config.demoMode ? "/" : "/login");
  });

  app.get("/auth/me", (req, res) => {
    if (config.demoMode) {
      res.json({
        demoMode: true,
        user: { login: "demo", name: "Demo Viewer" },
      });
      return;
    }
    const user = getSessionUser(req, config);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ demoMode: false, user });
  });

  app.post("/api/events", async (req, res) => {
    if (
      !verifyBearerToken(
        req.get("authorization") ?? undefined,
        config.botEventsToken,
      )
    ) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const rawBody = req.body;
    if (rawBody == null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      res.status(400).json({
        error:
          'Expected JSON object {bot, issue, action: "started"|"finished"|"note", message, url?}',
      });
      return;
    }
    const body = rawBody as {
      bot?: unknown;
      issue?: unknown;
      action?: unknown;
      message?: unknown;
      url?: unknown;
    };
    const bot = typeof body.bot === "string" ? body.bot.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const action = body.action;
    const issue = Number(body.issue);
    if (
      !bot ||
      !message ||
      !Number.isFinite(issue) ||
      issue <= 0 ||
      (action !== "started" && action !== "finished" && action !== "note")
    ) {
      res.status(400).json({
        error:
          'Expected {bot, issue, action: "started"|"finished"|"note", message, url?}',
      });
      return;
    }
    const url = typeof body.url === "string" ? body.url : undefined;
    const event = await events.add({ bot, issue, action, message, url });
    void snapshot.refresh("bot-event");
    res.status(201).json({ ok: true, event });
  });

  app.post("/api/github/webhook", (req: Request, res: Response) => {
    const raw =
      (req as Request & { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body ?? {}));
    if (!config.githubWebhookSecret) {
      res.status(503).json({ error: "webhook secret not configured" });
      return;
    }
    const ok = verifyGithubWebhookSignature(
      raw,
      req.get("x-hub-signature-256") ?? undefined,
      config.githubWebhookSecret,
    );
    if (!ok) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }
    void snapshot.refresh("webhook");
    res.status(202).json({ ok: true });
  });

  app.get("/api/dashboard", requireAuth(config), (_req, res) => {
    const snap = snapshot.getSnapshot();
    if (!snap) {
      res.status(503).json({ error: "snapshot not ready" });
      return;
    }
    res.json(snap);
  });

  app.get("/api/stream", requireAuth(config), (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (snap: { generatedAt?: string }, reason: string) => {
      res.write(`event: dashboard\n`);
      res.write(
        `data: ${JSON.stringify({ reason, generatedAt: snap.generatedAt })}\n\n`,
      );
    };

    const snap = snapshot.getSnapshot();
    if (snap) send(snap, "connected");

    const onUpdate = (s: { generatedAt?: string }, reason: string) =>
      send(s, reason);
    snapshot.on("update", onUpdate);
    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      snapshot.off("update", onUpdate);
    });
  });

  app.get("/", requireAuth(config), (_req, res) => {
    res.sendFile("index.html", { root: publicDir });
  });
}
