import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  CommandQueue,
  MemoryCommandStore,
  MemoryCommandNotifier,
  RedisCommandStore,
  RedisCommandNotifier,
  type RedisLike,
  type CommandStore,
  type CommandNotifier,
} from "./command-queue";

// ─── In-memory mock of RedisLike ────────────────────────────────────────────

class MockRedis implements RedisLike {
  private store = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private subs = new Map<string, Set<(msg: string) => void>>();

  async lpush(key: string, ...values: string[]): Promise<number> {
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }
    // LPUSH prepends; push to front
    list.unshift(...values);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    if (stop === -1) return list.slice(start);
    return list.slice(start, stop + 1);
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.store.delete(k)) count++;
      if (this.lists.delete(k)) count++;
    }
    return count;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace("*", "");
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }

  async expire(): Promise<unknown> {
    return 1;
  }

  async publish(channel: string, message: string): Promise<unknown> {
    const set = this.subs.get(channel);
    if (set) for (const cb of set) cb(message);
    return set?.size ?? 0;
  }

  async subscribe(
    channel: string,
    callback: (message: string) => void,
  ): Promise<() => Promise<void>> {
    let set = this.subs.get(channel);
    if (!set) {
      set = new Set();
      this.subs.set(channel, set);
    }
    set.add(callback);
    return async () => {
      set!.delete(callback);
      if (set!.size === 0) this.subs.delete(channel);
    };
  }
}

// ─── Shared test suite (runs for both backends) ─────────────────────────────

type Command = { type: string; page?: number };

function suiteFor(
  name: string,
  makeQueue: () => {
    queue: CommandQueue<Command>;
    store: CommandStore;
    notifier: CommandNotifier;
  },
) {
  describe(name, () => {
    let queue: CommandQueue<Command>;

    beforeEach(() => {
      const ctx = makeQueue();
      queue = ctx.queue;
    });

    afterEach(async () => {
      await queue.close();
    });

    it("enqueue then poll returns commands in FIFO order", async () => {
      await queue.enqueue("v1", { type: "navigate", page: 1 });
      await queue.enqueue("v1", { type: "navigate", page: 2 });

      const cmds = await queue.poll("v1", {
        timeoutMs: 100,
        batchWaitMs: 10,
      });

      expect(cmds).toEqual([
        { type: "navigate", page: 1 },
        { type: "navigate", page: 2 },
      ]);
    });

    it("poll returns empty array on timeout when no commands", async () => {
      const cmds = await queue.poll("v1", {
        timeoutMs: 50,
        batchWaitMs: 10,
      });
      expect(cmds).toEqual([]);
    });

    it("poll wakes up when command is enqueued during wait", async () => {
      const t0 = Date.now();

      // Start polling in background
      const pollPromise = queue.poll("v1", {
        timeoutMs: 5000,
        batchWaitMs: 10,
      });

      // Enqueue after a short delay
      await sleep(30);
      await queue.enqueue("v1", { type: "navigate", page: 3 });

      const cmds = await pollPromise;
      const elapsed = Date.now() - t0;

      expect(cmds).toEqual([{ type: "navigate", page: 3 }]);
      // Should have woken up well before the 5s timeout
      expect(elapsed).toBeLessThan(2000);
    });

    it("poll drains queue — second poll gets nothing", async () => {
      await queue.enqueue("v1", { type: "navigate", page: 1 });

      const first = await queue.poll("v1", {
        timeoutMs: 100,
        batchWaitMs: 10,
      });
      expect(first).toHaveLength(1);

      const second = await queue.poll("v1", {
        timeoutMs: 50,
        batchWaitMs: 10,
      });
      expect(second).toEqual([]);
    });

    it("different queueIds are independent", async () => {
      await queue.enqueue("v1", { type: "navigate", page: 1 });
      await queue.enqueue("v2", { type: "navigate", page: 2 });

      const cmds1 = await queue.poll("v1", {
        timeoutMs: 100,
        batchWaitMs: 10,
      });
      const cmds2 = await queue.poll("v2", {
        timeoutMs: 100,
        batchWaitMs: 10,
      });

      expect(cmds1).toEqual([{ type: "navigate", page: 1 }]);
      expect(cmds2).toEqual([{ type: "navigate", page: 2 }]);
    });

    it("enqueueBatch adds multiple commands at once", async () => {
      await queue.enqueueBatch("v1", [
        { type: "navigate", page: 1 },
        { type: "navigate", page: 2 },
        { type: "navigate", page: 3 },
      ]);

      const cmds = await queue.poll("v1", {
        timeoutMs: 100,
        batchWaitMs: 10,
      });
      expect(cmds).toHaveLength(3);
      expect(cmds[0]).toEqual({ type: "navigate", page: 1 });
      expect(cmds[2]).toEqual({ type: "navigate", page: 3 });
    });

    it("poll respects AbortSignal", async () => {
      const controller = new AbortController();

      // Abort quickly
      setTimeout(() => controller.abort(), 30);

      const t0 = Date.now();
      const cmds = await queue.poll("v1", {
        timeoutMs: 5000,
        signal: controller.signal,
      });
      const elapsed = Date.now() - t0;

      expect(cmds).toEqual([]);
      expect(elapsed).toBeLessThan(2000);
    });

    it("sweep prunes stale queues", async () => {
      // Create a queue with very short TTL
      await queue.close();
      const ctx = makeQueue();
      queue = new CommandQueue<Command>({
        store: ctx.store,
        notifier: ctx.notifier,
        ttlMs: 10,
        sweepIntervalMs: 999_999, // manual sweep
      });

      await queue.enqueue("v1", { type: "navigate", page: 1 });
      await sleep(50);

      const pruned = await queue.sweep();
      expect(pruned).toContain("v1");

      // Queue should be empty after prune
      const cmds = await queue.poll("v1", {
        timeoutMs: 50,
        batchWaitMs: 10,
      });
      expect(cmds).toEqual([]);
    });

    it("touch prevents pruning", async () => {
      await queue.close();
      const ctx = makeQueue();
      queue = new CommandQueue<Command>({
        store: ctx.store,
        notifier: ctx.notifier,
        ttlMs: 100,
        sweepIntervalMs: 999_999,
      });

      await queue.enqueue("v1", { type: "navigate", page: 1 });
      await sleep(60);
      await queue.touch("v1");
      await sleep(60);

      const pruned = await queue.sweep();
      expect(pruned).not.toContain("v1");
    });

    it("onPrune callback fires with pruned IDs", async () => {
      await queue.close();
      const ctx = makeQueue();
      queue = new CommandQueue<Command>({
        store: ctx.store,
        notifier: ctx.notifier,
        ttlMs: 10,
        sweepIntervalMs: 999_999,
      });

      await queue.enqueue("v1", { type: "navigate", page: 1 });
      await queue.enqueue("v2", { type: "navigate", page: 2 });
      await sleep(50);

      const prunedIds: string[][] = [];
      queue.onPrune((ids) => prunedIds.push(ids));

      await queue.sweep();
      expect(prunedIds).toHaveLength(1);
      expect(prunedIds[0]).toContain("v1");
      expect(prunedIds[0]).toContain("v2");
    });
  });
}

