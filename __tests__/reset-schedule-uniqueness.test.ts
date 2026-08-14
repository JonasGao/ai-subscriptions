import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Use a temp directory for each test run so we don't touch the real data.
let tempDataDir: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sub-test-"));
  process.env.DATA_DIR = tempDataDir;
  // Reset module cache so db.ts picks up the new DATA_DIR.
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

// Dynamic imports after setting DATA_DIR.
async function getDb() {
  return await import("@/lib/db");
}

import type {
  Subscription,
  SubscriptionData,
  ResetSchedule,
} from "@/lib/types";

function makeData(overrides: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    subscriptions: [],
    categories: [],
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<ResetSchedule> = {}): ResetSchedule {
  return {
    id: "sched-1",
    enabled: true,
    type: "fiveHour",
    nextResetTime: "2024-01-01T00:00:00Z",
    exhausted: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "AI助手",
    provider: "openai",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    resetSchedules: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("Reset Schedule type uniqueness", () => {
  describe("createSubscription", () => {
    it("allows creating a subscription with unique schedule types", async () => {
      const db = await getDb();
      const schedules = [
        makeSchedule({ id: "s1", type: "fiveHour" }),
        makeSchedule({ id: "s2", type: "weekly" }),
        makeSchedule({ id: "s3", type: "monthly" }),
      ];

      const sub = db.createSubscription(
        makeSubscription({ resetSchedules: schedules }) as Omit<
          Subscription,
          "id" | "createdAt" | "updatedAt"
        >
      );

      expect(sub.resetSchedules).toHaveLength(3);
    });

    it("rejects duplicate schedule types", async () => {
      const db = await getDb();
      const schedules = [
        makeSchedule({ id: "s1", type: "weekly" }),
        makeSchedule({ id: "s2", type: "weekly" }),
      ];

      expect(() =>
        db.createSubscription(
          makeSubscription({ resetSchedules: schedules }) as Omit<
            Subscription,
            "id" | "createdAt" | "updatedAt"
          >
        )
      ).toThrow(/Duplicate schedule type "weekly"/);
    });
  });

  describe("updateSubscription", () => {
    it("allows updating with unique schedule types", async () => {
      const db = await getDb();
      const initial = makeSubscription({ resetSchedules: [] });
      db.writeData(makeData({ subscriptions: [initial] }));

      const schedules = [
        makeSchedule({ id: "s1", type: "fiveHour" }),
        makeSchedule({ id: "s2", type: "monthly" }),
      ];

      const updated = db.updateSubscription("sub-1", {
        resetSchedules: schedules,
      });
      expect(updated?.resetSchedules).toHaveLength(2);
    });

    it("rejects duplicate schedule types", async () => {
      const db = await getDb();
      const initial = makeSubscription({ resetSchedules: [] });
      db.writeData(makeData({ subscriptions: [initial] }));

      const schedules = [
        makeSchedule({ id: "s1", type: "monthly" }),
        makeSchedule({ id: "s2", type: "monthly" }),
      ];

      expect(() =>
        db.updateSubscription("sub-1", { resetSchedules: schedules })
      ).toThrow(/Duplicate schedule type "monthly"/);
    });
  });

  describe("addResetSchedule", () => {
    it("allows adding a new schedule type", async () => {
      const db = await getDb();
      const initial = makeSubscription({
        resetSchedules: [makeSchedule({ id: "s1", type: "fiveHour" })],
      });
      db.writeData(makeData({ subscriptions: [initial] }));

      const newSchedule = db.addResetSchedule("sub-1", {
        type: "weekly",
        enabled: true,
        dayOfWeek: 1,
        timeOfDay: "10:00",
      });
      expect(newSchedule).not.toBeNull();
      expect(newSchedule?.type).toBe("weekly");
    });

    it("rejects adding a duplicate schedule type", async () => {
      const db = await getDb();
      const initial = makeSubscription({
        resetSchedules: [makeSchedule({ id: "s1", type: "fiveHour" })],
      });
      db.writeData(makeData({ subscriptions: [initial] }));

      expect(() =>
        db.addResetSchedule("sub-1", { type: "fiveHour", enabled: true })
      ).toThrow(/Schedule type "fiveHour" already exists/);
    });
  });

  describe("data migration - dedup on read", () => {
    it("deduplicates schedules keeping earliest createdAt", async () => {
      const db = await getDb();
      const initial = makeSubscription({
        resetSchedules: [
          makeSchedule({
            id: "s1",
            type: "weekly",
            createdAt: "2024-01-02T00:00:00Z",
          }),
          makeSchedule({
            id: "s2",
            type: "weekly",
            createdAt: "2024-01-01T00:00:00Z",
          }),
          makeSchedule({
            id: "s3",
            type: "weekly",
            createdAt: "2024-01-03T00:00:00Z",
          }),
        ],
      });
      db.writeData(makeData({ subscriptions: [initial] }));

      // readData should deduplicate
      const subscriptions = db.getSubscriptions();
      expect(subscriptions[0].resetSchedules).toHaveLength(1);
      expect(subscriptions[0].resetSchedules![0].id).toBe("s2");
      expect(subscriptions[0].resetSchedules![0].createdAt).toBe(
        "2024-01-01T00:00:00Z"
      );
    });

    it("deduplicates multiple types independently", async () => {
      const db = await getDb();
      const initial = makeSubscription({
        resetSchedules: [
          makeSchedule({
            id: "s1",
            type: "fiveHour",
            createdAt: "2024-01-01T00:00:00Z",
          }),
          makeSchedule({
            id: "s2",
            type: "fiveHour",
            createdAt: "2024-01-02T00:00:00Z",
          }),
          makeSchedule({
            id: "s3",
            type: "monthly",
            createdAt: "2024-01-03T00:00:00Z",
          }),
          makeSchedule({
            id: "s4",
            type: "monthly",
            createdAt: "2024-01-01T00:00:00Z",
          }),
        ],
      });
      db.writeData(makeData({ subscriptions: [initial] }));

      const subscriptions = db.getSubscriptions();
      expect(subscriptions[0].resetSchedules).toHaveLength(2);
      const types = subscriptions[0].resetSchedules!.map((s) => s.type).sort();
      expect(types).toEqual(["fiveHour", "monthly"]);

      const fiveHour = subscriptions[0].resetSchedules!.find(
        (s) => s.type === "fiveHour"
      );
      expect(fiveHour?.id).toBe("s1");

      const monthly = subscriptions[0].resetSchedules!.find(
        (s) => s.type === "monthly"
      );
      expect(monthly?.id).toBe("s4");
    });

    it("recomputes subscription status when a duplicate is dropped", async () => {
      const db = await getDb();
      const initial = makeSubscription({
        // The dropped (newer) schedule is the exhausted one that drove the
        // stored "paused" status; the surviving earliest one is not exhausted.
        status: "paused",
        resetSchedules: [
          makeSchedule({
            id: "s1",
            type: "weekly",
            exhausted: false,
            createdAt: "2024-01-01T00:00:00Z",
          }),
          makeSchedule({
            id: "s2",
            type: "weekly",
            exhausted: true,
            createdAt: "2024-01-02T00:00:00Z",
          }),
        ],
      });
      db.writeData(makeData({ subscriptions: [initial] }));

      // readData should deduplicate AND recompute the status
      const subscriptions = db.getSubscriptions();
      expect(subscriptions[0].resetSchedules).toHaveLength(1);
      expect(subscriptions[0].resetSchedules![0].id).toBe("s1");
      expect(subscriptions[0].resetSchedules![0].exhausted).toBe(false);
      expect(subscriptions[0].status).toBe("active");
    });

    it("writes deduplicated data back to file", async () => {
      const db = await getDb();
      const initial = makeSubscription({
        resetSchedules: [
          makeSchedule({
            id: "s1",
            type: "weekly",
            createdAt: "2024-01-02T00:00:00Z",
          }),
          makeSchedule({
            id: "s2",
            type: "weekly",
            createdAt: "2024-01-01T00:00:00Z",
          }),
        ],
      });
      db.writeData(makeData({ subscriptions: [initial] }));

      // First read triggers migration
      db.getSubscriptions();

      // Verify the file was rewritten with deduplicated data
      const filePath = path.join(tempDataDir, "subscriptions.json");
      const fileContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(fileContent.subscriptions[0].resetSchedules).toHaveLength(1);
      expect(fileContent.subscriptions[0].resetSchedules[0].id).toBe("s2");
    });
  });
});
