// Page-level coverage for /notifications (#44): list rendering, test-send
// success/failure feedback and the master threshold save.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "./NotificationsPage";
import { stubFetch } from "../test-utils";
import type { ChannelView } from "../notifications/types";

function channel(overrides: Partial<ChannelView> = {}): ChannelView {
  return {
    id: "ch-1",
    type: "webhook",
    name: "值班 Webhook",
    url: "https://example.com/hook",
    enabled: true,
    hasSecret: true,
    hasAppSecret: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function config(channels: ChannelView[] = [channel()]) {
  return { channels, defaultLowBalanceThreshold: 10 };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotificationsPage", () => {
  it("renders the channel list and the global threshold", async () => {
    stubFetch({ "GET /api/notifications": { body: config() } });
    render(() => <NotificationsPage />);

    expect(await screen.findByText("值班 Webhook")).toBeTruthy();
    expect(screen.getByText("全局默认低余额阈值")).toBeTruthy();
    expect(screen.getByLabelText("阈值")).toBeTruthy();
  });

  it("sends a test message and shows success feedback", async () => {
    const fetchMock = stubFetch({
      "GET /api/notifications": { body: config() },
      "POST /api/notifications/ch-1": {
        body: { success: true, channel: channel() },
      },
    });
    render(() => <NotificationsPage />);
    await screen.findByText("值班 Webhook");

    fireEvent.click(screen.getByRole("button", { name: "测试发送" }));

    expect(await screen.findByText("测试消息已发送")).toBeTruthy();
    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        input === "/api/notifications/ch-1" &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      action: "test",
    });
  });

  it("shows the server error when a test send fails", async () => {
    stubFetch({
      "GET /api/notifications": { body: config() },
      "POST /api/notifications/ch-1": {
        status: 502,
        body: { success: false, error: "签名校验失败" },
      },
    });
    render(() => <NotificationsPage />);
    await screen.findByText("值班 Webhook");

    fireEvent.click(screen.getByRole("button", { name: "测试发送" }));

    expect(await screen.findByText("签名校验失败")).toBeTruthy();
  });

  it("saves the global low-balance threshold", async () => {
    const fetchMock = stubFetch({
      "GET /api/notifications": { body: config() },
      "PUT /api/notifications": {
        body: { defaultLowBalanceThreshold: 25 },
      },
    });
    render(() => <NotificationsPage />);
    await screen.findByText("值班 Webhook");

    fireEvent.input(screen.getByLabelText("阈值"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          input === "/api/notifications" &&
          (init as RequestInit | undefined)?.method === "PUT"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
        defaultLowBalanceThreshold: 25,
      });
    });
  });
});