// ─── Run suite for Memory backend ───────────────────────────────────────────

suiteFor("CommandQueue (memory)", () => {
  const store = new MemoryCommandStore();
  const notifier = new MemoryCommandNotifier();
  return {
    store,
    notifier,
    queue: new CommandQueue<Command>({
      store,
      notifier,
      sweepIntervalMs: 999_999, // manual sweep in tests
    }),
  };
});

// ─── Run suite for Redis backend ────────────────────────────────────────────

suiteFor("CommandQueue (redis mock)", () => {
  const redis = new MockRedis();
  const store = new RedisCommandStore({ redis });
  const notifier = new RedisCommandNotifier(store, redis, {
    pollIntervalMs: 50,
  });
  return {
    store,
    notifier,
    queue: new CommandQueue<Command>({
      store,
      notifier,
      sweepIntervalMs: 999_999,
    }),
  };
});

// ─── Redis-specific tests ───────────────────────────────────────────────────

describe("RedisCommandNotifier pub/sub wake", () => {
  it("wakes poll via publish when subscribe is available", async () => {
    const redis = new MockRedis();
    const store = new RedisCommandStore({ redis });
    const notifier = new RedisCommandNotifier(store, redis);
    const queue = new CommandQueue<Command>({
      store,
      notifier,
      sweepIntervalMs: 999_999,
    });

    const t0 = Date.now();
    const pollPromise = queue.poll("v1", {
      timeoutMs: 5000,
      batchWaitMs: 10,
    });

    await sleep(30);
    await queue.enqueue("v1", { type: "navigate", page: 42 });

    const cmds = await pollPromise;
    const elapsed = Date.now() - t0;

    expect(cmds).toEqual([{ type: "navigate", page: 42 }]);
    expect(elapsed).toBeLessThan(2000);

    await queue.close();
  });
});

describe("RedisCommandNotifier polling fallback", () => {
  it("wakes poll via polling when subscribe is not available", async () => {
    const redis = new MockRedis();
    // Remove subscribe/publish to force polling mode
    const limitedRedis: RedisLike = {
      lpush: redis.lpush.bind(redis),
      lrange: redis.lrange.bind(redis),
      del: redis.del.bind(redis),
      set: redis.set.bind(redis),
      get: redis.get.bind(redis),
      keys: redis.keys.bind(redis),
      expire: redis.expire.bind(redis),
      // No publish, no subscribe
    };

    const store = new RedisCommandStore({ redis: limitedRedis });
    const notifier = new RedisCommandNotifier(store, limitedRedis, {
      pollIntervalMs: 50,
    });
    const queue = new CommandQueue<Command>({
      store,
      notifier,
      sweepIntervalMs: 999_999,
    });

    const t0 = Date.now();
    const pollPromise = queue.poll("v1", {
      timeoutMs: 5000,
      batchWaitMs: 10,
    });

    await sleep(30);
    await queue.enqueue("v1", { type: "navigate", page: 99 });

    const cmds = await pollPromise;
    const elapsed = Date.now() - t0;

    expect(cmds).toEqual([{ type: "navigate", page: 99 }]);
    // Polling at 50ms intervals means ~80ms worst case
    expect(elapsed).toBeLessThan(2000);

    await queue.close();
  });
});

