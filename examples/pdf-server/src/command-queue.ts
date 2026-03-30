/**
 * A generic command queue with long-polling support, for server↔viewer
 * communication in MCP Apps.
 *
 * The server enqueues commands (e.g. "navigate to page 5", "fill form"); the
 * viewer polls via {@link app!App.callServerTool `callServerTool`} and receives batches.
 *
 * Two built-in storage backends:
 *
 * - **Memory** (default) — zero-latency wake-on-enqueue, ideal for stdio /
 *   single-instance deployments.
 * - **Redis** — cross-instance, works with Upstash REST on Vercel or any
 *   ioredis-compatible client. Enqueue notifications use a pub/sub channel
 *   when available, otherwise falls back to polling.
 *
 * @example
 * ```ts
 * import { CommandQueue } from "@modelcontextprotocol/ext-apps/server";
 *
 * // In-memory (stdio / single-instance)
 * const queue = new CommandQueue<MyCommand>();
 *
 * // Redis-backed (remote / serverless)
 * const queue = new CommandQueue<MyCommand>({
 *   store: new RedisCommandStore({
 *     url: process.env.UPSTASH_REDIS_REST_URL!,
 *     token: process.env.UPSTASH_REDIS_REST_TOKEN!,
 *   }),
 * });
 *
 * // Enqueue from a tool handler
 * await queue.enqueue(viewUUID, { type: "navigate", page: 5 });
 *
 * // Long-poll from a poll tool (blocks until commands arrive or timeout)
 * const commands = await queue.poll(viewUUID);
 * ```
 *
 * @module command-queue
 */

// ─── Store interface ─────────────────────────────────────────────────────────

/**
 * Pluggable storage backend for {@link CommandQueue}.
 *
 * Implementations must be safe to call concurrently from multiple async
 * contexts (but not necessarily from multiple processes — that's what the
 * Redis store is for).
 */
export interface CommandStore {
  /** Append serialised commands to the queue for `queueId`. */
  push(queueId: string, items: string[]): Promise<void>;

  /**
   * Atomically drain all commands for `queueId`, returning them in FIFO
   * order.  Returns `[]` when empty.
   */
  popAll(queueId: string): Promise<string[]>;

  /** Return `true` if the queue has at least one command. */
  hasItems(queueId: string): Promise<boolean>;

  /** Record activity for `queueId` (prevents TTL pruning). */
  touch(queueId: string): Promise<void>;

  /**
   * Remove queues whose last activity is older than `maxAgeMs`.
   * Returns the IDs of pruned queues.
   */
  prune(maxAgeMs: number): Promise<string[]>;

  /** Release resources (timers, connections). */
  close(): Promise<void>;
}

// ─── Notifier interface ──────────────────────────────────────────────────────

/**
 * Optional real-time notification layer.  When a notifier is present,
 * {@link CommandQueue.poll} wakes immediately on enqueue instead of
 * polling at intervals.
 */
export interface CommandNotifier {
  /** Signal that `queueId` has new items. */
  notify(queueId: string): void;

  /**
   * Block until `queueId` is notified or `timeoutMs` elapses.
   * Returns `true` if woken by a notification, `false` on timeout.
   * Must respect `signal` for cancellation.
   */
  wait(
    queueId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean>;

  /** Release resources. */
  close(): void;
}

// ─── Memory implementations ─────────────────────────────────────────────────

/** In-memory store — zero overhead, single-process only. */
export class MemoryCommandStore implements CommandStore {
  private queues = new Map<string, string[]>();
  private activity = new Map<string, number>();

  async push(queueId: string, items: string[]): Promise<void> {
    let queue = this.queues.get(queueId);
    if (!queue) {
      queue = [];
      this.queues.set(queueId, queue);
    }
    queue.push(...items);
    this.activity.set(queueId, Date.now());
  }

  async popAll(queueId: string): Promise<string[]> {
    const queue = this.queues.get(queueId);
    if (!queue || queue.length === 0) return [];
    const items = queue.splice(0);
    this.queues.delete(queueId);
    return items;
  }

