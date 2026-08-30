import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempDataDir: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-sub-test-"));
  process.env.DATA_DIR = tempDataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("proxy subscription date rules", () => {
  it("calculates an inclusive expiration date", async () => {
    const { calculateProxyExpirationDate } =
      await import("@/lib/proxy-subscriptions");
    expect(calculateProxyExpirationDate("2026-08-01", 30)).toBe("2026-08-30");
  });

  it("skips expiration notices for unused subscriptions", async () => {
    const { getProxyDateNotice } = await import("@/lib/proxy-subscriptions");
    expect(
      getProxyDateNotice(
        { status: "unused", expirationDate: "2020-01-01" },
        new Date("2026-08-30T00:00:00Z")
      )
    ).toEqual({ kind: "none" });
  });

  it("reports overdue days only for in-use subscriptions", async () => {
    const { getProxyDateNotice } = await import("@/lib/proxy-subscriptions");
    expect(
      getProxyDateNotice(
        { status: "in-use", expirationDate: "2026-08-28" },
        new Date("2026-08-30T00:00:00Z")
      )
    ).toEqual({ kind: "overdue", days: 2 });
  });

  it("uses China calendar dates around UTC midnight", async () => {
    const { getProxyTodayDate } = await import("@/lib/proxy-subscriptions");
    expect(getProxyTodayDate(new Date("2026-08-29T16:30:00Z"))).toBe(
      "2026-08-30"
    );
  });
});

describe("proxy subscription storage", () => {
  it("creates, updates, and deletes independent proxy tags", async () => {
    const db = await import("@/lib/proxy-subscriptions");
    const created = db.createProxySubscription({
      name: "Relay",
      monthlyPrice: 19.9,
      expirationDate: "2026-09-30",
      status: "unused",
      tagNames: ["备用"],
    });
    expect(db.getProxyTags()).toHaveLength(1);
    expect(created.tagIds).toHaveLength(1);

    const updated = db.updateProxySubscription(
      created.id,
      { status: "in-use" },
      ["工作"]
    );
    expect(updated?.status).toBe("in-use");
    expect(db.getProxyTags().map((tag) => tag.name)).toEqual(["工作", "备用"]);

    const currentTagId = updated!.tagIds![0];
    expect(db.deleteProxyTag(currentTagId)).toMatchObject({
      tagId: currentTagId,
      affectedSubscriptionIds: [created.id],
    });
    expect(db.getProxySubscriptionById(created.id)?.tagIds).toEqual([]);
    expect(db.deleteProxySubscription(created.id)).toBe(true);
  });
});
