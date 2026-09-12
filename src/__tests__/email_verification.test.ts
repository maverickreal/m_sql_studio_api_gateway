import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const {
  mockGetSession,
  mockGetAssignmentByIdCached,
  mockGetAssignmentSolutionByAssignmentIdCached,
  mockEnqueue,
  mockFindOne,
  mockFindOneAndUpdate,
  mockCreateTransport,
  mockSendMail,
} = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({
    sendMail,
  }));
  return {
    mockGetSession: vi.fn(),
    mockGetAssignmentByIdCached: vi.fn(),
    mockGetAssignmentSolutionByAssignmentIdCached: vi.fn(),
    mockEnqueue: vi.fn(),
    mockFindOne: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    }),
    mockFindOneAndUpdate: vi.fn(),
    mockCreateTransport: createTransport,
    mockSendMail: sendMail,
  };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mockCreateTransport,
  },
  createTransport: mockCreateTransport,
}));

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return {
    ...actual,
    auth: {
      ...actual.auth,
      api: {
        ...actual.auth.api,
        getSession: mockGetSession,
      },
    },
  };
});

vi.mock("../services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services")>();
  return {
    ...actual,
    getAssignmentByIdCached: mockGetAssignmentByIdCached,
    getAssignmentSolutionByAssignmentIdCached:
      mockGetAssignmentSolutionByAssignmentIdCached,
    TaskQueueClient: {
      ...actual.TaskQueueClient,
      enqueue: mockEnqueue,
    },
  };
});

vi.mock("../data/db/models/user_sql_state", () => ({
  UserSqlState: {
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
  },
}));

import app from "../app";
import { auth } from "../auth";
import { sendVerificationEmail } from "../auth/email";
import { requireVerifiedEmail } from "../middleware/auth";
import { envVars, logger } from "../config";
import type { Request, Response, NextFunction } from "express";

