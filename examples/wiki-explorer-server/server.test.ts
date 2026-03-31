import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server";

function firstText(r: Awaited<ReturnType<Client["callTool"]>>): string {
  return (r.content as Array<{ type: string; text: string }>)[0].text;
}

describe("wiki-explorer URL validation", () => {
  let server: ReturnType<typeof createServer>;
  let client: Client;

  beforeEach(async () => {
    server = createServer();
    client = new Client({ name: "test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("rejects non-Wikipedia URLs", async () => {
    const r = await client.callTool({
      name: "get-first-degree-links",
      arguments: { url: "https://evil.com/wiki/Test" },
    });
    const result = JSON.parse(firstText(r));
    expect(result.error).toBe("Not a valid Wikipedia URL");
  });

  it("rejects path traversal that escapes /wiki/", async () => {
    // This URL passes the old regex but resolves to /w/api.php (outside /wiki/)
    const r = await client.callTool({
      name: "get-first-degree-links",
      arguments: {
        url: "https://en.wikipedia.org/wiki/../../w/api.php?action=query&list=allusers",
      },
    });
    const result = JSON.parse(firstText(r));
    expect(result.error).toBe("Not a valid Wikipedia URL");
  });

  it("rejects path traversal to API endpoints", async () => {
    const r = await client.callTool({
      name: "get-first-degree-links",
      arguments: {
        url: "https://en.wikipedia.org/wiki/../../../api/rest_v1/feed/featured/2024/01/01",
      },
    });
    const result = JSON.parse(firstText(r));
    expect(result.error).toBe("Not a valid Wikipedia URL");
  });

  it("accepts valid Wikipedia URLs", async () => {
    // Mock fetch to avoid real network requests
    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html><body><a href='/wiki/Test'>Test</a></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    try {
      const r = await client.callTool({
        name: "get-first-degree-links",
        arguments: {
          url: "https://en.wikipedia.org/wiki/Model_Context_Protocol",
        },
      });
      const result = JSON.parse(firstText(r));
      expect(result.error).toBeNull();
      expect(result.page.url).toBe(
        "https://en.wikipedia.org/wiki/Model_Context_Protocol",
      );
    } finally {
      mockFetch.mockRestore();
    }
  });

  it("disables redirect following on fetch", async () => {
    // Ensure fetch is called with redirect: 'error' or 'manual' to prevent
    // following redirects to non-Wikipedia domains
    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html><body></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    try {
      await client.callTool({
        name: "get-first-degree-links",
        arguments: {
          url: "https://en.wikipedia.org/wiki/Test_Page",
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchArgs = mockFetch.mock.calls[0];
      // Second argument should have redirect: "error"
      expect(fetchArgs[1]).toBeDefined();
      expect((fetchArgs[1] as RequestInit).redirect).toBe("error");
    } finally {
      mockFetch.mockRestore();
    }
  });
});
