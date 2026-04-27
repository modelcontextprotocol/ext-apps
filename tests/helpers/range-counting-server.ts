/**
 * HTTP test fixture serving programmatically-generated PDFs with byte-range
 * accounting. Used by pdf-incremental-load.spec.ts to assert that display_pdf
 * doesn't pull the whole file before the viewer starts streaming.
 *
 * Plain HTTP on loopback — playwright.config.ts sets
 * PDF_SERVER_ALLOW_LOOPBACK_HTTP=1 so validateUrl accepts http://127.0.0.1.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

export interface RangeServerStats {
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
  /** Resolve any requests currently stalled by ?stallAfterBytes=N. */
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
  // and asserts page 1 still renders. The image is >MAX_CHUNK_BYTES (512KB)
  // so rendering page 2 also exercises the viewer's >512KB range path.
  const big = await doc.embedJpg(makeRandomJpeg(1_100 * 1024));
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
export function makeRandomJpeg(len: number): Uint8Array {
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

/**
 * Two pages, page 1 text-only, page 2 carries one native /Text (sticky-note)
 * annotation. Used by the tombstone-preservation e2e: the viewer's lazy
 * baseline scan must not have visited page 2 when persistAnnotations runs.
 */
async function buildWithNativeAnnotPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page1 = doc.addPage([612, 792]);
  page1.drawText("Page 1 — no native annotations here.", {
    x: 36,
    y: 740,
    size: 12,
    font,
  });
  const page2 = doc.addPage([612, 792]);
  page2.drawText("Page 2 — has one native /Text annot.", {
    x: 36,
    y: 740,
    size: 12,
    font,
  });
  const annotRef = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [100, 700, 120, 720],
      Contents: PDFString.of("native sticky note"),
      Open: false,
      Name: "Comment",
    }),
  );
  page2.node.set(PDFName.of("Annots"), doc.context.obj([annotRef]));
  return doc.save();
}

async function buildFormsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  for (let p = 0; p < 2; p++) doc.addPage([612, 792]);
  const [page1] = doc.getPages();
  const fields = ["name", "email", "phone", "city", "notes"];
  fields.forEach((name, i) => {
    const f = form.createTextField(name);
    f.addToPage(page1, { x: 100, y: 650 - i * 60, width: 300, height: 24 });
  });
  return doc.save();
}

export async function startRangeServer(): Promise<RangeServer> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "range-counting-server is a test fixture; refusing to start with NODE_ENV=production",
    );
  }
  const files: Record<string, Uint8Array> = {
    "/noforms.pdf": await buildNoFormsPdf(),
    "/forms.pdf": await buildFormsPdf(),
    "/with-native-annot.pdf": await buildWithNativeAnnotPdf(),
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

  let totalBytesServed = 0;
  let releaseResolve: (() => void) | undefined;
  let releasePromise = new Promise<void>((r) => (releaseResolve = r));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
      if (totalBytesServed >= parseInt(stallAfterBytes, 10)) {
        await releasePromise;
      }
    }

    const slice = body.subarray(begin, end);
    totalBytesServed += slice.length;
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
    baseUrl: `http://127.0.0.1:${port}`,
    fileSizes,
    stats() {
      let overlapBytes = 0;
      for (const hits of Object.values(hitCounts)) {
        for (let i = 0; i < hits.length; i++) if (hits[i] > 1) overlapBytes++;
      }
      return { totalBytesServed, overlapBytes };
    },
    resetStats() {
      totalBytesServed = 0;
      initHits();
      // Unblock any handlers parked on the previous stall before re-arming,
      // otherwise they hold sockets open forever and close() hangs.
      releaseResolve?.();
      releasePromise = new Promise<void>((r) => (releaseResolve = r));
    },
    release() {
      releaseResolve?.();
    },
    close() {
      releaseResolve?.();
      server.closeAllConnections?.();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
