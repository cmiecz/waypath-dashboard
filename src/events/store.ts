import type { BotEvent } from "../pipeline/types.js";
import { newId } from "../config.js";

const MAX_EVENTS = 400;

export interface EventStore {
  add(event: Omit<BotEvent, "id" | "createdAt"> & { createdAt?: string }): Promise<BotEvent>;
  list(limit?: number): Promise<BotEvent[]>;
  /** Open started events without a later finished for same bot+issue */
  activeStarted(): Promise<BotEvent[]>;
}

export class MemoryEventStore implements EventStore {
  private events: BotEvent[] = [];

  async add(
    input: Omit<BotEvent, "id" | "createdAt"> & { createdAt?: string },
  ): Promise<BotEvent> {
    const event: BotEvent = {
      id: newId(),
      bot: input.bot,
      issue: input.issue,
      action: input.action,
      message: input.message,
      url: input.url,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
    return event;
  }

  async list(limit = 200): Promise<BotEvent[]> {
    return this.events.slice(0, limit);
  }

  async activeStarted(): Promise<BotEvent[]> {
    const finished = new Set<string>();
    const active: BotEvent[] = [];
    // events are newest-first
    for (const e of this.events) {
      const key = `${e.bot.toLowerCase()}::${e.issue}`;
      if (e.action === "finished") {
        finished.add(key);
        continue;
      }
      if (e.action === "started" && !finished.has(key)) {
        // keep the most recent started per key
        if (!active.some((a) => `${a.bot.toLowerCase()}::${a.issue}` === key)) {
          active.push(e);
        }
      }
    }
    return active;
  }

  /** Test helper */
  clear(): void {
    this.events = [];
  }

  seed(events: BotEvent[]): void {
    this.events = [...events].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
}

export class PostgresEventStore implements EventStore {
  constructor(private pool: import("pg").Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bot_events (
        id TEXT PRIMARY KEY,
        bot TEXT NOT NULL,
        issue INTEGER NOT NULL,
        action TEXT NOT NULL,
        message TEXT NOT NULL,
        url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS bot_events_created_at_idx ON bot_events (created_at DESC);
    `);
  }

  async add(
    input: Omit<BotEvent, "id" | "createdAt"> & { createdAt?: string },
  ): Promise<BotEvent> {
    const event: BotEvent = {
      id: newId(),
      bot: input.bot,
      issue: input.issue,
      action: input.action,
      message: input.message,
      url: input.url,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    await this.pool.query(
      `INSERT INTO bot_events (id, bot, issue, action, message, url, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        event.id,
        event.bot,
        event.issue,
        event.action,
        event.message,
        event.url ?? null,
        event.createdAt,
      ],
    );
    // Trim old rows
    await this.pool.query(`
      DELETE FROM bot_events
      WHERE id IN (
        SELECT id FROM bot_events
        ORDER BY created_at DESC
        OFFSET $1
      )
    `, [MAX_EVENTS]);
    return event;
  }

  async list(limit = 200): Promise<BotEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT id, bot, issue, action, message, url, created_at AS "createdAt"
       FROM bot_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      bot: r.bot,
      issue: r.issue,
      action: r.action,
      message: r.message,
      url: r.url ?? undefined,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  async activeStarted(): Promise<BotEvent[]> {
    const events = await this.list(MAX_EVENTS);
    const mem = new MemoryEventStore();
    mem.seed(events);
    return mem.activeStarted();
  }
}

export async function createEventStore(
  databaseUrl: string,
): Promise<{ store: EventStore; backend: "postgres" | "memory" }> {
  if (!databaseUrl) {
    return { store: new MemoryEventStore(), backend: "memory" };
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  const store = new PostgresEventStore(pool);
  await store.ensureSchema();
  return { store, backend: "postgres" };
}
