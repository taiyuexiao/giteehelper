import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { config } from "./config.js";
import { execute, queryOne } from "./db.js";
import type { Role, User } from "../shared/types.js";

const sessions = new Map<string, { userId: number; expiresAt: number }>();

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  return token;
}

export function destroySession(token: string) {
  sessions.delete(token);
}

function bearer(req: Request): string {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function currentUser(req: Request) {
  const session = sessions.get(bearer(req));
  if (!session || session.expiresAt < Date.now()) return undefined;
  return queryOne<User & { password_hash?: string; password_salt?: string }>(
    `SELECT id, username, display_name AS displayName, role, email, gitee_login AS giteeLogin,
            feishu_user_id AS feishuUserId, active, created_at AS createdAt
     FROM users WHERE id = ? AND active = 1`,
    [session.userId]
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  (req as Request & { user?: User }).user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: User }).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

export function login(username: string, password: string): { token: string; user: User } | undefined {
  const row = queryOne<{
    id: number; username: string; displayName: string; role: Role; email: string | null;
    giteeLogin: string | null; feishuUserId: string | null; active: number; createdAt: string;
    password_hash: string | null; password_salt: string | null;
  }>(
    `SELECT id, username, display_name AS displayName, role, email, gitee_login AS giteeLogin,
            feishu_user_id AS feishuUserId, active, created_at AS createdAt, password_hash, password_salt
     FROM users WHERE username = ? AND active = 1`,
    [username]
  );
  if (!row?.password_hash || !row.password_salt || !verifyPassword(password, row.password_hash, row.password_salt)) return undefined;
  const token = createSession(row.id);
  const { password_hash, password_salt, ...user } = row;
  return { token, user: { ...user, active: Boolean(user.active) } as User };
}

export function ensureAdminUser() {
  const existing = queryOne<{ id: number }>(`SELECT id FROM users WHERE username = ?`, [config.adminUsername]);
  const password = config.adminPassword || "change-me-now";
  const { hash, salt } = hashPassword(password);
  if (existing) {
    execute(`UPDATE users SET password_hash = ?, password_salt = ?, role = 'admin', active = 1 WHERE id = ?`, [hash, salt, existing.id]);
    return;
  }
  execute(
    `INSERT INTO users (username, display_name, role, password_hash, password_salt) VALUES (?, ?, 'admin', ?, ?)`,
    [config.adminUsername, "系统管理员", hash, salt]
  );
}
