import { describe, expect, it } from "bun:test";

import { buildCspHeader } from "../src/csp";

function getScriptSrc(cspHeader: string): string {
  const scriptSrc = cspHeader
    .split("; ")
    .find((directive) => directive.startsWith("script-src "));

  if (!scriptSrc) {
    throw new Error(`Missing script-src directive in CSP: ${cspHeader}`);
  }

  return scriptSrc;
}

describe("buildCspHeader", () => {
  it("adds wasm-unsafe-eval to script-src when requested", () => {
    const scriptSrc = getScriptSrc(
      buildCspHeader({
        resourceDomains: ["https://cdn.example.com"],
        wasmUnsafeEval: true,
      }),
    );

    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc).toContain("https://cdn.example.com");
  });

  it("omits wasm-unsafe-eval from script-src when not requested", () => {
    const scriptSrc = getScriptSrc(buildCspHeader());

    expect(scriptSrc).not.toContain("'wasm-unsafe-eval'");
  });
});
