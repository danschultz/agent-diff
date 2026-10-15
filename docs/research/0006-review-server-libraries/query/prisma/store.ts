import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/client.ts';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

export class Store {
  private readonly db: PrismaClient;

  private constructor(db: PrismaClient) {
    this.db = db;
  }

  static async open(file: string): Promise<Store> {
    const db = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: file }),
    });
    const schema = readFileSync(
      new URL('./schema.sql', import.meta.url),
      'utf8',
    );
    for (const statement of schema.split(';').filter((s) => s.trim()))
      await db.$executeRawUnsafe(statement);
    return new Store(db);
  }

  async createReviewSession(
    input: CreateReviewSession,
  ): Promise<ReviewSession> {
    const id = randomUUID();
    await this.db.reviewSession.create({
      data: {
        id,
        title: input.title ?? null,
        startedAt: new Date().toISOString(),
        workingDirectories: {
          create: input.workingDirectories.map((path) => ({ path })),
        },
      },
    });
    return (await this.getReviewSession(id))!;
  }

  async getReviewSession(id: string): Promise<ReviewSession | undefined> {
    const row = await this.db.reviewSession.findUnique({
      where: { id },
      include: {
        workingDirectories: {
          select: { path: true },
          orderBy: { path: 'asc' },
        },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    return row
      ? {
          ...row,
          workingDirectories: row.workingDirectories.map((d) => d.path),
        }
      : undefined;
  }

  async addComment(
    reviewSessionId: string,
    input: AddComment,
  ): Promise<Comment | undefined> {
    const exists = await this.db.reviewSession.findUnique({
      where: { id: reviewSessionId },
      select: { id: true },
    });
    if (!exists) return undefined;
    return this.db.comment.create({
      data: {
        id: randomUUID(),
        reviewSessionId,
        ...input,
        createdAt: new Date().toISOString(),
      },
    });
  }
}