  async hasItems(queueId: string): Promise<boolean> {
    const q = this.queues.get(queueId);
    return !!q && q.length > 0;
  }

  async touch(queueId: string): Promise<void> {
    this.activity.set(queueId, Date.now());
  }

  async prune(maxAgeMs: number): Promise<string[]> {
    const now = Date.now();
    const pruned: string[] = [];
    for (const [id, ts] of this.activity) {
      if (now - ts > maxAgeMs) {
        this.activity.delete(id);
        this.queues.delete(id);
        pruned.push(id);
      }
    }
    return pruned;
  }

  async close(): Promise<void> {
    this.queues.clear();
    this.activity.clear();
  }
}

/**
 * In-memory notifier — resolves waiters synchronously on
 * {@link MemoryCommandNotifier.notify notify()}, giving zero-latency
 * wake-on-enqueue for single-process deployments.
 *
 * Only one waiter is active per queue ID at a time — a new `wait()`
 * cancels the previous one (returns `false`).  This matches the
 * expected single-consumer-per-view pattern.
 */
export class MemoryCommandNotifier implements CommandNotifier {
  /** Maps queueId → { wake(), cancel() } for the active waiter. */
  private waiters = new Map<string, { wake: () => void; cancel: () => void }>();

  notify(queueId: string): void {
    const w = this.waiters.get(queueId);
    if (w) {
      this.waiters.delete(queueId);
      w.wake();
    }
  }

  wait(
    queueId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }

      // Cancel any existing waiter for this queue — only the latest
      // poll should drain the queue.
      const prev = this.waiters.get(queueId);
      if (prev) prev.cancel();

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (this.waiters.get(queueId)?.wake === wake) {
          this.waiters.delete(queueId);
        }
      };

      const wake = () => {
        cleanup();
        resolve(true);
      };

      const cancel = () => {
        cleanup();
        resolve(false);
      };

      const onAbort = () => cancel();

      const timer = setTimeout(() => cancel(), timeoutMs);

      signal?.addEventListener("abort", onAbort);
      this.waiters.set(queueId, { wake, cancel });
    });
  }

  close(): void {
    for (const w of this.waiters.values()) w.cancel();
    this.waiters.clear();
  }
}

// ─── Redis implementations ──────────────────────────────────────────────────

/**
 * Minimal interface for the Redis operations used by {@link RedisCommandStore}.
 *
 * Compatible with both Upstash REST (`@upstash/redis`) and ioredis-style
 * clients.  If you use a different Redis library, adapt it to this interface.
 */
export interface RedisLike {
  /** LPUSH — prepend values to list (newest first). */
  lpush(key: string, ...values: string[]): Promise<number>;
  /** LRANGE — read range from list. */
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  /** DEL — delete key(s). */
  del(...keys: string[]): Promise<number>;
  /** SET with optional EX (TTL in seconds). */
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>;
  /** GET — read string value. */
  get(key: string): Promise<string | null>;
  /** KEYS — pattern match (only used for pruning, not hot path). */
  keys(pattern: string): Promise<string[]>;
  /** EXPIRE — set TTL. */
  expire(key: string, seconds: number): Promise<unknown>;
  /**
   * PUBLISH — optional, for real-time wake notifications.
   * If not provided, {@link RedisCommandNotifier} falls back to polling.
   */
  publish?(channel: string, message: string): Promise<unknown>;
  /**
   * SUBSCRIBE — optional, for real-time wake notifications.
   * Should return a cleanup function.
   */
  subscribe?(
    channel: string,
    callback: (message: string) => void,
  ): Promise<() => Promise<void>>;
}

/**
 * Options for creating a {@link RedisCommandStore} from Upstash REST
 * credentials (no persistent connection required — Vercel-safe).
 */
export interface UpstashCredentials {
  url: string;
  token: string;
}

