// Standalone launcher for the range-counting fixture (for webtop-driven validation).
import { startRangeServer } from "./range-counting-server.ts";
const s = await startRangeServer();
console.log(
  JSON.stringify({ port: s.port, baseUrl: s.baseUrl, fileSizes: s.fileSizes }),
);
const http = await import("node:http");
http
  .createServer((req, res) => {
    if (req.url === "/__release") {
      s.release();
      res.end("released");
    } else if (req.url === "/__reset") {
      s.resetStats();
      res.end("reset");
    } else {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(s.stats()));
    }
  })
  .listen(s.port + 1, () =>
    console.log(`stats endpoint: http://localhost:${s.port + 1}/__stats`),
  );
