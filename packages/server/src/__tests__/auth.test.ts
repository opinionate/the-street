import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test requireAuth's branching logic by dynamically importing
// after setting NODE_ENV. We also mock external deps so the module
// loads without a real Clerk SDK or Postgres pool.

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: vi.fn(),
}));

vi.mock("../database/pool.js", () => ({
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}));

function makeMockReq(overrides: Record<string, any> = {}): any {
  return { headers: {}, ...overrides };
}

function makeMockRes(): any {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAuth", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it("returns dev bypass middleware when NODE_ENV is development", async () => {
    process.env.NODE_ENV = "development";
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    expect(chain).toHaveLength(1);

    // Run the bypass and verify it sets dev user IDs
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();
    (chain[0] as any)(req, res, next);

    expect(req.userId).toBe("00000000-0000-0000-0000-000000000000");
    expect(req.clerkId).toBe("dev_clerk_id");
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns dev bypass even when CLERK_SECRET_KEY is set in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.CLERK_SECRET_KEY = "sk_test_fake_key";
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    expect(chain).toHaveLength(1);

    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();
    (chain[0] as any)(req, res, next);

    expect(req.userId).toBe("00000000-0000-0000-0000-000000000000");
    expect(next).toHaveBeenCalledOnce();

    delete process.env.CLERK_SECRET_KEY;
  });

  it("returns Clerk auth chain when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    expect(chain).toHaveLength(2); // clerkAuth + resolveUser
  });

  it("returns Clerk auth chain when NODE_ENV is undefined", async () => {
    delete process.env.NODE_ENV;
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    expect(chain).toHaveLength(2);
  });
});

describe("resolveUser", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 when no auth userId is present", async () => {
    const { getAuth } = await import("@clerk/express");
    (getAuth as any).mockReturnValue({ userId: null });

    const { resolveUser } = await import("../middleware/auth.js");

    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();
    await resolveUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when auth is completely undefined", async () => {
    const { getAuth } = await import("@clerk/express");
    (getAuth as any).mockReturnValue(undefined);

    const { resolveUser } = await import("../middleware/auth.js");

    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();
    await resolveUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when clerk user is not in database", async () => {
    const { getAuth } = await import("@clerk/express");
    (getAuth as any).mockReturnValue({ userId: "clerk_user_123" });

    const { resolveUser } = await import("../middleware/auth.js");

    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();
    await resolveUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "User not registered" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("devBypass middleware", () => {
  afterEach(() => {
    process.env.NODE_ENV = "development";
    delete process.env.DEV_USER_ROLE;
    vi.resetModules();
  });

  it("sets deterministic dev user ID", async () => {
    process.env.NODE_ENV = "development";
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    const req1 = makeMockReq();
    const req2 = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();

    (chain[0] as any)(req1, res, next);
    (chain[0] as any)(req2, res, next);

    // Both requests get the same dev user ID
    expect(req1.userId).toBe(req2.userId);
    expect(req1.userId).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("always calls next()", async () => {
    process.env.NODE_ENV = "development";
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();

    (chain[0] as any)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("defaults to super_admin role in dev mode", async () => {
    process.env.NODE_ENV = "development";
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();

    (chain[0] as any)(req, res, next);
    expect(req.userRole).toBe("super_admin");
  });

  it("respects DEV_USER_ROLE env var", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_USER_ROLE = "user";
    const { requireAuth } = await import("../middleware/auth.js");

    const chain = requireAuth();
    const req = makeMockReq();
    const res = makeMockRes();
    const next = vi.fn();

    (chain[0] as any)(req, res, next);
    expect(req.userRole).toBe("user");
  });
});

describe("requireRole", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows request when user has the required role", async () => {
    const { requireRole } = await import("../middleware/auth.js");

    const middleware = requireRole("super_admin");
    const req = makeMockReq({ userRole: "super_admin" });
    const res = makeMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when user does not have the required role", async () => {
    const { requireRole } = await import("../middleware/auth.js");

    const middleware = requireRole("super_admin");
    const req = makeMockReq({ userRole: "user" });
    const res = makeMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Insufficient permissions" });
  });

  it("returns 403 when userRole is undefined", async () => {
    const { requireRole } = await import("../middleware/auth.js");

    const middleware = requireRole("super_admin");
    const req = makeMockReq({});
    const res = makeMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("accepts multiple allowed roles", async () => {
    const { requireRole } = await import("../middleware/auth.js");

    const middleware = requireRole("user", "super_admin");
    const req = makeMockReq({ userRole: "user" });
    const res = makeMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("isAdmin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true for super_admin", async () => {
    const { isAdmin } = await import("../middleware/auth.js");
    expect(isAdmin(makeMockReq({ userRole: "super_admin" }))).toBe(true);
  });

  it("returns false for regular user", async () => {
    const { isAdmin } = await import("../middleware/auth.js");
    expect(isAdmin(makeMockReq({ userRole: "user" }))).toBe(false);
  });

  it("returns false for undefined role", async () => {
    const { isAdmin } = await import("../middleware/auth.js");
    expect(isAdmin(makeMockReq({}))).toBe(false);
  });
});