/**
 * Minimal Upstash REST adapter implementing {@link RedisLike}.
 * Uses `fetch` only — no persistent connections, safe for serverless.
 */
class UpstashRestClient implements RedisLike {
  constructor(private creds: UpstashCredentials) {}

  private async cmd<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(
      `${this.creds.url}/${args.map(encodeURIComponent).join("/")}`,
      {
        headers: { Authorization: `Bearer ${this.creds.token}` },
        method: args.length > 1 ? undefined : "GET",
      },
    );
    if (!res.ok) {
      throw new Error(`Upstash ${args[0]}: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { result: T };
    return json.result;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.cmd<number>("LPUSH", key, ...values);
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.cmd<string[]>("LRANGE", key, String(start), String(stop));
  }
  async del(...keys: string[]): Promise<number> {
    return this.cmd<number>("DEL", ...keys);
  }
  async set(
    key: string,
    value: string,
    options?: { ex?: number },
  ): Promise<unknown> {
    if (options?.ex) {
      return this.cmd("SET", key, value, "EX", options.ex);
    }
    return this.cmd("SET", key, value);
  }
  async get(key: string): Promise<string | null> {
    return this.cmd<string | null>("GET", key);
  }
  async keys(pattern: string): Promise<string[]> {
    return this.cmd<string[]>("KEYS", pattern);
  }
  async expire(key: string, seconds: number): Promise<unknown> {
    return this.cmd("EXPIRE", key, seconds);
  }
}

const REDIS_PREFIX = "mcp:cmdq:";

/** Redis-backed command store for cross-instance deployments. */
export class RedisCommandStore implements CommandStore {
  readonly redis: RedisLike;

  constructor(options: { redis: RedisLike } | UpstashCredentials) {
    if ("redis" in options) {
      this.redis = options.redis;
    } else {
      this.redis = new UpstashRestClient(options);
    }
  }

  private listKey(queueId: string): string {
    return `${REDIS_PREFIX}list:${queueId}`;
  }
  private activityKey(queueId: string): string {
    return `${REDIS_PREFIX}activity:${queueId}`;
  }

  async push(queueId: string, items: string[]): Promise<void> {
    // LPUSH adds to head; we reverse so LRANGE 0 -1 returns FIFO order.
    await this.redis.lpush(this.listKey(queueId), ...[...items].reverse());
    await this.redis.set(this.activityKey(queueId), String(Date.now()), {
      ex: 120,
    });
  }

  async popAll(queueId: string): Promise<string[]> {
    const key = this.listKey(queueId);
    // Read all, then delete. Not truly atomic, but acceptable:
    // worst case a concurrent push between LRANGE and DEL is lost,
    // and the viewer will re-poll immediately.
    const items = await this.redis.lrange(key, 0, -1);
    if (items.length > 0) {
      await this.redis.del(key);
    }
    // LRANGE returns newest-first (LPUSH order); reverse for FIFO.
    return items.reverse();
  }

  async hasItems(queueId: string): Promise<boolean> {
    const items = await this.redis.lrange(this.listKey(queueId), 0, 0);
    return items.length > 0;
  }

  async touch(queueId: string): Promise<void> {
    await this.redis.set(this.activityKey(queueId), String(Date.now()), {
      ex: 120,
    });
  }

  async prune(maxAgeMs: number): Promise<string[]> {
    const now = Date.now();
    const keys = await this.redis.keys(`${REDIS_PREFIX}activity:*`);
    const pruned: string[] = [];
    for (const key of keys) {
      const val = await this.redis.get(key);
      if (val && now - Number(val) > maxAgeMs) {
        const queueId = key.slice(`${REDIS_PREFIX}activity:`.length);
        await this.redis.del(key, this.listKey(queueId));
        pruned.push(queueId);
      }
    }
    return pruned;
  }

  async close(): Promise<void> {
    // No persistent connections to close for REST-based clients.
  }
}

/**
 * Redis-backed notifier.  If the {@link RedisLike} client supports
 * `publish` + `subscribe`, uses real-time pub/sub.  Otherwise falls
 * back to polling `hasItems` on the store at `pollIntervalMs`.
 */
export class RedisCommandNotifier implements CommandNotifier {
  private store: CommandStore;
  private redis: RedisLike;
  private pollIntervalMs: number;
  private cleanups: (() => Promise<void>)[] = [];

  constructor(
    store: CommandStore,
    redis: RedisLike,
    options?: { pollIntervalMs?: number },
  ) {
    this.store = store;
    this.redis = redis;
    this.pollIntervalMs = options?.pollIntervalMs ?? 300;
  }

  private channelKey(queueId: string): string {
    return `${REDIS_PREFIX}notify:${queueId}`;
  }

  notify(queueId: string): void {
    if (this.redis.publish) {
      void this.redis.publish(this.channelKey(queueId), "1");
    }
    // If no publish, poll-based waiters will pick it up on next tick.
  }

  async wait(
    queueId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) return false;

    // Try pub/sub first.
    if (this.redis.subscribe) {
      return this.waitPubSub(queueId, timeoutMs, signal);
    }
    // Fallback: poll store.
    return this.waitPoll(queueId, timeoutMs, signal);
  }

  private waitPubSub(
    queueId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        void cleanupSub?.();
        resolve(val);
      };

      const timer = setTimeout(() => settle(false), timeoutMs);
      const onAbort = () => settle(false);
      signal?.addEventListener("abort", onAbort);

      let cleanupSub: (() => Promise<void>) | undefined;
      this.redis.subscribe!(this.channelKey(queueId), () => settle(true))
        .then((unsub) => {
          cleanupSub = unsub;
          if (settled) void unsub();
        })
        .catch(() => {
          // Subscription failed — fall back to polling.
          this.waitPoll(queueId, timeoutMs, signal).then(resolve);
        });
    });
  }

  private waitPoll(
    queueId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (signal?.aborted || Date.now() >= deadline) {
          resolve(false);
          return;
        }
        void this.store.hasItems(queueId).then((has) => {
          if (has) {
            resolve(true);
          } else {
            setTimeout(check, this.pollIntervalMs);
          }
        });
      };
      check();
    });
  }

  close(): void {
    for (const fn of this.cleanups) void fn();
    this.cleanups = [];
  }
}

// ─── CommandQueue ────────────────────────────────────────────────────────────

/** Configuration for {@link CommandQueue}. */
export interface CommandQueueOptions {
  /**
   * Storage backend.  Defaults to {@link MemoryCommandStore}.
   * Pass a {@link RedisCommandStore} (or any {@link CommandStore}) for
   * cross-instance deployments.
   */
  store?: CommandStore;

  /**
   * Real-time notification layer.  Defaults to
   * {@link MemoryCommandNotifier} when `store` is memory,
   * or {@link RedisCommandNotifier} when `store` is
   * {@link RedisCommandStore}.
   */
  notifier?: CommandNotifier;

  /** Max time (ms) a queue can be idle before pruning. Default: 60 000. */
  ttlMs?: number;

  /** Sweep interval (ms) for pruning stale queues. Default: 30 000. */
  sweepIntervalMs?: number;

  /**
   * After commands are detected, wait this long (ms) for more to
   * accumulate before returning the batch. Default: 200.
   */
  batchWaitMs?: number;

  /** Max time (ms) to hold a long-poll open. Default: 30 000. */
  pollTimeoutMs?: number;
}

/**
 * Generic command queue with long-polling for MCP Apps server↔viewer
 * communication.
 *
 * @typeParam T - The command type (e.g. `PdfCommand`).
 */
export class CommandQueue<T> {
  readonly store: CommandStore;
  readonly notifier: CommandNotifier;
  readonly ttlMs: number;
  readonly batchWaitMs: number;
  readonly pollTimeoutMs: number;

  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private onPruneCallbacks = new Set<(queueIds: string[]) => void>();

  constructor(options?: CommandQueueOptions) {
    const store = options?.store ?? new MemoryCommandStore();
    this.store = store;

    // Auto-create a matching notifier if not provided.
    if (options?.notifier) {
      this.notifier = options.notifier;
    } else if (store instanceof RedisCommandStore) {
      this.notifier = new RedisCommandNotifier(store, store.redis);
    } else {
      this.notifier = new MemoryCommandNotifier();
    }

    this.ttlMs = options?.ttlMs ?? 60_000;
    this.batchWaitMs = options?.batchWaitMs ?? 200;
    this.pollTimeoutMs = options?.pollTimeoutMs ?? 30_000;

    const sweepMs = options?.sweepIntervalMs ?? 30_000;
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    // Allow the process to exit without waiting for the sweep timer.
    if (typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

  /**
   * Register a callback that fires when queues are pruned due to
   * inactivity.  Useful for cleaning up associated resources (e.g.
   * file watchers, form field caches).
   */
  onPrune(callback: (queueIds: string[]) => void): () => void {
    this.onPruneCallbacks.add(callback);
    return () => this.onPruneCallbacks.delete(callback);
  }

  /** Enqueue a command for a given view/queue. */
  async enqueue(queueId: string, command: T): Promise<void> {
    const pushed = this.store.push(queueId, [JSON.stringify(command)]);
    // Notify synchronously so in-memory waiters wake in the same tick.
    this.notifier.notify(queueId);
    await pushed;
  }

  /** Enqueue multiple commands at once. */
  async enqueueBatch(queueId: string, commands: T[]): Promise<void> {
    if (commands.length === 0) return;
    const pushed = this.store.push(
      queueId,
      commands.map((c) => JSON.stringify(c)),
    );
    this.notifier.notify(queueId);
    await pushed;
  }

  /**
   * Long-poll for commands.  Blocks until commands are available or
   * `pollTimeoutMs` elapses, then returns all accumulated commands.
   *
   * This is the method you call inside your `poll_*_commands` tool handler.
   */
  async poll(
    queueId: string,
    options?: {
      timeoutMs?: number;
      batchWaitMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<T[]> {
    const timeoutMs = options?.timeoutMs ?? this.pollTimeoutMs;
    const batchWaitMs = options?.batchWaitMs ?? this.batchWaitMs;

    const signal = options?.signal;

    // If already aborted, return immediately without draining.
    if (signal?.aborted) return [];

    // Touch on every poll to keep the queue alive.
    await this.store.touch(queueId);

    const hasItems = await this.store.hasItems(queueId);

    if (hasItems) {
      // Commands already queued — wait briefly to let more accumulate.
      await sleep(batchWaitMs);
    } else {
      // Long-poll: wait for notification or timeout.
      const woken = await this.notifier.wait(queueId, timeoutMs, signal);
      if (signal?.aborted) return [];
      if (!woken) {
        // Timed out or cancelled — don't drain, just return empty.
        return [];
      }
      // Woken: batch-wait for more commands to accumulate.
      await sleep(batchWaitMs);
    }

    const raw = await this.store.popAll(queueId);
    return raw.map((s) => JSON.parse(s) as T);
  }

  /**
   * Record activity for a queue (prevents TTL pruning).
   * Call this when a view is first created or on any interaction.
   */
  async touch(queueId: string): Promise<void> {
    await this.store.touch(queueId);
  }

  /** Run a pruning sweep (also runs automatically on the sweep timer). */
  async sweep(): Promise<string[]> {
    const pruned = await this.store.prune(this.ttlMs);
    if (pruned.length > 0) {
      for (const cb of this.onPruneCallbacks) {
        try {
          cb(pruned);
        } catch {
          // Don't let a bad callback break the sweep.
        }
      }
    }
    return pruned;
  }

  /** Shut down: stop sweep timer, close store and notifier. */
  async close(): Promise<void> {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.notifier.close();
    await this.store.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
