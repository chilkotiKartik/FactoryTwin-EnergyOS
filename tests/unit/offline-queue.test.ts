import { describe, expect, it } from "vitest";
import { classify, createMemoryStore, flushQueue, type QueuedHeat } from "@/lib/offline/queue";

const item = (id: string, over: Partial<QueuedHeat> = {}): QueuedHeat => ({ id, userId: "u1", factoryId: "f1", createdAt: Number(id.slice(1)), values: { heatNo: id }, status: "PENDING", ...over });
const who = { userId: "u1", factoryId: "f1" };

describe("offline queue", () => {
  it("sends oldest first and removes what was accepted", async () => {
    const s = createMemoryStore();
    await s.put(item("q3"));
    await s.put(item("q1"));
    await s.put(item("q2"));
    const order: string[] = [];
    const r = await flushQueue(s, who, async (i) => (order.push(i.id), { kind: "ok" }));
    expect(order).toEqual(["q1", "q2", "q3"]);
    expect(r).toEqual({ sent: 3, rejected: 0, stopped: false });
    expect(await s.list()).toHaveLength(0);
  });

  it("stops at the first transient failure and keeps order", async () => {
    const s = createMemoryStore();
    for (const id of ["q1", "q2", "q3"]) await s.put(item(id));
    const r = await flushQueue(s, who, async (i) => (i.id === "q2" ? { kind: "retry" } : { kind: "ok" }));
    expect(r).toEqual({ sent: 1, rejected: 0, stopped: true });
    expect((await s.list()).map((i) => i.id)).toEqual(["q2", "q3"]);
  });

  it("treats a thrown error as a transient failure", async () => {
    const s = createMemoryStore();
    await s.put(item("q1"));
    const r = await flushQueue(s, who, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(r.stopped).toBe(true);
    expect(await s.list()).toHaveLength(1);
  });

  it("keeps a refused item as REJECTED with the reason, and does not retry it", async () => {
    const s = createMemoryStore();
    await s.put(item("q1"));
    await s.put(item("q2"));
    let calls = 0;
    const send = async (i: QueuedHeat) => (calls++, i.id === "q1" ? ({ kind: "rejected", message: "Overlaps heat H03." } as const) : ({ kind: "ok" } as const));
    expect(await flushQueue(s, who, send)).toEqual({ sent: 1, rejected: 1, stopped: false });
    const left = await s.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: "q1", status: "REJECTED", message: "Overlaps heat H03." });
    await flushQueue(s, who, send);
    expect(calls).toBe(2); // the rejected item was not sent again
  });

  it("never sends another user's or factory's items", async () => {
    const s = createMemoryStore();
    await s.put(item("q1", { userId: "someone-else" }));
    await s.put(item("q2", { factoryId: "f2" }));
    const sent: string[] = [];
    await flushQueue(s, who, async (i) => (sent.push(i.id), { kind: "ok" }));
    expect(sent).toEqual([]);
    expect(await s.list()).toHaveLength(2);
  });

  it("classifies action results", () => {
    expect(classify({ ok: true })).toEqual({ kind: "ok" });
    expect(classify({ ok: false, code: "UNAUTHENTICATED" })).toEqual({ kind: "retry" });
    expect(classify({ ok: false, code: "INTERNAL" })).toEqual({ kind: "retry" });
    expect(classify({ ok: false, code: "VALIDATION", message: "bad" })).toEqual({ kind: "rejected", message: "bad" });
    expect(classify({ ok: false, code: "FORBIDDEN" }).kind).toBe("rejected");
  });
});
