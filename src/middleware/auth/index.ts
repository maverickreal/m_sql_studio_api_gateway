import { Request, Response, NextFunction } from "express";
import { auth } from "../../auth";
import { fromNodeHeaders } from "better-auth/node";

export const requireAuthMware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    req.user = session.user;
    req.session = session.session;
    next();
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
};

export const requireAdminMware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const reqWithUser = req as Request & { user?: { role?: string } };

  if (!reqWithUser.user || reqWithUser.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
};

export const optionalAuthMware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session) {
      req.user = session.user;
      req.session = session.session;
    }

    next();
  } catch {
    // Optional auth: silently continue without user
    next();
  }
};

export const requireVerifiedEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let sessionUser = req.user;
    if (!sessionUser) {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      req.user = session.user;
      req.session = session.session;
      sessionUser = session.user;
    }

    if (!sessionUser.emailVerified) {
      res.status(403).json({ error: "Email verification required" });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
};
