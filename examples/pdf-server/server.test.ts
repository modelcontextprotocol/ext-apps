import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createPdfCache,
  createServer,
  validateUrl,
  isAncestorDir,
  allowedLocalFiles,
  allowedLocalDirs,
  pathToFileUrl,
  startFileWatch,
  stopFileWatch,
  cliLocalFiles,
  isWritablePath,
  writeFlags,
  viewSourcePaths,
  CACHE_INACTIVITY_TIMEOUT_MS,
  CACHE_MAX_LIFETIME_MS,
  CACHE_MAX_PDF_SIZE_BYTES,
  type PdfCache,
} from "./server";

describe("PDF Cache with Timeouts", () => {
  let pdfCache: PdfCache;

  beforeEach(() => {
    // Each test gets its own session-local cache
    pdfCache = createPdfCache();
  });

  afterEach(() => {
    pdfCache.clearCache();
  });

  describe("cache configuration", () => {
    it("should have 10 second inactivity timeout", () => {
      expect(CACHE_INACTIVITY_TIMEOUT_MS).toBe(10_000);
    });

    it("should have 60 second max lifetime timeout", () => {
      expect(CACHE_MAX_LIFETIME_MS).toBe(60_000);
    });

    it("should have 50MB max PDF size limit", () => {
      expect(CACHE_MAX_PDF_SIZE_BYTES).toBe(50 * 1024 * 1024);
    });
  });

  describe("cache management", () => {
    it("should start with empty cache", () => {
      expect(pdfCache.getCacheSize()).toBe(0);
    });

    it("should clear all entries", () => {
      pdfCache.clearCache();
      expect(pdfCache.getCacheSize()).toBe(0);
    });

    it("should isolate caches between sessions", () => {
      // Create two independent cache instances
      const cache1 = createPdfCache();
      const cache2 = createPdfCache();

      // They should be independent (both start empty)
      expect(cache1.getCacheSize()).toBe(0);
      expect(cache2.getCacheSize()).toBe(0);
    });
  });

  describe("readPdfRange caching behavior", () => {
    const testUrl = "https://arxiv.org/pdf/test-pdf";
    const testData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF header

    it("should cache full body when server returns HTTP 200", async () => {
      // Mock fetch to return HTTP 200 (full body, no range support)
      const mockFetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(testData, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      );

      try {
        // First request - should fetch and cache
        const result1 = await pdfCache.readPdfRange(testUrl, 0, 1024);
        expect(result1.data).toEqual(testData);
        expect(result1.totalBytes).toBe(testData.length);
        expect(pdfCache.getCacheSize()).toBe(1);

        // Second request - should serve from cache (no new fetch)
        const result2 = await pdfCache.readPdfRange(testUrl, 0, 1024);
        expect(result2.data).toEqual(testData);
        expect(mockFetch).toHaveBeenCalledTimes(1); // Only one fetch call
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("should not cache when server returns HTTP 206 (range supported)", async () => {
      const chunkData = new Uint8Array([0x25, 0x50]); // First 2 bytes

      const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(chunkData, {
          status: 206,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Range": "bytes 0-1/100",
          },
        }),
      );

      try {
        await pdfCache.readPdfRange(testUrl, 0, 2);
        expect(pdfCache.getCacheSize()).toBe(0); // Not cached when 206
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("should slice cached data for subsequent range requests", async () => {
      const fullData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const mockFetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(fullData, { status: 200 }),
      );

      try {
        // First request caches full body
        await pdfCache.readPdfRange(testUrl, 0, 1024);
        expect(pdfCache.getCacheSize()).toBe(1);

        // Subsequent request gets slice from cache
        const result = await pdfCache.readPdfRange(testUrl, 2, 3);
        expect(result.data).toEqual(new Uint8Array([3, 4, 5]));
        expect(result.totalBytes).toBe(10);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("should fall back to GET when server returns 501 for Range request", async () => {
      const fullData = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

      const mockFetch = spyOn(globalThis, "fetch")
        // First call: Range request returns 501
        .mockResolvedValueOnce(
          new Response("Unsupported client Range", { status: 501 }),
        )
        // Second call: plain GET returns full body
        .mockResolvedValueOnce(
          new Response(fullData, {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
          }),
        );

      try {
        const result = await pdfCache.readPdfRange(testUrl, 0, 1024);
        expect(result.data).toEqual(fullData);
        expect(result.totalBytes).toBe(fullData.length);
        expect(pdfCache.getCacheSize()).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("should reject PDFs larger than max size limit", async () => {
      const hugeUrl = "https://arxiv.org/pdf/huge-pdf";
      // Create data larger than the limit
      const hugeData = new Uint8Array(CACHE_MAX_PDF_SIZE_BYTES + 1);

      const mockFetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(hugeData, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      );

      try {
        await expect(pdfCache.readPdfRange(hugeUrl, 0, 1024)).rejects.toThrow(
          /PDF too large to cache/,
        );
        expect(pdfCache.getCacheSize()).toBe(0); // Should not be cached
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("should reject when Content-Length header exceeds limit", async () => {
      const headerUrl = "https://arxiv.org/pdf/huge-pdf-header";
      const smallData = new Uint8Array([1, 2, 3, 4]);

      const mockFetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(smallData, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(CACHE_MAX_PDF_SIZE_BYTES + 1),
          },
        }),
      );

      try {
        await expect(pdfCache.readPdfRange(headerUrl, 0, 1024)).rejects.toThrow(
          /PDF too large to cache/,
        );
        expect(pdfCache.getCacheSize()).toBe(0);
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // Note: Timer-based tests (inactivity/max lifetime) would require
  // using fake timers which can be complex with async code.
  // The timeout behavior is straightforward and can be verified
  // through manual testing or E2E tests.
});

describe("validateUrl with MCP roots (allowedLocalDirs)", () => {
  const savedFiles = new Set(allowedLocalFiles);
  const savedDirs = new Set(allowedLocalDirs);

  beforeEach(() => {
    allowedLocalFiles.clear();
    allowedLocalDirs.clear();
  });

  afterEach(() => {
    allowedLocalFiles.clear();
    allowedLocalDirs.clear();
    for (const f of savedFiles) allowedLocalFiles.add(f);
    for (const d of savedDirs) allowedLocalDirs.add(d);
  });

  it("should allow a file under an allowed directory", () => {
    // Use a real existing directory+file for the existsSync check
    const dir = path.resolve(import.meta.dirname);
    allowedLocalDirs.add(dir);

    const filePath = path.join(dir, "server.ts");
    const result = validateUrl(pathToFileUrl(filePath));
    expect(result.valid).toBe(true);
  });

  it("should reject a file outside allowed directories", () => {
    allowedLocalDirs.add("/some/allowed/dir");

    const result = validateUrl("file:///other/dir/test.pdf");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not in allowed list");
  });

  it("should prevent prefix-based directory traversal", () => {
    // /tmp/safe should NOT allow /tmp/safevil/file.pdf
    allowedLocalDirs.add("/tmp/safe");

    const result = validateUrl("file:///tmp/safevil/file.pdf");
    expect(result.valid).toBe(false);
  });

  it("should still allow exact file matches from allowedLocalFiles", () => {
    const filePath = path.resolve(import.meta.dirname, "server.ts");
    allowedLocalFiles.add(filePath);

    const result = validateUrl(pathToFileUrl(filePath));
    expect(result.valid).toBe(true);
  });

  it("should reject non-existent file even if under allowed dir", () => {
    const dir = path.resolve(import.meta.dirname);
    allowedLocalDirs.add(dir);

    const result = validateUrl(
      pathToFileUrl(path.join(dir, "nonexistent-file.pdf")),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("File not found");
  });

  it("should allow a file under an allowed dir with trailing slash", () => {
    const dir = path.resolve(import.meta.dirname);
    // Simulate a dir stored with a trailing slash (e.g. from CLI path)
    allowedLocalDirs.add(dir + "/");

    const filePath = path.join(dir, "server.ts");
    const result = validateUrl(pathToFileUrl(filePath));
    expect(result.valid).toBe(true);
  });

  it("should allow a file under a grandparent allowed dir", () => {
    // Allow a directory two levels up from the file
    const grandparent = path.resolve(path.join(import.meta.dirname, ".."));
    allowedLocalDirs.add(grandparent);

    const filePath = path.join(import.meta.dirname, "server.ts");
    const result = validateUrl(pathToFileUrl(filePath));
    expect(result.valid).toBe(true);
  });

  it("should accept computer:// URLs as local files", () => {
    const dir = path.resolve(import.meta.dirname);
    allowedLocalDirs.add(dir);

    const filePath = path.join(dir, "server.ts");
    const encoded = encodeURIComponent(filePath).replace(/%2F/g, "/");
    const result = validateUrl(`computer://${encoded}`);
    expect(result.valid).toBe(true);
  });

  it("should accept bare absolute paths as local files", () => {
    const dir = path.resolve(import.meta.dirname);
    allowedLocalDirs.add(dir);

    const filePath = path.join(dir, "server.ts");
    const result = validateUrl(filePath);
    expect(result.valid).toBe(true);
  });

  it("should decode percent-encoded bare paths (e.g. %20 for spaces)", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf test "));
    const testFile = path.join(tmpDir, "file.txt");

    try {
      fs.writeFileSync(testFile, "hello");
      allowedLocalDirs.add(tmpDir);

      // Encode spaces as %20 in the path (as some clients do)
      const encoded = testFile.replace(/ /g, "%20");
      const result = validateUrl(encoded);
      expect(result.valid).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("should allow file accessed via symlink when real dir is allowed", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-test-"));
    const realDir = path.join(tmpDir, "real");
    const linkDir = path.join(tmpDir, "link");
    const testFile = path.join(realDir, "test.txt");

    try {
      fs.mkdirSync(realDir);
      fs.writeFileSync(testFile, "hello");
      fs.symlinkSync(realDir, linkDir);

      // Allow the REAL directory
      allowedLocalDirs.add(realDir);

      // Access via the SYMLINK path — should still be allowed
      const symlinkPath = path.join(linkDir, "test.txt");
      const result = validateUrl(symlinkPath);
      expect(result.valid).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("should allow file when allowed dir is a symlink to real parent", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-test-"));
    const realDir = path.join(tmpDir, "real");
    const linkDir = path.join(tmpDir, "link");
    const testFile = path.join(realDir, "test.txt");

    try {
      fs.mkdirSync(realDir);
      fs.writeFileSync(testFile, "hello");
      fs.symlinkSync(realDir, linkDir);

      // Allow the SYMLINK directory
      allowedLocalDirs.add(linkDir);

      // Access via the REAL path — should still be allowed
      const result = validateUrl(testFile);
      expect(result.valid).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("isAncestorDir", () => {
  it("should return true for a direct child", () => {
    expect(isAncestorDir("/Users/test/dir", "/Users/test/dir/file.pdf")).toBe(
      true,
    );
  });

  it("should return true for a nested child", () => {
    expect(isAncestorDir("/Users/test", "/Users/test/sub/dir/file.pdf")).toBe(
      true,
    );
  });

  it("should return false for a file outside the dir", () => {
    expect(isAncestorDir("/Users/test/dir", "/Users/test/other/file.pdf")).toBe(
      false,
    );
  });

  it("should return false for the dir itself", () => {
    expect(isAncestorDir("/Users/test/dir", "/Users/test/dir")).toBe(false);
  });

  it("should prevent .. traversal", () => {
    expect(
      isAncestorDir("/Users/test/dir", "/Users/test/dir/../other/file.pdf"),
    ).toBe(false);
  });

  it("should prevent prefix-based traversal", () => {
    // /tmp/safe should NOT match /tmp/safevil/file.pdf
    expect(isAncestorDir("/tmp/safe", "/tmp/safevil/file.pdf")).toBe(false);
  });

  it("should handle dirs with trailing slash", () => {
    expect(isAncestorDir("/Users/test/dir/", "/Users/test/dir/file.pdf")).toBe(
      true,
    );
  });
});

describe("createServer useClientRoots option", () => {
  it("should not set up roots handlers by default", () => {
    const server = createServer();
    // When useClientRoots is false (default), oninitialized should NOT
    // be overridden by our roots logic.
    expect(server.server.oninitialized).toBeUndefined();
    server.close();
  });

  it("should not set up roots handlers when useClientRoots is false", () => {
    const server = createServer({ useClientRoots: false });
    expect(server.server.oninitialized).toBeUndefined();
    server.close();
  });

  it("should set up roots handlers when useClientRoots is true", () => {
    const server = createServer({ useClientRoots: true });
    // When useClientRoots is true, oninitialized should be set to
    // the roots refresh handler.
    expect(server.server.oninitialized).toBeFunction();
    server.close();
  });
});

describe("isWritablePath", () => {
  let savedFiles: Set<string>;
  let savedDirs: Set<string>;
  let savedCli: Set<string>;
  let savedAllowUploadsRoot: boolean;

  beforeEach(() => {
    savedFiles = new Set(allowedLocalFiles);
    savedDirs = new Set(allowedLocalDirs);
    savedCli = new Set(cliLocalFiles);
    allowedLocalFiles.clear();
    allowedLocalDirs.clear();
    cliLocalFiles.clear();
    savedAllowUploadsRoot = writeFlags.allowUploadsRoot;
    writeFlags.allowUploadsRoot = false;
  });

  afterEach(() => {
    allowedLocalFiles.clear();
    allowedLocalDirs.clear();
    cliLocalFiles.clear();
    for (const x of savedFiles) allowedLocalFiles.add(x);
    for (const x of savedDirs) allowedLocalDirs.add(x);
    for (const x of savedCli) cliLocalFiles.add(x);
    writeFlags.allowUploadsRoot = savedAllowUploadsRoot;
  });

  it("nothing is writable when no roots and no CLI files", () => {
    expect(isWritablePath("/any/path/file.pdf")).toBe(false);
  });

  it("CLI file is writable", () => {
    allowedLocalFiles.add("/tmp/explicit.pdf");
    cliLocalFiles.add("/tmp/explicit.pdf");
    expect(isWritablePath("/tmp/explicit.pdf")).toBe(true);
  });

  it("MCP file root is NOT writable", () => {
    allowedLocalFiles.add("/tmp/uploaded.pdf"); // from refreshRoots, no CLI
    expect(isWritablePath("/tmp/uploaded.pdf")).toBe(false);
  });

  it("file under a directory root at any depth is writable", () => {
    allowedLocalDirs.add("/home/user/docs");
    expect(isWritablePath("/home/user/docs/file.pdf")).toBe(true);
    expect(isWritablePath("/home/user/docs/sub/deep/file.pdf")).toBe(true);
  });

  it("the directory root itself is NOT writable", () => {
    allowedLocalDirs.add("/home/user/docs");
    expect(isWritablePath("/home/user/docs")).toBe(false);
  });

  it("MCP file root stays read-only even when under a directory root", () => {
    // Client sent BOTH the directory and a file inside it as roots.
    // The explicit file-root is the stronger signal: treat as upload.
    allowedLocalDirs.add("/home/user/docs");
    allowedLocalFiles.add("/home/user/docs/uploaded.pdf");
    expect(isWritablePath("/home/user/docs/uploaded.pdf")).toBe(false);
    // Siblings not sent as file roots remain writable
    expect(isWritablePath("/home/user/docs/other.pdf")).toBe(true);
  });

  it("CLI file wins even if also in allowedLocalFiles", () => {
    // CLI file added to both sets (main.ts does this)
    allowedLocalFiles.add("/tmp/cli.pdf");
    cliLocalFiles.add("/tmp/cli.pdf");
    expect(isWritablePath("/tmp/cli.pdf")).toBe(true);
  });

  it("file outside any directory root is not writable", () => {
    allowedLocalDirs.add("/home/user/docs");
    expect(isWritablePath("/home/user/other/file.pdf")).toBe(false);
    expect(isWritablePath("/home/user/docsevil/file.pdf")).toBe(false);
  });

  it("dir root named 'uploads' is read-only by default", () => {
    // Claude Desktop mounts the conversation's attachment drop folder as a
    // directory root literally named 'uploads'. The attached PDF lives
    // directly under it.
    allowedLocalDirs.add("/var/folders/xy/T/claude/uploads");
    expect(isWritablePath("/var/folders/xy/T/claude/uploads/Form.pdf")).toBe(
      false,
    );
    // Deep nesting under the uploads root — still the same root, still no.
    expect(
      isWritablePath("/var/folders/xy/T/claude/uploads/sub/deep.pdf"),
    ).toBe(false);
  });

  it("uploads-root guard matches basename, not substring", () => {
    allowedLocalDirs.add("/home/user/my-uploads"); // contains 'uploads' but ≠
    allowedLocalDirs.add("/home/user/uploads-archive");
    expect(isWritablePath("/home/user/my-uploads/f.pdf")).toBe(true);
    expect(isWritablePath("/home/user/uploads-archive/f.pdf")).toBe(true);
  });

  it("--writeable-uploads-root opts back in", () => {
    allowedLocalDirs.add("/var/folders/xy/T/claude/uploads");
    writeFlags.allowUploadsRoot = true;
    expect(isWritablePath("/var/folders/xy/T/claude/uploads/Form.pdf")).toBe(
      true,
    );
  });

  it("CLI file under an uploads root is still writable", () => {
    // Explicit CLI intent beats the uploads-basename heuristic.
    allowedLocalDirs.add("/tmp/uploads");
    allowedLocalFiles.add("/tmp/uploads/explicit.pdf");
    cliLocalFiles.add("/tmp/uploads/explicit.pdf");
    expect(isWritablePath("/tmp/uploads/explicit.pdf")).toBe(true);
  });
});

describe("file watching", () => {
  let tmpDir: string;
  let tmpFile: string;
  const uuid = "test-watch-uuid";

  // Long-poll timeout is 30s — tests that poll must complete sooner.
  const pollWithTimeout = async (
    client: Client,
    timeoutMs = 5000,
  ): Promise<{ type: string; mtimeMs?: number }[]> => {
    const result = await Promise.race([
      client.callTool({
        name: "poll_pdf_commands",
        arguments: { viewUUID: uuid },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("poll timeout")), timeoutMs),
      ),
    ]);
    return (
      ((result as { structuredContent?: { commands?: unknown[] } })
        .structuredContent?.commands as { type: string; mtimeMs?: number }[]) ??
      []
    );
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-watch-"));
    tmpFile = path.join(tmpDir, "test.pdf");
    fs.writeFileSync(tmpFile, Buffer.from("%PDF-1.4\n%test\n"));
    allowedLocalFiles.add(tmpFile);
    cliLocalFiles.add(tmpFile); // save_pdf test needs write scope
  });

  afterEach(() => {
    stopFileWatch(uuid);
    allowedLocalFiles.delete(tmpFile);
    cliLocalFiles.delete(tmpFile);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enqueues file_changed after external write", async () => {
    const server = createServer({ enableInteract: true });
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    startFileWatch(uuid, tmpFile);
    await new Promise((r) => setTimeout(r, 50)); // let watcher settle

    fs.writeFileSync(tmpFile, Buffer.from("%PDF-1.4\n%changed\n"));

    const cmds = await pollWithTimeout(client);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("file_changed");
    expect(cmds[0].mtimeMs).toBeGreaterThan(0);

    await client.close();
    await server.close();
  });

  it("debounces rapid writes into one command", async () => {
    const server = createServer({ enableInteract: true });
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    startFileWatch(uuid, tmpFile);
    await new Promise((r) => setTimeout(r, 50));

    fs.writeFileSync(tmpFile, Buffer.from("%PDF-1.4\n%a\n"));
    fs.writeFileSync(tmpFile, Buffer.from("%PDF-1.4\n%b\n"));
    fs.writeFileSync(tmpFile, Buffer.from("%PDF-1.4\n%c\n"));

    const cmds = await pollWithTimeout(client);
    expect(cmds).toHaveLength(1);

    await client.close();
    await server.close();
  });

  it("stopFileWatch prevents further commands", async () => {
    const server = createServer({ enableInteract: true });
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    startFileWatch(uuid, tmpFile);
    await new Promise((r) => setTimeout(r, 50));
    stopFileWatch(uuid);

    fs.writeFileSync(tmpFile, Buffer.from("%PDF-1.4\n%x\n"));

    // Debounce window + margin — no event should fire
    await new Promise((r) => setTimeout(r, 300));

    // Poll should block (long-poll) → timeout here means no command was queued
    await expect(pollWithTimeout(client, 500)).rejects.toThrow("poll timeout");

    await client.close();
    await server.close();
  });

  it("save_pdf returns mtimeMs in structuredContent", async () => {
    const server = createServer({ enableInteract: true });
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const before = fs.statSync(tmpFile).mtimeMs;
    // Ensure mtime will differ on coarse-granularity filesystems
    await new Promise((r) => setTimeout(r, 10));

    const r = await client.callTool({
      name: "save_pdf",
      arguments: {
        url: tmpFile,
        data: Buffer.from("%PDF-1.4\nnew").toString("base64"),
      },
    });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { filePath: string; mtimeMs: number };
    expect(sc.filePath).toBe(tmpFile);
    expect(sc.mtimeMs).toBeGreaterThanOrEqual(before);

    await client.close();
    await server.close();
  });

  it("save_pdf refuses file roots from MCP client (not CLI)", async () => {
    // Simulate: file is readable (in allowedLocalFiles via refreshRoots)
    // but NOT in cliLocalFiles — it came from the client, not a CLI arg.
    cliLocalFiles.delete(tmpFile);

    const server = createServer({ enableInteract: true });
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const original = fs.readFileSync(tmpFile);
    const r = await client.callTool({
      name: "save_pdf",
      arguments: {
        url: tmpFile,
        data: Buffer.from("%PDF-1.4\nshould-not-write").toString("base64"),
      },
    });
    expect(r.isError).toBe(true);
    const text = (r.content as { text: string }[])[0].text;
    expect(text).toContain("read-only");
    // Verify the file was NOT modified
    expect(fs.readFileSync(tmpFile)).toEqual(original);

    await client.close();
    await server.close();
  });

  it("save_pdf allows files under a directory root", async () => {
    // File is under a mounted directory root — but NOT itself a file root
    // (a file root, even under a mounted dir, is read-only per isWritablePath).
    cliLocalFiles.delete(tmpFile);
    allowedLocalFiles.delete(tmpFile);
    allowedLocalDirs.add(tmpDir);

    const server = createServer({ enableInteract: true });
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const r = await client.callTool({
      name: "save_pdf",
      arguments: {
        url: tmpFile,
        data: Buffer.from("%PDF-1.4\nvia-dir-root").toString("base64"),
      },
    });
    expect(r.isError).toBeFalsy();
    expect(fs.readFileSync(tmpFile, "utf8")).toBe("%PDF-1.4\nvia-dir-root");

    allowedLocalDirs.delete(tmpDir);
    await client.close();
    await server.close();
  });

  // fs.watch on a file that gets replaced via rename: on macOS (kqueue)
  // the watcher reliably fires a "rename" event which our re-attach logic
  // handles. On Linux (inotify), a watcher on the old inode often gets no
  // event at all — inotify watches inodes, and the rename just atomically
  // swaps the directory entry to a NEW inode. Directory-level watching
  // would fix this but isn't what we do. Skip on non-darwin.
  it.skipIf(process.platform !== "darwin")(
    "detects atomic rename (macOS kqueue only)",
    async () => {
      const server = createServer({ enableInteract: true });
      const client = new Client({ name: "t", version: "1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(st), client.connect(ct)]);

      startFileWatch(uuid, tmpFile);
      await new Promise((r) => setTimeout(r, 50));

      // Simulate vim/vscode: write to temp, rename over original
      const tmpWrite = tmpFile + ".swp";
      fs.writeFileSync(tmpWrite, Buffer.from("%PDF-1.4\n%atomic\n"));
      fs.renameSync(tmpWrite, tmpFile);

      const cmds = await pollWithTimeout(client);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].type).toBe("file_changed");

      await client.close();
      await server.close();
    },
  );
});

describe("interact tool", () => {
  // Helper: connected server+client pair with interact enabled.
  // Command queues are MODULE-LEVEL (shared across server instances), so each
  // test uses a distinct viewUUID to avoid cross-test interference.
  async function connect() {
    const server = createServer({ enableInteract: true });
    const client = new Client({ name: "t", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    return { server, client };
  }

  // Helper: poll with an outer deadline so a failing test doesn't hang for the
  // full 30s long-poll. Safe ONLY when a command is already enqueued — poll
  // then returns after the 200ms batch window.
  async function poll(client: Client, uuid: string, timeoutMs = 2000) {
    const result = await Promise.race([
      client.callTool({
        name: "poll_pdf_commands",
        arguments: { viewUUID: uuid },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("poll timeout")), timeoutMs),
      ),
    ]);
    return ((result as { structuredContent?: { commands?: unknown[] } })
      .structuredContent?.commands ?? []) as Array<Record<string, unknown>>;
  }

  function firstText(r: Awaited<ReturnType<Client["callTool"]>>): string {
    return (r.content as Array<{ type: string; text: string }>)[0].text;
  }

  it("enqueue → poll roundtrip delivers the command", async () => {
    const { server, client } = await connect();
    const uuid = "test-interact-roundtrip";

    const r = await client.callTool({
      name: "interact",
      arguments: { viewUUID: uuid, action: "navigate", page: 5 },
    });
    expect(r.isError).toBeFalsy();
    expect(firstText(r)).toContain("Queued");
    expect(firstText(r)).toContain("page 5");

    // Core mechanism: the viewer polls for what the model enqueued.
    const cmds = await poll(client, uuid);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("navigate");
    expect(cmds[0].page).toBe(5);

    await client.close();
    await server.close();
  });

  it("navigate without `page` returns isError with a helpful message", async () => {
    const { server, client } = await connect();

    const r = await client.callTool({
      name: "interact",
      arguments: { viewUUID: "test-err-nav", action: "navigate" },
    });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toContain("navigate");
    expect(firstText(r)).toContain("page");

    await client.close();
    await server.close();
  });

  it("fill_form without `fields` returns isError with a helpful message", async () => {
    const { server, client } = await connect();

    const r = await client.callTool({
      name: "interact",
      arguments: { viewUUID: "test-err-fill", action: "fill_form" },
    });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toContain("fill_form");
    expect(firstText(r)).toContain("fields");

    await client.close();
    await server.close();
  });

  it("add_annotations without `annotations` returns isError with a helpful message", async () => {
    const { server, client } = await connect();

    const r = await client.callTool({
      name: "interact",
      arguments: { viewUUID: "test-err-ann", action: "add_annotations" },
    });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toContain("add_annotations");
    expect(firstText(r)).toContain("annotations");

    await client.close();
    await server.close();
  });

  it("isolates command queues across distinct viewUUIDs", async () => {
    const { server, client } = await connect();
    const uuidA = "test-isolate-A";
    const uuidB = "test-isolate-B";

    await client.callTool({
      name: "interact",
      arguments: { viewUUID: uuidA, action: "navigate", page: 3 },
    });
    await client.callTool({
      name: "interact",
      arguments: { viewUUID: uuidB, action: "search", query: "quantum" },
    });

    const cmdsA = await poll(client, uuidA);
    expect(cmdsA).toHaveLength(1);
    expect(cmdsA[0].type).toBe("navigate");
    expect(cmdsA[0].page).toBe(3);

    const cmdsB = await poll(client, uuidB);
    expect(cmdsB).toHaveLength(1);
    expect(cmdsB[0].type).toBe("search");
    expect(cmdsB[0].query).toBe("quantum");

    await client.close();
    await server.close();
  });

  // SKIPPED: the unknown-UUID path enters the long-poll branch and blocks for
  // the full LONG_POLL_TIMEOUT_MS (30s, module-local const, not configurable).
  // The handler does dequeue [] at the end, so the return value IS
  // {commands: []} — but there's no fast path to reach it without waiting.
  // See the `stopFileWatch prevents further commands` test above for indirect
  // coverage of the same blocking behaviour.
  it.skip("poll with unknown viewUUID returns {commands: []} after long-poll", () => {});

  it("fill_form passes all fields through when viewFieldNames is not registered", async () => {
    const { server, client } = await connect();
    // Fresh UUID never seen by display_pdf → viewFieldNames.get(uuid) is
    // undefined → the known-fields guard (`knownFields && !knownFields.has()`)
    // is falsy for every field → everything is enqueued.
    const uuid = "test-fillform-passthrough";

    const r = await client.callTool({
      name: "interact",
      arguments: {
        viewUUID: uuid,
        action: "fill_form",
        fields: [
          { name: "anything", value: "goes" },
          { name: "unchecked", value: true },
        ],
      },
    });
    expect(r.isError).toBeFalsy();
    expect(firstText(r)).toContain("Filled 2 field(s)");
    // No rejection complaint — the registry has no entry for this UUID
    expect(firstText(r)).not.toContain("Unknown");

    const cmds = await poll(client, uuid);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("fill_form");
    const fields = cmds[0].fields as Array<{ name: string; value: unknown }>;
    expect(fields).toHaveLength(2);
    expect(fields.map((f) => f.name).sort()).toEqual(["anything", "unchecked"]);

    // Note: the "registered → reject unknown" branch needs viewFieldNames
    // populated, which only happens inside display_pdf (requires a real PDF).
    // That map isn't exported, so the rejection path is covered by e2e only.

    await client.close();
    await server.close();
  });

  // SECURITY: resolveImageAnnotation must not read arbitrary local files.
  // The model controls imageUrl; without validation it's an exfil primitive
  // (readFile → base64 → iframe → get_screenshot reads it back).
  describe("add_annotations image: imageUrl validation", () => {
    let savedDirs: Set<string>;
    beforeEach(() => {
      savedDirs = new Set(allowedLocalDirs);
      allowedLocalDirs.clear();
    });
    afterEach(() => {
      allowedLocalDirs.clear();
      for (const d of savedDirs) allowedLocalDirs.add(d);
    });

    it("rejects local path outside allowed roots", async () => {
      const { server, client } = await connect();
      // Whitelist a harmless temp dir; target a path clearly outside it.
      allowedLocalDirs.add(os.tmpdir());
      const target = path.join(os.homedir(), ".ssh", "id_rsa");
      const r = await client.callTool({
        name: "interact",
        arguments: {
          viewUUID: "sec-local",
          action: "add_annotations",
          annotations: [{ type: "image", id: "i1", page: 1, imageUrl: target }],
        },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("imageUrl rejected");
      await client.close();
      await server.close();
    });

    it("rejects http:// URL (SSRF)", async () => {
      const { server, client } = await connect();
      const r = await client.callTool({
        name: "interact",
        arguments: {
          viewUUID: "sec-http",
          action: "add_annotations",
          annotations: [
            {
              type: "image",
              id: "i1",
              page: 1,
              imageUrl: "http://169.254.169.254/latest/meta-data/",
            },
          ],
        },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("imageUrl rejected");
      await client.close();
      await server.close();
    });

    it("accepts path under an allowed dir (reaches readFile)", async () => {
      const { server, client } = await connect();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-imgurl-"));
      allowedLocalDirs.add(dir);
      // Minimal valid PNG (1x1 transparent): 8-byte sig + IHDR + IDAT + IEND.
      const png = Buffer.from(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6360000000000200015E9AFE400000000049454E44AE426082",
        "hex",
      );
      const imgPath = path.join(dir, "sig.png");
      fs.writeFileSync(imgPath, png);
      try {
        const r = await client.callTool({
          name: "interact",
          arguments: {
            viewUUID: "sec-ok",
            action: "add_annotations",
            annotations: [
              { type: "image", id: "i1", page: 1, imageUrl: imgPath },
            ],
          },
        });
        // No security rejection; readFile succeeds; command enqueued.
        expect(r.isError).toBeFalsy();
        const cmds = await poll(client, "sec-ok");
        expect(cmds).toHaveLength(1);
        expect(cmds[0].type).toBe("add_annotations");
        const anns = cmds[0].annotations as Array<Record<string, unknown>>;
        // validateUrl passed → readFile ran → imageData populated.
        expect(typeof anns[0].imageData).toBe("string");
        expect((anns[0].imageData as string).length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      await client.close();
      await server.close();
    });
  });

  describe("save_as", () => {
    // Roundtrip tests need: writable scope, kick off interact WITHOUT awaiting
    // (it blocks until the view replies), poll → submit → await. The poll()
    // call also registers the uuid in viewsPolled, satisfying
    // ensureViewerIsPolling — without it interact would hang ~8s and fail.

    let tmpDir: string;
    let savedDirs: Set<string>;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-saveas-"));
      savedDirs = new Set(allowedLocalDirs);
      allowedLocalDirs.add(tmpDir); // make tmpDir a directory root → writable
    });

    afterEach(() => {
      allowedLocalDirs.clear();
      for (const x of savedDirs) allowedLocalDirs.add(x);
      viewSourcePaths.clear();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("no path, no source tracked → tells model to provide a path", async () => {
      // Fresh UUID never seen by display_pdf → viewSourcePaths has no entry.
      // Same condition as a remote (https://) PDF or a stale viewUUID.
      const { server, client } = await connect();
      const r = await client.callTool({
        name: "interact",
        arguments: { viewUUID: "saveas-nosource", action: "save_as" },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("no local source file");
      expect(firstText(r)).toContain("Provide an explicit `path`");
      await client.close();
      await server.close();
    });

    it("no path, source tracked, overwrite omitted → asks for confirmation", async () => {
      const { server, client } = await connect();
      const source = path.join(tmpDir, "original.pdf");
      fs.writeFileSync(source, "%PDF-1.4\noriginal");
      viewSourcePaths.set("saveas-noconfirm", source);

      const r = await client.callTool({
        name: "interact",
        arguments: { viewUUID: "saveas-noconfirm", action: "save_as" },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("overwrites the original");
      expect(firstText(r)).toContain(source);
      expect(firstText(r)).toContain("overwrite: true");
      // Nothing enqueued, file untouched
      expect(fs.readFileSync(source, "utf8")).toBe("%PDF-1.4\noriginal");
      await client.close();
      await server.close();
    });

    it("no path, source not writable → same gate as save button", async () => {
      const { server, client } = await connect();
      // Source outside any directory root → isWritablePath false → save button
      // would be hidden in the viewer. save_as should refuse for the same reason.
      const outside = path.join(os.tmpdir(), "saveas-outside.pdf");
      fs.writeFileSync(outside, "x");
      viewSourcePaths.set("saveas-buttongate", outside);

      try {
        const r = await client.callTool({
          name: "interact",
          arguments: {
            viewUUID: "saveas-buttongate",
            action: "save_as",
            overwrite: true,
          },
        });
        expect(r.isError).toBe(true);
        expect(firstText(r)).toContain("not writable");
        expect(firstText(r)).toContain("save button is hidden");
      } finally {
        fs.rmSync(outside, { force: true });
      }
      await client.close();
      await server.close();
    });

    it("no path, overwrite: true → roundtrip overwrites the original", async () => {
      const { server, client } = await connect();
      const uuid = "saveas-original";
      const source = path.join(tmpDir, "report.pdf");
      fs.writeFileSync(source, "%PDF-1.4\noriginal contents");
      viewSourcePaths.set(uuid, source);

      const interactPromise = client.callTool({
        name: "interact",
        arguments: { viewUUID: uuid, action: "save_as", overwrite: true },
      });

      const cmds = await poll(client, uuid);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].type).toBe("save_as");
      await client.callTool({
        name: "submit_save_data",
        arguments: {
          requestId: cmds[0].requestId as string,
          data: Buffer.from("%PDF-1.4\nannotated").toString("base64"),
        },
      });

      const r = await interactPromise;
      expect(r.isError).toBeFalsy();
      expect(firstText(r)).toContain(source);
      expect(fs.readFileSync(source, "utf8")).toBe("%PDF-1.4\nannotated");

      await client.close();
      await server.close();
    });

    it("rejects non-absolute path", async () => {
      const { server, client } = await connect();
      const r = await client.callTool({
        name: "interact",
        arguments: {
          viewUUID: "saveas-rel",
          action: "save_as",
          path: "relative.pdf",
        },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("absolute");
      await client.close();
      await server.close();
    });

    it("rejects non-writable path", async () => {
      const { server, client } = await connect();
      // Path outside any directory root → not writable. Validation is sync,
      // so nothing is enqueued and the queue stays empty.
      const r = await client.callTool({
        name: "interact",
        arguments: {
          viewUUID: "saveas-nowrite",
          action: "save_as",
          path: "/somewhere/else/out.pdf",
        },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("not under a mounted directory root");
      await client.close();
      await server.close();
    });

    it("rejects existing file when overwrite is false (default)", async () => {
      const { server, client } = await connect();
      const target = path.join(tmpDir, "exists.pdf");
      fs.writeFileSync(target, "old contents");

      const r = await client.callTool({
        name: "interact",
        arguments: {
          viewUUID: "saveas-exists",
          action: "save_as",
          path: target,
        },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("already exists");
      expect(firstText(r)).toContain("overwrite: true");
      // Existence check is sync — nothing enqueued, file untouched.
      expect(fs.readFileSync(target, "utf8")).toBe("old contents");
      await client.close();
      await server.close();
    });

    it("full roundtrip: enqueue → poll → submit → file written", async () => {
      const { server, client } = await connect();
      const uuid = "saveas-roundtrip";
      const target = path.join(tmpDir, "out.pdf");
      const pdfBytes = "%PDF-1.4\nfake-annotated-contents\n%%EOF";

      // interact blocks in waitForSaveData until submit_save_data resolves it
      const interactPromise = client.callTool({
        name: "interact",
        arguments: { viewUUID: uuid, action: "save_as", path: target },
      });

      // Viewer polls → receives the save_as command with a requestId
      const cmds = await poll(client, uuid);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].type).toBe("save_as");
      const requestId = cmds[0].requestId as string;
      expect(typeof requestId).toBe("string");

      // Viewer submits bytes
      const submit = await client.callTool({
        name: "submit_save_data",
        arguments: {
          requestId,
          data: Buffer.from(pdfBytes).toString("base64"),
        },
      });
      expect(submit.isError).toBeFalsy();

      // interact now unblocks with success
      const r = await interactPromise;
      expect(r.isError).toBeFalsy();
      expect(firstText(r)).toContain("Saved");
      expect(firstText(r)).toContain(target);
      expect(fs.readFileSync(target, "utf8")).toBe(pdfBytes);

      await client.close();
      await server.close();
    });

    it("overwrite: true replaces an existing file", async () => {
      const { server, client } = await connect();
      const uuid = "saveas-overwrite";
      const target = path.join(tmpDir, "replace.pdf");
      fs.writeFileSync(target, "old contents");

      const interactPromise = client.callTool({
        name: "interact",
        arguments: {
          viewUUID: uuid,
          action: "save_as",
          path: target,
          overwrite: true,
        },
      });

      const cmds = await poll(client, uuid);
      const requestId = cmds[0].requestId as string;
      await client.callTool({
        name: "submit_save_data",
        arguments: {
          requestId,
          data: Buffer.from("%PDF-1.4\nnew").toString("base64"),
        },
      });

      const r = await interactPromise;
      expect(r.isError).toBeFalsy();
      expect(fs.readFileSync(target, "utf8")).toBe("%PDF-1.4\nnew");

      await client.close();
      await server.close();
    });

    it("propagates viewer-reported errors to the model", async () => {
      const { server, client } = await connect();
      const uuid = "saveas-viewerr";
      const target = path.join(tmpDir, "wontwrite.pdf");

      const interactPromise = client.callTool({
        name: "interact",
        arguments: { viewUUID: uuid, action: "save_as", path: target },
      });

      const cmds = await poll(client, uuid);
      // Viewer hit an error building bytes → reports it instead of timing out
      await client.callTool({
        name: "submit_save_data",
        arguments: {
          requestId: cmds[0].requestId as string,
          error: "pdf-lib choked on a comb field",
        },
      });

      const r = await interactPromise;
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("pdf-lib choked on a comb field");
      expect(fs.existsSync(target)).toBe(false);

      await client.close();
      await server.close();
    });

    it("submit_save_data with unknown requestId returns isError", async () => {
      const { server, client } = await connect();
      const r = await client.callTool({
        name: "submit_save_data",
        arguments: { requestId: "never-created", data: "AAAA" },
      });
      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("No pending request");
      await client.close();
      await server.close();
    });
  });

  describe("viewer liveness", () => {
    // get_screenshot/get_text fail fast when the iframe never polled, instead
    // of waiting 45s for a viewer that isn't there. Reproduces the case where
    // the host goes idle before the iframe reaches startPolling().

    it("get_screenshot fails fast when viewer never polled", async () => {
      const { server, client } = await connect();
      const uuid = "never-polled-screenshot";

      const started = Date.now();
      const r = await client.callTool({
        name: "interact",
        arguments: { viewUUID: uuid, action: "get_screenshot", page: 1 },
      });
      const elapsed = Date.now() - started;

      expect(r.isError).toBe(true);
      expect(firstText(r)).toContain("never connected");
      expect(firstText(r)).toContain(uuid);
      expect(firstText(r)).toContain("display_pdf again"); // recovery hint
      // Fast-fail bound (~8s grace), well under the 45s page-data timeout.
      // 15s upper bound leaves slack for CI scheduling.
      expect(elapsed).toBeLessThan(15_000);

      await client.close();
      await server.close();
    }, 20_000);

    it("get_screenshot waits full timeout when viewer polled then went silent", async () => {
      // Viewer polled once (proving it mounted) then hung on a heavy render.
      // The grace check passes, so we fall through to the 45s page-data wait —
      // verified here by racing against a 12s deadline that should NOT win.
      const { server, client } = await connect();
      const uuid = "polled-then-silent";

      // Viewer's first poll: drain whatever's there so it returns fast.
      // Enqueue a trivial command first so poll returns via the batch-wait
      // path (~200ms) instead of blocking on the 30s long-poll.
      await client.callTool({
        name: "interact",
        arguments: { viewUUID: uuid, action: "navigate", page: 1 },
      });
      await poll(client, uuid);

      // Now get_screenshot — viewer has polled, so no fast-fail. But viewer
      // never calls submit_page_data → should wait beyond the grace period.
      const outcome = await Promise.race([
        client
          .callTool({
            name: "interact",
            arguments: { viewUUID: uuid, action: "get_screenshot", page: 1 },
          })
          .then(() => "completed" as const),
        new Promise<"still-waiting">((r) =>
          setTimeout(() => r("still-waiting"), 12_000),
        ),
      ]);

      expect(outcome).toBe("still-waiting");

      await client.close();
      await server.close();
    }, 20_000);

    it("get_screenshot succeeds when viewer polls during grace window", async () => {
      // Model calls interact before the viewer has polled — but the viewer
      // shows up within the grace period and completes the roundtrip.
      const { server, client } = await connect();
      const uuid = "late-arriving-viewer";

      const interactPromise = client.callTool({
        name: "interact",
        arguments: { viewUUID: uuid, action: "get_screenshot", page: 1 },
      });

      // Viewer connects 500ms late — well inside the grace window.
      await new Promise((r) => setTimeout(r, 500));
      const cmds = await poll(client, uuid);
      const getPages = cmds.find((c) => c.type === "get_pages");
      expect(getPages).toBeDefined();

      // Viewer responds with the page data.
      await client.callTool({
        name: "submit_page_data",
        arguments: {
          requestId: getPages!.requestId as string,
          pages: [
            { page: 1, image: Buffer.from("fake-jpeg").toString("base64") },
          ],
        },
      });

      const r = await interactPromise;
      expect(r.isError).toBeFalsy();
      expect((r.content as Array<{ type: string }>)[0].type).toBe("image");

      await client.close();
      await server.close();
    }, 15_000);

    it("batch step failure: 1:1 content, no isError, ERROR-prefixed slot", async () => {
      // LocalAgentMode SDK 2.1.87 collapses isError:true results to a bare
      // string of content[0].text — drops images from earlier successful
      // steps. So we don't set isError on a step failure: each command gets
      // one content slot, the failed one starts with "ERROR", and the batch
      // stops there. content.length tells the model how far it got.
      const { server, client } = await connect();
      const uuid = "batch-error-ordering";

      const r = await client.callTool({
        name: "interact",
        arguments: {
          viewUUID: uuid,
          commands: [
            { action: "navigate", page: 3 }, // succeeds → "Queued: ..."
            { action: "get_screenshot", page: 1 }, // never-polled → fast-fail
            { action: "navigate", page: 5 }, // never reached
          ],
        },
      });

      // Not isError — that would trigger the SDK flatten
      expect(r.isError).toBeFalsy();
      const content = r.content as Array<{ type: string; text?: string }>;
      // Stopped at step 2; step 3 never ran
      expect(content).toHaveLength(2);
      // Slot 0: step 1's success, untouched
      expect(content[0].text).toContain("Queued");
      expect(content[0].text).not.toMatch(/^ERROR/);
      // Slot 1: step 2's failure, ERROR-prefixed with the actual message
      expect(content[1].text).toMatch(/^ERROR/);
      expect(content[1].text).toContain("2/3");
      expect(content[1].text).toContain("get_screenshot");
      expect(content[1].text).toContain("never connected");

      await client.close();
      await server.close();
    }, 15_000);
  });
});
