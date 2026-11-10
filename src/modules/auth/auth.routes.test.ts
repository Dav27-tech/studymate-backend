import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { OutgoingHttpHeader } from "node:http";
import { describe, it } from "node:test";
import { createApp } from "../../app.js";
import type {
  AuthCredentials,
  AuthRepository,
  AuthSession,
  AuthUser,
  NewUserSession,
} from "./auth.repository.js";

const appOrigin = "http://localhost:5173";
const sessionCookieName = "studymate_session";

class InMemoryAuthRepository implements AuthRepository {
  private readonly usersByEmail = new Map<string, AuthCredentials>();
  private readonly sessions = new Map<string, AuthSession>();

  /**
   * Create User And Session.
   */
  async createUserAndSession(input: NewUserSession): Promise<AuthUser> {
    if (this.usersByEmail.has(input.email)) {
      throw { code: "P2002" };
    }

    const user: AuthUser = {
      id: randomUUID(),
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      createdAt: new Date(),
    };
    this.usersByEmail.set(input.email, {
      user,
      passwordHash: input.passwordHash,
    });
    this.sessions.set(input.tokenHash, { user, expiresAt: input.expiresAt });
    return user;
  }

  /**
   * Find User By Email.
   */
  async findUserByEmail(email: string): Promise<AuthCredentials | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  /**
   * Create Session.
   */
  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const credentials = [...this.usersByEmail.values()].find(
      ({ user }) => user.id === userId,
    );
    if (!credentials) {
      throw new Error("Expected test user to exist.");
    }

    this.sessions.set(tokenHash, { user: credentials.user, expiresAt });
  }

  /**
   * Find Active Session.
   */
  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSession | null> {
    const session = this.sessions.get(tokenHash);
    return session && session.expiresAt > now ? session : null;
  }

  /**
   * Delete Session.
   */
  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

/**
 * Create Test App.
 */
function createTestApp(repository = new InMemoryAuthRepository()) {
  const app = createApp({
    checkDatabase: async () => {},
    logger: false,
    auth: { repository, appOrigin, cookieSecure: false },
  });

  return { app, repository };
}

/**
 * Get Session Cookie.
 */
function getSessionCookie(setCookie: OutgoingHttpHeader | undefined): string {
  /**
 * Explain the purpose of cookie.
 */
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
    (value): value is string =>
      typeof value === "string" &&
      value.startsWith(`${sessionCookieName}=`),
  );
  if (!cookie) {
    throw new Error("Expected an authentication session cookie.");
  }

  const cookiePair = cookie.split(";")[0];
  if (!cookiePair) {
    throw new Error("Expected an authentication session cookie value.");
  }

  return cookiePair;
}

describe("authentication routes", () => {
  it("registers users with a private session cookie and exposes no password hash", async (t) => {
    const { app } = createTestApp();
    t.after(async () => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload: {
        email: "Student@Example.com",
        password: "a-strong-password",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().data.user.email, "student@example.com");
    assert.equal("password" in response.json().data.user, false);
    const setCookie = response.headers["set-cookie"];
    assert.ok(setCookie);
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.match(cookieHeader ?? "", /HttpOnly/i);
    assert.match(cookieHeader ?? "", /SameSite=Strict/i);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: getSessionCookie(response.headers["set-cookie"]) },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().data.user.firstName, "Ada");
  });

  it("rejects malformed or weak registration input", async (t) => {
    const { app } = createTestApp();
    t.after(async () => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload: {
        email: "not-an-email",
        password: "short",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  });

  it("rejects registration names containing only whitespace", async (t) => {
    const { app } = createTestApp();
    t.after(async () => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload: {
        email: "student@example.com",
        password: "a-strong-password",
        firstName: " ",
        lastName: "Lovelace",
      },
    });

    assert.equal(response.statusCode, 400);
  });

  it("returns a generic login error and supports revoking a session", async (t) => {
    const { app } = createTestApp();
    t.after(async () => app.close());

    const register = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload: {
        email: "student@example.com",
        password: "a-strong-password",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    });
    assert.equal(register.statusCode, 201);

    const badLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: appOrigin },
      payload: { email: "student@example.com", password: "wrong-password" },
    });
    assert.equal(badLogin.statusCode, 401);
    assert.equal(badLogin.json().error.code, "INVALID_CREDENTIALS");

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: appOrigin },
      payload: {
        email: "STUDENT@example.com",
        password: "a-strong-password",
      },
    });
    assert.equal(login.statusCode, 200);

    const cookie = getSessionCookie(login.headers["set-cookie"]);
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { origin: appOrigin, cookie },
    });
    assert.equal(logout.statusCode, 200);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie },
    });
    assert.equal(me.statusCode, 401);
  });

  it("rejects state-changing requests from unexpected origins", async (t) => {
    const { app } = createTestApp();
    t.after(async () => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { origin: "https://attacker.example" },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "INVALID_ORIGIN");
  });

  it("allows CORS preflight from the configured frontend origin", async (t) => {
    const { app } = createTestApp();
    t.after(async () => app.close());

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/login",
      headers: {
        origin: appOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], appOrigin);
    assert.equal(response.headers["access-control-allow-credentials"], "true");
  });

  it("rejects duplicate email addresses without exposing database errors", async (t) => {
    const { app } = createTestApp();
    t.after(async () => app.close());
    const payload = {
      email: "student@example.com",
      password: "a-strong-password",
      firstName: "Ada",
      lastName: "Lovelace",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload,
    });

    assert.equal(first.statusCode, 201);
    assert.equal(duplicate.statusCode, 409);
    assert.equal(
      duplicate.json().error.code,
      "EMAIL_ALREADY_REGISTERED",
    );
  });
});
