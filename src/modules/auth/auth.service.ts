import argon2, { type HashOptions } from "argon2";
import { createHash, randomBytes } from "node:crypto";
import {
  type AuthRepository,
  type AuthSession,
  type AuthUser,
  type NewUserSession,
} from "./auth.repository.js";

const passwordHashOptions: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface AuthenticatedSession {
  user: AuthUser;
  expiresAt: Date;
}

export interface IssuedSession extends AuthenticatedSession {
  token: string;
}

/**
 * Detect Prisma duplicate-key errors so registration can be translated into
 * a domain-friendly conflict response instead of a raw database error.
 */
function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/**
 * Hash a session token before storing it in the database so the value is not
 * persisted in a reversible form.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a signed session token that is later hashed before persistence.
 */
function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  /**
   * Register a new user and immediately issue a session cookie for the new account.
   */
  async register(input: RegisterInput): Promise<IssuedSession> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const passwordHash = await argon2.hash(input.password, passwordHashOptions);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);

    const newUserSession: NewUserSession = {
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
      tokenHash: hashSessionToken(token),
      expiresAt,
    };

    try {
      const user = await this.repository.createUserAndSession(newUserSession);
      return { user, token, expiresAt };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new AuthError(
          409,
          "EMAIL_ALREADY_REGISTERED",
          "An account with this email already exists.",
        );
      }

      throw error;
    }
  }

  /**
   * Validate the supplied credentials and issue a fresh session for the user.
   */
  async login(email: string, password: string): Promise<IssuedSession> {
    const credentials = await this.repository.findUserByEmail(
      email.trim().toLowerCase(),
    );

    if (!credentials) {
      await argon2.hash(password, passwordHashOptions);
      throw new AuthError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const passwordMatches = await argon2.verify(
      credentials.passwordHash,
      password,
    );
    if (!passwordMatches) {
      throw new AuthError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    await this.repository.createSession(
      credentials.user.id,
      hashSessionToken(token),
      expiresAt,
    );

    return { user: credentials.user, token, expiresAt };
  }

  /**
   * Validate a session token and return the active session if it still exists.
   */
  async authenticate(token: string): Promise<AuthSession | null> {
    return this.repository.findActiveSession(
      hashSessionToken(token),
      new Date(),
    );
  }

  /**
   * Remove the existing user session when the client sends a valid logout token.
   */
  async logout(token: string | undefined): Promise<void> {
    if (token) {
      await this.repository.deleteSession(hashSessionToken(token));
    }
  }
}
