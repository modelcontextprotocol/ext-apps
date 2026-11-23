import { expect, test } from "bun:test";
import { CompanionView, type CompanionPane, type CompanionSlot } from "../src/companion-view";

function fixture(slot: CompanionSlot = {}) {
  const events: string[] = [];
  const mounts = new Map<string, {
    signal: AbortSignal;
    resolve: (pane: CompanionPane | undefined) => void;
    reject: (error: Error) => void;
  }>();
  const companion = new CompanionView(
    slot,
    (id, signal) => new Promise((resolve, reject) => {
      mounts.set(id, { signal, resolve, reject });
    }),
    (generation) => events.push(`dismiss:${generation}`),
    (error) => events.push(`failure:${String(error)}`),
  );
  const open = (itemId: string | null, seq: number, generation = 0) =>
    companion.setView({ generation, seq, itemId });
  const complete = (id: string) => mounts.get(id)!.resolve({
    show: () => events.push(`show:${id}`),
    dispose: () => events.push(`dispose:${id}`),
  });
  return { companion, events, mounts, open, complete };
}

test("latest switch wins even when the previous mount completes late", async () => {
  const { events, mounts, open, complete } = fixture();
  const cedar = open("cedar", 1);
  const quartz = open("quartz", 2);
  expect(mounts.get("cedar")!.signal.aborted).toBe(true);
  complete("quartz");
  expect(await quartz).toEqual({ status: "shown", generation: 0, itemId: "quartz" });
  complete("cedar");
  expect(await cedar).toEqual({ status: "stale", generation: 0, itemId: "quartz" });
  expect(await open("cedar", 2)).toMatchObject({ status: "stale" });
  expect(await open(null, 3)).toEqual({ status: "closed", generation: 0, itemId: null });
  expect(events).toEqual(["show:quartz", "dispose:cedar", "dispose:quartz"]);
});

test("host dismissal and parent teardown both fence pending work", async () => {
  const { companion, events, open, complete } = fixture();
  const cedar = open("cedar", 1);
  companion.dismiss();
  complete("cedar");
  expect(await cedar).toEqual({ status: "stale", generation: 1, itemId: null });
  expect(await open("cedar", 2)).toMatchObject({ status: "stale", generation: 1 });
  const quartz = open("quartz", 3, 1);
  companion.dispose();
  complete("quartz");
  expect(await quartz).toEqual({ status: "stale", generation: 2, itemId: null });
  expect(await open("cedar", 4, 2)).toMatchObject({ status: "stale" });
  expect(events).toEqual(["dismiss:1", "dispose:cedar", "dispose:quartz"]);
});

test("another parent is denied while the slot is held; failures release it", async () => {
  const slot = {};
  const first = fixture(slot);
  const second = fixture(slot);
  const cedar = first.open("cedar", 1);
  expect(await second.open("quartz", 1)).toEqual({ status: "denied", generation: 0, itemId: null });
  first.mounts.get("cedar")!.reject(new Error("load failed"));
  expect(await cedar).toEqual({ status: "failed", generation: 0, itemId: null });
  const quartz = second.open("quartz", 2);
  second.mounts.get("quartz")!.resolve(undefined);
  expect(await quartz).toEqual({ status: "unavailable", generation: 0, itemId: null });
  expect(slot).toMatchObject({ owner: undefined });
});
