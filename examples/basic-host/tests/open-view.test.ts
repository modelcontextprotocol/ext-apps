import { expect, test } from "bun:test";
import { OpenViewController, type CompanionPane, type CompanionSlot } from "../src/open-view";

function fixture(slot: CompanionSlot = {}) {
  const events: string[] = [];
  const mounts = new Map<string, {
    signal: AbortSignal;
    finish: (result: { pane: CompanionPane; displayMode: "inline" } | "denied" | "unavailable") => void;
    reject: (error: Error) => void;
  }>();
  const controller = new OpenViewController(
    slot,
    ({ target }, signal) => new Promise((finish, reject) => {
      mounts.set(target, { signal, finish, reject });
    }),
    (generation) => events.push(`dismiss:${generation}`),
    (error) => events.push(`failure:${String(error)}`),
  );
  controller.startSession();
  const open = (target: string, seq: number, generation = 0) =>
    controller.open({ generation, seq, target, input: {} });
  const complete = (target: string) => mounts.get(target)!.finish({
    pane: {
      show: () => events.push(`show:${target}`),
      dispose: () => events.push(`dispose:${target}`),
    },
    displayMode: "inline",
  });
  return { controller, events, mounts, open, complete };
}

test("a late launch cannot replace a newer View", async () => {
  const { events, mounts, open, complete } = fixture();
  const detail = open("detail", 1);
  const map = open("map", 2);
  expect(mounts.get("detail")!.signal.aborted).toBe(true);
  complete("map");
  expect(await map).toEqual({ status: "opened", generation: 0, displayMode: "inline" });
  complete("detail");
  expect(await detail).toEqual({ status: "stale", generation: 0 });
  expect(await open("detail", 2)).toMatchObject({ status: "stale" });
  expect(events).toEqual(["show:map", "dispose:detail"]);
});

test("dismissal, reinitialization and teardown retire pending launches", async () => {
  const { controller, events, open, complete } = fixture();
  const detail = open("detail", 1);
  controller.dismiss();
  complete("detail");
  expect(await detail).toEqual({ status: "stale", generation: 1 });
  expect(await open("detail", 2)).toMatchObject({ status: "stale", generation: 1 });
  const map = open("map", 3, 1);
  expect(controller.startSession()).toBe(2);
  const replacement = open("detail", 1, 2);
  complete("detail");
  expect(await replacement).toMatchObject({ status: "opened" });
  controller.dispose();
  complete("map");
  expect(await map).toEqual({ status: "stale", generation: 3 });
  expect(await open("detail", 2, 3)).toMatchObject({ status: "stale" });
  expect(events).toEqual(["dismiss:1", "dispose:detail", "show:detail", "dispose:detail", "dispose:map"]);
});

test("a blocked placement and a mount failure both release the slot", async () => {
  const slot = {};
  const first = fixture(slot);
  const second = fixture(slot);
  const detail = first.open("detail", 1);
  expect(await second.open("map", 1)).toEqual({ status: "denied", generation: 0 });
  first.mounts.get("detail")!.finish("denied");
  expect(await detail).toEqual({ status: "denied", generation: 0 });
  const map = second.open("map", 2);
  second.mounts.get("map")!.reject(new Error("load failed"));
  expect(await map).toEqual({ status: "failed", generation: 0 });
  expect(slot).toMatchObject({ owner: undefined });
});
