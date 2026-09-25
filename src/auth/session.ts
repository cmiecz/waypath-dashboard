import type { Request, Response, NextFunction } from "express";
import {
  isUserAllowed,
  signSession,
  verifySession,
  type AppConfig,
} from "../config.js";

export const SESSION_COOKIE = "waypath_session";
const SESSION_DAYS = 14;

export interface SessionUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

export function getSessionUser(
  req: Request,
  config: AppConfig,
): SessionUser | null {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const data = verifySession(token, config.sessionSecret);
  if (!data || typeof data.login !== "string") return null;
  if (!isUserAllowed(data.login, config.allowedUsers)) return null;
  return {
    login: data.login,
    name: typeof data.name === "string" ? data.name : undefined,
    avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : undefined,
  };
}

export function setSessionCookie(
  res: Response,
  user: SessionUser,
  config: AppConfig,
): void {
  const token = signSession(
    {
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    },
    config.sessionSecret,
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function requireAuth(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.demoMode) {
      // Demo mode: allow viewing without OAuth
      next();
      return;
    }
    const user = getSessionUser(req, config);
    if (!user) {
      if (req.path.startsWith("/api/")) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      res.redirect("/login");
      return;
    }
    next();
  };
}

export function githubAuthorizeUrl(config: AppConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${config.baseUrl}/auth/github/callback`,
    scope: "read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForUser(
  code: string,
  config: AppConfig,
): Promise<SessionUser> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: `${config.baseUrl}/auth/github/callback`,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error("OAuth token exchange failed");
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenJson.access_token) {
    throw new Error(tokenJson.error ?? "No access token");
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "waypath-dashboard",
    },
  });
  if (!userRes.ok) throw new Error("Failed to load GitHub user");
  const user = (await userRes.json()) as {
    login: string;
    name: string | null;
    avatar_url: string;
  };
  return {
    login: user.login,
    name: user.name ?? undefined,
    avatarUrl: user.avatar_url,
  };
}
