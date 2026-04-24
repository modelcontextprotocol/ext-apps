/**
 * HTTPS test fixture serving programmatically-generated PDFs with byte-range
 * accounting. Used by pdf-incremental-load.spec.ts to assert that display_pdf
 * doesn't pull the whole file before the viewer starts streaming.
 */
import https from "node:https";
import { execFileSync } from "node:child_process";
import fs, { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface RangeRequest {
  path: string;
  begin: number;
  end: number; // exclusive
  bytes: number;
}

export interface RangeServerStats {
  requests: RangeRequest[];
  /** Total bytes written across all responses (sum of slice lengths). */
  totalBytesServed: number;
  /** Bytes that were served more than once for the same path. */
  overlapBytes: number;
}

export interface RangeServer {
  port: number;
  baseUrl: string;
  /** Map of served path → byte length. */
  fileSizes: Record<string, number>;
  stats(): RangeServerStats;
  resetStats(): void;
  /** Resolve any requests currently stalled by ?stallAfter=N. */
  release(): void;
  close(): Promise<void>;
}

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
  "commodo consequat. ";

async function buildNoFormsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Page 1 is text-only (small) so first paint needs minimal bytes. Pages 2+
  // each reference a large embedded JPEG so the bulk of the file is in image
  // streams page 1 doesn't need. The stallAfterBytes test holds those back
  // and asserts page 1 still renders.
  const big = await doc.embedJpg(makeRandomJpeg(500 * 1024));
  const page1 = doc.addPage([612, 792]);
  for (let line = 0; line < 30; line++) {
    page1.drawText(`1.${line + 1} ${LOREM}`, {
      x: 36,
      y: 760 - line * 22,
      size: 10,
      font,
    });
  }
  for (let p = 1; p < 20; p++) {
    const page = doc.addPage([612, 792]);
    page.drawImage(big, { x: 36, y: 200, width: 540, height: 540 });
    page.drawText(`Page ${p + 1}`, { x: 36, y: 760, size: 10, font });
  }
  return doc.save();
}

/** Minimal valid JPEG with `len` bytes of incompressible scan data. */
function makeRandomJpeg(len: number): Uint8Array {
  // SOI, APP0 (JFIF), SOF0 (baseline 8x8 1-component), DHT (minimal),
  // SOS, <random scan data>, EOI. pdf-lib only needs to parse the headers
  // to embed; the scan data is opaque.
  const header = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b,
    0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00,
    0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01,
    0x01, 0x00, 0x00, 0x3f, 0x00,
  ]);
  const scan = new Uint8Array(len);
  for (let i = 0; i < len; i++) scan[i] = (i * 1103515245 + 12345) & 0xff;
  // Avoid 0xFF in scan data so we don't accidentally form a marker.
  for (let i = 0; i < len; i++) if (scan[i] === 0xff) scan[i] = 0xfe;
  const eoi = Uint8Array.from([0xff, 0xd9]);
  const out = new Uint8Array(header.length + scan.length + eoi.length);
  out.set(header, 0);
  out.set(scan, header.length);
  out.set(eoi, header.length + scan.length);
  return out;
}

async function buildFormsPdf(): Promise<Uint8Array> {
  // pdf-lib generates a separated field/widget tree that pdfjs's
  // getFieldObjects() reports without type/editable, so extractFormSchema
  // skips them. Use a real-world form PDF (IRS W-9) instead — it's the same
  // asset the server is expected to handle in production.
  return fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "assets/fw9.pdf"),
  );
}

function generateSelfSignedCert(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(path.join(tmpdir(), "range-server-cert-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "pipe" },
  );
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

export async function startRangeServer(): Promise<RangeServer> {
  const files: Record<string, Uint8Array> = {
    "/noforms.pdf": await buildNoFormsPdf(),
    "/forms.pdf": await buildFormsPdf(),
  };
  const fileSizes = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, v.length]),
  );

  // Per-path hit count per byte, for overlap accounting.
  const hitCounts: Record<string, Uint8Array> = {};
  const initHits = () => {
    for (const [k, v] of Object.entries(files)) {
      hitCounts[k] = new Uint8Array(v.length);
    }
  };
  initHits();

  let requests: RangeRequest[] = [];
  let releaseResolve: (() => void) | undefined;
  let releasePromise = new Promise<void>((r) => (releaseResolve = r));

  const { key, cert } = generateSelfSignedCert();

  const server = https.createServer({ key, cert }, async (req, res) => {
    const url = new URL(req.url ?? "/", "https://localhost");
    const body = files[url.pathname];
    if (!body) {
      res.writeHead(404).end();
      return;
    }

    const stallAfterBytes = url.searchParams.get("stallAfterBytes");
    const total = body.length;
    const range = req.headers.range;

    let begin = 0;
    let end = total; // exclusive
    let status = 200;
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (m) {
        begin = parseInt(m[1], 10);
        end = m[2] ? parseInt(m[2], 10) + 1 : total;
        begin = Math.min(begin, total);
        end = Math.min(end, total);
        status = 206;
      }
    }

    // Stall once N bytes have already been served — lets pdfjs read the
    // header/trailer/xref (scattered across the file) before blocking the
    // bulk content streams.
    if (stallAfterBytes !== null) {
      const served = requests.reduce((s, r) => s + r.bytes, 0);
      if (served >= parseInt(stallAfterBytes, 10)) await releasePromise;
    }

    const slice = body.subarray(begin, end);
    requests.push({ path: url.pathname, begin, end, bytes: slice.length });
    const hits = hitCounts[url.pathname];
    for (let i = begin; i < end; i++) hits[i]++;

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Accept-Ranges": "bytes",
      "Content-Length": String(slice.length),
    };
    if (status === 206) {
      headers["Content-Range"] = `bytes ${begin}-${end - 1}/${total}`;
    }
    res.writeHead(status, headers);
    res.end(slice);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    baseUrl: `https://localhost:${port}`,
    fileSizes,
    stats() {
      let totalBytesServed = 0;
      let overlapBytes = 0;
      for (const r of requests) totalBytesServed += r.bytes;
      for (const hits of Object.values(hitCounts)) {
        for (let i = 0; i < hits.length; i++) if (hits[i] > 1) overlapBytes++;
      }
      return { requests: [...requests], totalBytesServed, overlapBytes };
    },
    resetStats() {
      requests = [];
      initHits();
      releasePromise = new Promise<void>((r) => (releaseResolve = r));
    },
    release() {
      releaseResolve?.();
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
