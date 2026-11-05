// Dialog coverage for #44: the old submitForm validation order, the feishu-app
// payload shape and the edit-only secret clear rules.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelFormDialog } from "./ChannelFormDialog";
import type { ChannelView } from "./types";

function webhookChannel(overrides: Partial<ChannelView> = {}): ChannelView {
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

function submitForm() {
  fireEvent.submit(document.querySelector("form")!);
}

afterEach(cleanup);

describe("ChannelFormDialog validation", () => {
  it("validates the name and webhook URL in the old order", () => {
    const onSave = vi.fn();
    render(() => (
      <ChannelFormDialog
        open
        channel={null}
        onOpenChange={() => {}}
        onSave={onSave}
      />
    ));

    submitForm();
    expect(screen.getByText("请填写渠道名称")).toBeTruthy();

    fireEvent.input(screen.getByLabelText(/^名称/), {
      target: { value: "值班钉钉群" },
    });
    submitForm();
    expect(screen.getByText("请填写 webhook URL")).toBeTruthy();

    fireEvent.input(screen.getByLabelText(/Webhook URL/), {
      target: { value: "not a url" },
    });
    submitForm();
    expect(screen.getByText("webhook URL 格式不正确")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("requires appId, appSecret and receiveId for feishu-app", () => {
    render(() => (
      <ChannelFormDialog
        open
        channel={null}
        onOpenChange={() => {}}
        onSave={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByLabelText(/^名称/), {
      target: { value: "飞书告警" },
    });
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "feishu-app" },
    });
    submitForm();
    expect(screen.getByText("请填写 App ID")).toBeTruthy();

    fireEvent.input(screen.getByLabelText(/App ID/), {
      target: { value: "cli_abc" },
    });
    submitForm();
    expect(screen.getByText("请填写 App Secret")).toBeTruthy();

    fireEvent.input(screen.getByLabelText(/App Secret/), {
      target: { value: "secret" },
    });
    submitForm();
    expect(screen.getByText("请填写 Receive ID")).toBeTruthy();
  });
});

describe("ChannelFormDialog payload", () => {
  it("submits a complete feishu-app channel", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(() => (
      <ChannelFormDialog
        open
        channel={null}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    ));

    fireEvent.input(screen.getByLabelText(/^名称/), {
      target: { value: " 飞书告警 " },
    });
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "feishu-app" },
    });
    fireEvent.input(screen.getByLabelText(/App ID/), {
      target: { value: "cli_abc" },
    });
    fireEvent.input(screen.getByLabelText(/App Secret/), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("接收类型"), {
      target: { value: "chat_id" },
    });
    fireEvent.input(screen.getByLabelText("Receive ID *"), {
      target: { value: "oc_chat" },
    });

    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(null, {
      name: "飞书告警",
      type: "feishu-app",
      enabled: true,
      appId: "cli_abc",
      appSecret: "secret",
      receiveId: "oc_chat",
      receiveIdType: "chat_id",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("clears a stored signing secret when the user asks for it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(() => (
      <ChannelFormDialog
        open
        channel={webhookChannel()}
        onOpenChange={() => {}}
        onSave={onSave}
      />
    ));

    fireEvent.click(screen.getByLabelText("清除已配置的签名"));
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toBe("ch-1");
    expect(onSave.mock.calls[0][1]).toMatchObject({
      name: "值班 Webhook",
      type: "webhook",
      url: "https://example.com/hook",
      secret: null,
    });
  });
});
