import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempDataDir: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sub-tags-"));
  process.env.DATA_DIR = tempDataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function getDb() {
  return import("@/lib/db");
}

function subscriptionInput(name: string) {
  return {
    name,
    category: "AI助手",
    provider: "openai",
    subscriptionType: "recurring" as const,
    billingCycle: "monthly" as const,
    price: 20,
    status: "active" as const,
  };
}

describe("subscription tags", () => {
  it("migrates existing data with an empty tag catalog and associations", async () => {
    const legacyData = {
      subscriptions: [
        {
          id: "sub-1",
          ...subscriptionInput("Legacy"),
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      categories: ["AI助手"],
    };
    fs.writeFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      JSON.stringify(legacyData)
    );

    const db = await getDb();
    const data = db.readData();

    expect(data.tags).toEqual([]);
    expect(data.subscriptions[0].tagIds).toEqual([]);
  });

  it("trims names, reuses exact matches, and keeps case-sensitive names distinct", async () => {
    const db = await getDb();

    const first = db.createSubscription(subscriptionInput("First"), [
      " Stable ",
      "stable",
      "Stable",
    ]);
    const second = db.createSubscription(subscriptionInput("Second"), [
      "Stable",
    ]);

    expect(db.getTags().map((tag) => tag.name)).toEqual(["Stable", "stable"]);
    expect(first.tagIds).toHaveLength(2);
    expect(second.tagIds).toEqual([first.tagIds?.[0]]);
  });

  it("rejects invalid tag sets without writing partial data", async () => {
    const db = await getDb();
    db.createSubscription(subscriptionInput("Existing"), ["Stable"]);
    const before = db.readData();

    expect(() =>
      db.createSubscription(subscriptionInput("Invalid"), [
        "New tag",
        "not,allowed",
      ])
    ).toThrow(/逗号/);

    const after = db.readData();
    expect(after.tags).toEqual(before.tags);
    expect(after.subscriptions).toEqual(before.subscriptions);
  });

  it("enforces the per-subscription tag limit", async () => {
    const db = await getDb();
    const names = Array.from({ length: 21 }, (_, index) => `tag-${index}`);

    expect(() =>
      db.createSubscription(subscriptionInput("Too many"), names)
    ).toThrow(/最多添加 20 个标签/);
    expect(db.getSubscriptions()).toEqual([]);
    expect(db.getTags()).toEqual([]);
  });

  it("renames by stable ID and rejects exact-name conflicts", async () => {
    const db = await getDb();
    const subscription = db.createSubscription(subscriptionInput("Tagged"), [
      "Stable",
      "Fast",
    ]);
    const stable = db.getTags().find((tag) => tag.name === "Stable")!;
    const fast = db.getTags().find((tag) => tag.name === "Fast")!;

    const renamed = db.renameTag(stable.id, "Reliable");

    expect(renamed?.name).toBe("Reliable");
    expect(db.getSubscriptions()[0].tagIds).toEqual(subscription.tagIds);
    expect(() => db.renameTag(fast.id, "Reliable")).toThrow(/已存在/);
  });

  it("deletes a tag and removes its association from every subscription", async () => {
    const db = await getDb();
    const first = db.createSubscription(subscriptionInput("First"), ["Stable"]);
    const second = db.createSubscription(subscriptionInput("Second"), [
      "Stable",
      "Fast",
    ]);
    const stable = db.getTags().find((tag) => tag.name === "Stable")!;

    const result = db.deleteTag(stable.id);

    expect(result?.affectedSubscriptionIds).toEqual([first.id, second.id]);
    expect(db.getTags().map((tag) => tag.name)).toEqual(["Fast"]);
    expect(db.getSubscriptions().map((sub) => sub.tagIds)).toEqual([
      [],
      [second.tagIds?.[1]],
    ]);
  });
});
