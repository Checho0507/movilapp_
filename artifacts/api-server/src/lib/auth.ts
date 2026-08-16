import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env["SESSION_SECRET"] ?? (process.env.NODE_ENV === 'production' ? undefined : "movilapp-dev-secret");

if (!JWT_SECRET) {
  // In production we must have a secret configured. In development we allow a dev secret but log a warning
  throw new Error("SESSION_SECRET is required in production. Set the SESSION_SECRET environment variable.");
}


export interface JwtPayload {
  userId: number;
  role: string;
}

export function signToken(payload: JwtPayload): string {
  // Explicit algorithm and limited lifetime. Consider adding issuer/audience in the future.
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d", algorithm: "HS256" });
}

export function verifyToken(token: string): JwtPayload {
  const raw = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  // Validate shape to avoid downstream runtime errors
  if (!raw || typeof raw !== "object") throw new Error("Invalid token payload");
  const maybe = raw as Record<string, unknown>;
  const userId = maybe["userId"];
  const role = maybe["role"];
  if (typeof userId !== "number" || !Number.isFinite(userId)) throw new Error("Invalid token payload: userId");
  if (typeof role !== "string") throw new Error("Invalid token payload: role");
  return { userId: Number(userId), role } as JwtPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