// ─── Default constructor (no options) ───────────────────────────────────────

describe("CommandQueue defaults", () => {
  it("works with zero-arg constructor (memory backend)", async () => {
    const queue = new CommandQueue<Command>();
    await queue.enqueue("v1", { type: "navigate", page: 1 });
    const cmds = await queue.poll("v1", {
      timeoutMs: 100,
      batchWaitMs: 10,
    });
    expect(cmds).toEqual([{ type: "navigate", page: 1 }]);
    await queue.close();
  });
});

// ─── UpstashRestClient tests (via RedisCommandStore + fetch mock) ────────────

describe("RedisCommandStore with Upstash credentials", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let originalFetch: typeof globalThis.fetch;
  let mockResponses: Array<{ result: unknown }>;

  beforeEach(() => {
    calls.length = 0;
    mockResponses = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push({ url, init: init ?? {} });
      const body = mockResponses.shift() ?? { result: null };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct Authorization header and URL encoding", async () => {
    mockResponses.push({ result: 1 }); // LPUSH response
    mockResponses.push({ result: "OK" }); // SET response

    const store = new RedisCommandStore({
      url: "https://my-redis.upstash.io",
      token: "my-secret-token",
    });
    await store.push("view/1", ['{"type":"test"}']);

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].url).toContain("https://my-redis.upstash.io/");
    expect(calls[0].url).toContain("LPUSH");
    expect(calls[0].init.headers).toEqual({
      Authorization: "Bearer my-secret-token",
    });
    // Queue ID with "/" should be encoded
    expect(calls[0].url).toContain("view%2F1");
  });

  it("handles Upstash error responses", async () => {
    globalThis.fetch = (async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const store = new RedisCommandStore({
      url: "https://my-redis.upstash.io",
      token: "bad-token",
    });

    await expect(store.push("v1", ["cmd"])).rejects.toThrow(
      "Upstash LPUSH: 401",
    );
  });

  it("popAll reverses LRANGE result for FIFO order", async () => {
    // LRANGE returns newest-first (LPUSH order)
    mockResponses.push({
      result: ['{"type":"b"}', '{"type":"a"}'],
    });
    mockResponses.push({ result: 1 }); // DEL

    const store = new RedisCommandStore({
      url: "https://test.upstash.io",
      token: "tok",
    });
    const items = await store.popAll("v1");

    // Should be reversed to FIFO: a first, then b
    expect(items).toEqual(['{"type":"a"}', '{"type":"b"}']);
  });

  it("set with EX passes TTL arguments", async () => {
    mockResponses.push({ result: "OK" });

    const store = new RedisCommandStore({
      url: "https://test.upstash.io",
      token: "tok",
    });
    await store.touch("v1");

    const setCall = calls.find((c) => c.url.includes("SET"));
    expect(setCall).toBeDefined();
    expect(setCall!.url).toContain("EX");
    expect(setCall!.url).toContain("120"); // default TTL
  });
});

// ─── MCP tool integration test ──────────────────────────────────────────────

describe("CommandQueue through MCP tool roundtrip", () => {
  it("enqueue via one tool, poll via another (simulated)", async () => {
    const queue = new CommandQueue<Command>();

    // Simulate show_tool creating a view
    const viewId = "test-view-123";
    await queue.touch(viewId);

    // Simulate interact_tool enqueuing commands
    await queue.enqueue(viewId, { type: "navigate", page: 10 });
    await queue.enqueue(viewId, { type: "navigate", page: 20 });

    // Simulate poll_tool draining
    const cmds = await queue.poll(viewId, {
      timeoutMs: 100,
      batchWaitMs: 10,
    });
    expect(cmds).toEqual([
      { type: "navigate", page: 10 },
      { type: "navigate", page: 20 },
    ]);

    // Second poll should be empty
    const cmds2 = await queue.poll(viewId, {
      timeoutMs: 50,
      batchWaitMs: 10,
    });
    expect(cmds2).toEqual([]);

    await queue.close();
  });

  it("concurrent enqueue during poll wakes immediately", async () => {
    const queue = new CommandQueue<Command>();
    const viewId = "concurrent-test";

    const t0 = Date.now();

    // Start poll (will block)
    const pollPromise = queue.poll(viewId, {
      timeoutMs: 5000,
      batchWaitMs: 10,
    });

    // Enqueue from "another tool" after delay
    await sleep(20);
    await queue.enqueue(viewId, { type: "navigate", page: 42 });

    const cmds = await pollPromise;
    expect(cmds).toEqual([{ type: "navigate", page: 42 }]);
    expect(Date.now() - t0).toBeLessThan(2000);

    await queue.close();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
