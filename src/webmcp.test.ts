import { describe, expect, it } from "bun:test";

import { webMcpExecuteInput } from "./webmcp.js";

describe("webMcpExecuteInput", () => {
  it("ignores a tool whose inputSchema getter throws", () => {
    const broken = { name: "broken" } as {
      name: string;
      inputSchema?: unknown;
    };
    Object.defineProperty(broken, "inputSchema", {
      get() {
        throw new Error("bad descriptor");
      },
    });

    expect(webMcpExecuteInput([broken], { n: 1 })).toEqual({ n: 1 });
  });

  it("still uses JSON input when another tool reports a JSON string schema", () => {
    const broken = { name: "broken" } as {
      name: string;
      inputSchema?: unknown;
    };
    Object.defineProperty(broken, "inputSchema", {
      get() {
        throw new Error("bad descriptor");
      },
    });

    expect(
      webMcpExecuteInput(
        [
          broken,
          { name: "native", description: "", inputSchema: '{"type":"object"}' },
        ],
        { n: 1 },
      ),
    ).toBe('{"n":1}');
  });
});
