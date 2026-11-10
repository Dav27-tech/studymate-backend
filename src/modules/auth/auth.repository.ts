import type { PrismaClient, User } from "../../generated/prisma/client.js";

export type AuthUser = Pick<
  User,
  "id" | "email" | "firstName" | "lastName" | "createdAt"
>;

export interface AuthCredentials {
  user: AuthUser;
  passwordHash: string;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: Date;
}

export interface NewUserSession {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AuthRepository {
  createUserAndSession(input: NewUserSession): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<AuthCredentials | null>;
  createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  createdAt: true,
} as const;

export class PrismaAuthRepository implements AuthRepository {
  /**
 * Create this instance.
 */
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create User And Session.
   */
  async createUserAndSession(input: NewUserSession): Promise<AuthUser> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email: input.email,
          password: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          sessions: {
            create: {
              tokenHash: input.tokenHash,
              expiresAt: input.expiresAt,
            },
          },
        },
        select: publicUserSelect,
      });

      return user;
    });
  }

  /**
   * Find User By Email.
   */
  async findUserByEmail(email: string): Promise<AuthCredentials | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        ...publicUserSelect,
        password: true,
      },
    });

    if (!user) {
      return null;
    }

    const { password, ...publicUser } = user;
    return { user: publicUser, passwordHash: password };
  }

    /**
     * Create Session.
     */
    async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.session.create({
      data: { userId, tokenHash, expiresAt },
    });
  }

  /**
   * Find Active Session.
   */
  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSession | null> {
    return this.prisma.session.findFirst({
      where: { tokenHash, expiresAt: { gt: now } },
      select: {
        expiresAt: true,
        user: { select: publicUserSelect },
      },
    });
  }

  /**
   * Delete Session.
   */
  async deleteSession(tokenHash: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }
}
