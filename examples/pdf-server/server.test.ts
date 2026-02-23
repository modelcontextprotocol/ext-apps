import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import path from "node:path";
import {
  createPdfCache,
  validateUrl,
  allowedLocalFiles,
  allowedLocalDirs,
  pathToFileUrl,
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
});