describe("Email Verification & Unverified Write Protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("0. better-auth configuration", () => {
    it("configures requireEmailVerification on emailAndPassword and sendOnSignUp on emailVerification", () => {
      expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(
        true,
      );
      expect(auth.options.emailVerification?.sendOnSignUp).toBe(true);
      expect(typeof auth.options.emailVerification?.sendVerificationEmail).toBe(
        "function",
      );
    });
  });

  describe("1. SMTP Transport via sendVerificationEmail", () => {
    it("skips sending and logs a warning when SMTP credentials are not configured", async () => {
      const origHost = envVars.SMTP_HOST;
      (envVars as Record<string, unknown>).SMTP_HOST = undefined;

      const warnSpy = vi.spyOn(logger, "warn");

      await expect(
        sendVerificationEmail({
          user: { email: "student@example.com" },
          url: "http://localhost:8000/verify-email?token=xyz",
          token: "xyz",
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("SMTP configuration incomplete"),
      );
      expect(mockCreateTransport).not.toHaveBeenCalled();

      (envVars as Record<string, unknown>).SMTP_HOST = origHost;
    });

    it("sends verification email when SMTP credentials are fully provided", async () => {
      (envVars as Record<string, unknown>).SMTP_HOST = "smtp.example.com";
      (envVars as Record<string, unknown>).SMTP_PORT = 587;
      (envVars as Record<string, unknown>).SMTP_USER = "mailer@example.com";
      (envVars as Record<string, unknown>).SMTP_PASS = "secretpass";
      (envVars as Record<string, unknown>).SMTP_FROM = "noreply@example.com";

      mockSendMail.mockResolvedValueOnce({ messageId: "msg-123" });

      await sendVerificationEmail({
        user: { email: "student@example.com" },
        url: "http://localhost:8000/verify-email?token=xyz",
        token: "xyz",
      });

      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: {
          user: "mailer@example.com",
          pass: "secretpass",
        },
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "noreply@example.com",
          to: "student@example.com",
          subject: "Verify your email address",
          text: expect.stringContaining(
            "http://localhost:8000/verify-email?token=xyz",
          ),
          html: expect.stringContaining(
            "http://localhost:8000/verify-email?token=xyz",
          ),
        }),
      );
    });

    it("uses secure: true when SMTP_PORT is 465 (e.g. Resend / SSL)", async () => {
      (envVars as Record<string, unknown>).SMTP_HOST = "smtp.resend.com";
      (envVars as Record<string, unknown>).SMTP_PORT = 465;
      (envVars as Record<string, unknown>).SMTP_USER = "resend";
      (envVars as Record<string, unknown>).SMTP_PASS = "re_apikey";
      (envVars as Record<string, unknown>).SMTP_FROM = "noreply@example.com";

      mockSendMail.mockResolvedValueOnce({ messageId: "msg-465" });

      await sendVerificationEmail({
        user: { email: "student@example.com" },
        url: "http://localhost:8000/verify-email?token=xyz",
        token: "xyz",
      });

      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: {
          user: "resend",
          pass: "re_apikey",
        },
      });
    });

    it("handles SMTP delivery errors gracefully without crashing or leaking secrets", async () => {
      (envVars as Record<string, unknown>).SMTP_HOST = "smtp.example.com";
      (envVars as Record<string, unknown>).SMTP_PORT = 587;
      (envVars as Record<string, unknown>).SMTP_USER = "mailer@example.com";
      (envVars as Record<string, unknown>).SMTP_PASS = "secretpass";
      (envVars as Record<string, unknown>).SMTP_FROM = "noreply@example.com";

      mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));
      const errorSpy = vi.spyOn(logger, "error");

      await expect(
        sendVerificationEmail({
          user: { email: "student@example.com" },
          url: "http://localhost:8000/verify-email?token=xyz",
          token: "xyz",
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Connection refused" }),
        "Failed to send verification email",
      );
    });
  });

  describe("2. requireVerifiedEmail Middleware Unit Tests", () => {
    it("returns 401 when no session exists", async () => {
      mockGetSession.mockResolvedValue(null);
      const req = { headers: {} } as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await requireVerifiedEmail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentication required",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when session user emailVerified is false", async () => {
      mockGetSession.mockResolvedValue({
        user: {
          id: "u-1",
          email: "unverified@example.com",
          emailVerified: false,
        },
        session: { id: "s-1" },
      });
      const req = { headers: {} } as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await requireVerifiedEmail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email verification required",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when user is already on req but emailVerified is false", async () => {
      const req = {
        headers: {},
        user: {
          id: "u-1",
          email: "unverified@example.com",
          emailVerified: false,
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await requireVerifiedEmail(req, res, next);

      expect(mockGetSession).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email verification required",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next() when emailVerified is true", async () => {
      const req = {
        headers: {},
        user: { id: "u-1", email: "verified@example.com", emailVerified: true },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await requireVerifiedEmail(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("3. Lifecycle: Signup -> Unverified write rejected (401/403) -> Verify -> Write allowed", () => {
    const unverifiedSession = {
      user: {
        id: "student-1",
        email: "student@example.com",
        role: "user",
        emailVerified: false,
      },
      session: { id: "sess-unverified" },
    };

    const verifiedSession = {
      user: {
        id: "student-1",
        email: "student@example.com",
        role: "user",
        emailVerified: true,
      },
      session: { id: "sess-verified" },
    };

    it("Stage A: Unverified session write rejected with 403 on SQL execute", async () => {
      mockGetSession.mockResolvedValue(unverifiedSession);

      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: "650000000000000000000001",
          userSql: "SELECT 1;",
        });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Email verification required" });
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it("Stage B: Unverified session write rejected with 403 on last-sql save", async () => {
      mockGetSession.mockResolvedValue(unverifiedSession);

      const res = await request(app)
        .post("/api/v1/assignments/650000000000000000000001/last-sql")
        .send({ userSql: "SELECT 1;" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Email verification required" });
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it("Stage C: Unverified session write rejected with 403 on admin problem submit", async () => {
      mockGetSession.mockResolvedValue({
        user: {
          id: "admin-unverified",
          email: "admin@example.com",
          role: "admin",
          emailVerified: false,
        },
        session: { id: "sess-admin-unverified" },
      });

      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send({ title: "New Assignment" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Email verification required" });
    });

    it("Stage D: Read / catalog endpoints remain accessible to unverified users", async () => {
      mockGetSession.mockResolvedValue(unverifiedSession);
      mockGetAssignmentByIdCached.mockResolvedValue({
        _id: "650000000000000000000001",
        title: "Test Assignment",
        pgSchemaReady: true,
      });

      // Public catalog read
      const catalogRes = await request(app).get(
        "/api/v1/assignments/650000000000000000000001",
      );
      expect(catalogRes.status).toBe(200);

      // Authenticated read (last-sql GET) accessible without verified email
      const lastSqlReadRes = await request(app).get(
        "/api/v1/assignments/650000000000000000000001/last-sql",
      );
      expect(lastSqlReadRes.status).toBe(200);
    });

    it("Stage E: After verification, write routes are allowed (green path)", async () => {
      mockGetSession.mockResolvedValue(verifiedSession);
      mockGetAssignmentByIdCached.mockResolvedValue({
        _id: "650000000000000000000001",
        pgSchemaReady: true,
        mode: "read",
      });
      mockGetAssignmentSolutionByAssignmentIdCached.mockResolvedValue({
        solutionSql: "SELECT 1;",
        orderMatters: false,
      });
      mockEnqueue.mockResolvedValue("task-xyz-123");

      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: "650000000000000000000001",
          userSql: "SELECT 1;",
        });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ taskId: "task-xyz-123" });
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentId: "650000000000000000000001",
          userSql: "SELECT 1;",
          userId: "student-1",
        }),
      );
    });
  });
});
