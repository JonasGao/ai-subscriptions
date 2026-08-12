import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchMoonshotBalance } from "@/lib/providers/moonshot";
import { fetchDeepSeekBalance } from "@/lib/providers/deepseek";
import { fetchSiliconFlowBalance } from "@/lib/providers/siliconflow";
import { fetchOpenRouterBalance } from "@/lib/providers/openrouter";

describe("balance handler unification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("moonshot", () => {
    it("maps to available/granted/toppedUp with currency=CNY", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            available_balance: 399.5,
            voucher_balance: 50,
            cash_balance: 349.5,
          },
        }),
      } as Response);

      const result = await fetchMoonshotBalance("test-key");

      expect(result.provider).toBe("moonshot");
      expect(result.isAvailable).toBe(true);
      expect(result.balanceInfos).toHaveLength(1);
      const info = result.balanceInfos[0];
      expect(info.currency).toBe("CNY");
      expect(info.available).toBe("399.50");
      expect(info.granted).toBe("50.00");
      expect(info.toppedUp).toBe("349.50");
      expect(info.total).toBeNull();
      expect(info.used).toBeNull();
      expect(info.frozen).toBeNull();
    });
  });

  describe("deepseek", () => {
    it("maps to available/toppedUp/granted with currency from API", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          is_available: true,
          balance_infos: [
            {
              currency: "USD",
              total_balance: "42.50",
              granted_balance: "10.00",
              topped_up_balance: "32.50",
            },
          ],
        }),
      } as Response);

      const result = await fetchDeepSeekBalance("test-key");

      expect(result.provider).toBe("deepseek");
      expect(result.isAvailable).toBe(true);
      expect(result.balanceInfos).toHaveLength(1);
      const info = result.balanceInfos[0];
      expect(info.currency).toBe("USD");
      expect(info.available).toBe("42.50");
      expect(info.granted).toBe("10.00");
      expect(info.toppedUp).toBe("32.50");
      expect(info.total).toBeNull();
      expect(info.used).toBeNull();
    });

    it("falls back to USD when currency is missing", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          is_available: true,
          balance_infos: [
            {
              total_balance: "10",
              granted_balance: "0",
              topped_up_balance: "10",
            },
          ],
        }),
      } as Response);

      const result = await fetchDeepSeekBalance("test-key");
      expect(result.balanceInfos[0].currency).toBe("USD");
    });
  });

  describe("siliconflow (semantics fixed)", () => {
    it("maps available=balance, total=totalBalance, toppedUp=chargeBalance", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 20000,
          status: "normal",
          data: {
            totalBalance: "500.00",
            balance: "300.00",
            chargeBalance: "200.00",
            status: "normal",
          },
        }),
      } as Response);

      const result = await fetchSiliconFlowBalance("test-key");

      expect(result.provider).toBe("siliconflow");
      expect(result.isAvailable).toBe(true);
      expect(result.balanceInfos).toHaveLength(1);
      const info = result.balanceInfos[0];
      expect(info.currency).toBe("CNY");
      // Semantic fix: available is the usable balance (not totalBalance)
      expect(info.available).toBe("300.00");
      expect(info.total).toBe("500.00");
      expect(info.toppedUp).toBe("200.00");
      expect(info.granted).toBeNull();
      expect(info.used).toBeNull();
    });
  });

  describe("openrouter (semantics fixed)", () => {
    it("maps available=credits-usage, total=credits, used=usage", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { total_credits: 100, total_usage: 25 },
        }),
      } as Response);

      const result = await fetchOpenRouterBalance("test-key");

      expect(result.provider).toBe("openrouter");
      expect(result.isAvailable).toBe(true);
      expect(result.balanceInfos).toHaveLength(1);
      const info = result.balanceInfos[0];
      expect(info.currency).toBe("USD");
      // Semantic fix: available is remaining credits, not total_usage
      expect(info.available).toBe("75.00");
      expect(info.total).toBe("100.00");
      expect(info.used).toBe("25.00");
      expect(info.toppedUp).toBeNull();
      expect(info.granted).toBeNull();
    });
  });
});
