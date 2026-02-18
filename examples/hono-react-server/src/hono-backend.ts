/**
 * @file Pure Hono HTTP backend with no MCP dependencies.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

export type Item = {
  id: number;
  name: string;
  createdAt: string;
};

const items: Item[] = [
  { id: 1, name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: 2, name: "Bravo", createdAt: "2026-01-02T00:00:00.000Z" },
];
let nextId = 3;

export const honoApp = new Hono()
  .use("*", cors())
  .get("/api/time", (c) =>
    c.json({
      time: new Date().toISOString(),
      source: "hono-backend",
    }),
  )
  .get("/api/items", (c) => c.json({ items }))
  .post("/api/items", async (c) => {
    const body = await c.req.json<{ name?: string }>();
    const name = body?.name?.trim();

    if (!name) {
      return c.json({ error: "Missing item name" }, 400);
    }

    const item: Item = {
      id: nextId++,
      name,
      createdAt: new Date().toISOString(),
    };
    items.push(item);

    return c.json({ item, items }, 201);
  })
  .delete("/api/items/:id", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) {
      return c.json({ error: "Item not found" }, 404);
    }

    items.splice(index, 1);
    return c.json({ items });
  })
  .get("/api/mode", (c) => {
    const headers = Object.fromEntries(c.req.raw.headers.entries());
    return c.json({
      message: "Request received by Hono backend",
      userAgent: headers["user-agent"] ?? "unknown",
      timestamp: new Date().toISOString(),
    });
  });

export type AppType = typeof honoApp;
