import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Use a fresh temp directory per test so each case starts with an empty
// notifications store (matching the db.test.ts pattern).
let tempDataDir: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sub-notif-test-"));
  process.env.DATA_DIR = tempDataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function getStorage() {
  return await import("@/lib/notifications/storage");
}

describe("notification storage: channel CRUD", () => {
  it("createChannel assigns id, timestamps, and defaults enabled=true", async () => {
    const storage = await getStorage();
    const channel = storage.createChannel({
      type: "dingtalk",
      name: "Ops",
      url: "https://example.com/hook",
    });

    expect(channel.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(channel.type).toBe("dingtalk");
    expect(channel.name).toBe("Ops");
    expect(channel.url).toBe("https://example.com/hook");
    expect(channel.enabled).toBe(true);
    expect(channel.secret).toBeUndefined();
    expect(channel.createdAt).toBe(channel.updatedAt);
    expect(storage.listChannels()).toEqual([channel]);
  });

  it("createChannel preserves explicit enabled=false and secret", async () => {
    const storage = await getStorage();
    const channel = storage.createChannel({
      type: "feishu",
      name: "Alerts",
      url: "https://example.com/feishu",
      secret: "shh",
      enabled: false,
    });

    expect(channel.enabled).toBe(false);
    expect(channel.secret).toBe("shh");
  });

  it("getChannelById returns the channel or null", async () => {
    const storage = await getStorage();
    const created = storage.createChannel({
      type: "webhook",
      name: "Hook",
      url: "https://example.com/h",
    });
    expect(storage.getChannelById(created.id)).toEqual(created);
    expect(storage.getChannelById("does-not-exist")).toBeNull();
  });

  it("updateChannel merges fields and refreshes updatedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));
    try {
      const storage = await getStorage();
      const created = storage.createChannel({
        type: "dingtalk",
        name: "A",
        url: "https://example.com/a",
        secret: "s",
      });

      // Advance the clock so updatedAt differs from createdAt.
      vi.advanceTimersByTime(5_000);

      const updated = storage.updateChannel(created.id, {
        name: "B",
        secret: undefined,
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("B");
      // secret was explicitly set to undefined, which replaces the old value.
      expect(updated!.secret).toBeUndefined();
      // untouched fields survive.
      expect(updated!.type).toBe("dingtalk");
      expect(updated!.url).toBe("https://example.com/a");
      expect(updated!.updatedAt).not.toBe(created.updatedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updateChannel returns null for unknown id", async () => {
    const storage = await getStorage();
    expect(storage.updateChannel("nope", { name: "X" })).toBeNull();
  });

  it("deleteChannel removes and returns true; false for unknown", async () => {
    const storage = await getStorage();
    const created = storage.createChannel({
      type: "webhook",
      name: "Hook",
      url: "https://example.com/h",
    });
    expect(storage.deleteChannel(created.id)).toBe(true);
    expect(storage.listChannels()).toEqual([]);
    expect(storage.deleteChannel(created.id)).toBe(false);
  });

  it("toggleChannelEnabled flips state in a single read+write", async () => {
    const storage = await getStorage();
    const created = storage.createChannel({
      type: "feishu",
      name: "F",
      url: "https://example.com/f",
    });
    expect(created.enabled).toBe(true);

    const toggled1 = storage.toggleChannelEnabled(created.id);
    expect(toggled1).not.toBeNull();
    expect(toggled1!.enabled).toBe(false);

    const toggled2 = storage.toggleChannelEnabled(created.id);
    expect(toggled2!.enabled).toBe(true);

    // Unknown id → null.
    expect(storage.toggleChannelEnabled("nope")).toBeNull();
  });

  it("toggleChannelEnabled performs one read and one write", async () => {
    // Regression guard: the implementation must flip enabled in a single
    // read+write pass (no separate getChannelById followed by updateChannel,
    // which would read the file twice).
    const storage = await getStorage();
    const created = storage.createChannel({
      type: "webhook",
      name: "H",
      url: "https://example.com/h",
    });

    // Spy on the raw fs primitives underlying read/write so we can count
    // I/O regardless of how the module wires its exports together.
    const readSpy = vi.spyOn(fs, "readFileSync");
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    readSpy.mockClear();
    writeSpy.mockClear();

    storage.toggleChannelEnabled(created.id);

    // One readFileSync for the read, one writeFileSync for the write.
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);

    // And the flip actually happened.
    expect(storage.getChannelById(created.id)!.enabled).toBe(false);
  });
});

describe("notification storage: global default threshold", () => {
  it("defaults to DEFAULT_LOW_BALANCE_THRESHOLD (10)", async () => {
    const storage = await getStorage();
    expect(storage.getDefaultLowBalanceThreshold()).toBe(10);
  });

  it("setter persists the new value", async () => {
    const storage = await getStorage();
    storage.setDefaultLowBalanceThreshold(25);
    expect(storage.getDefaultLowBalanceThreshold()).toBe(25);

    // Re-import to prove it was persisted to disk.
    vi.resetModules();
    const storage2 = await getStorage();
    expect(storage2.getDefaultLowBalanceThreshold()).toBe(25);
  });
});
