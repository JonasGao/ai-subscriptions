import { describe, expect, it } from "vitest";

describe("proxy tag route caching", () => {
  it("reads mutable proxy tags dynamically", async () => {
    const route = await import("@/app/api/proxy-tags/route");

    expect("dynamic" in route ? route.dynamic : undefined).toBe(
      "force-dynamic"
    );
  });
});
