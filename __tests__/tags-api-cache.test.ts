import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown) => ({ body }) },
}));

vi.mock("@/lib/db", () => ({
  getTags: vi.fn(() => [
    {
      id: "tag-1",
      name: "Fresh",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
}));

describe("tags API cache policy", () => {
  it("forces the mutable tag catalog route to stay dynamic", async () => {
    const route = await import("@/app/api/tags/route");

    expect(route.dynamic).toBe("force-dynamic");
    expect((await route.GET()).body).toEqual([
      expect.objectContaining({ name: "Fresh" }),
    ]);
  });
});
