// Solid port of components/ToolForm.tsx (#35): create/edit a managed tool.

import {
  Show,
  createEffect,
  createSignal,
  For,
  type Component,
} from "solid-js";
import { defaultCategories } from "../subscriptions/types";
import { createDialogFocus } from "../lib/dialogFocus";
import {
  allowedToolForms,
  type Tool,
  type ToolFormData,
  type ToolStatus,
} from "./types";

interface ToolFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool?: Tool | null;
  categories: string[];
  providers: { id: string; name: string }[];
  onSubmit: (data: ToolFormData) => Promise<boolean> | boolean;
}

function emptyForm(category: string): ToolFormData {
  return {
    name: "",
    category,
    provider: "other",
    providerCustom: "",
    forms: [],
    isOpenSource: false,
    repoUrl: "",
    status: "active",
    notes: "",
  };
}

function isValidHTTPURL(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** ToolForm mirrors the old dialog's fields and validation. */
export const ToolForm: Component<ToolFormProps> = (props) => {
  const [formData, setFormData] = createSignal<ToolFormData>(
    emptyForm(defaultCategories[0] ?? "")
  );
  const [urlError, setUrlError] = createSignal("");
  const categories = () =>
    props.categories.length ? props.categories : defaultCategories;

  createEffect(() => {
    const tool = props.tool;
    setUrlError("");
    if (!tool) {
      setFormData(emptyForm(categories()[0] ?? defaultCategories[0] ?? ""));
      return;
    }
    setFormData({
      name: tool.name,
      category: tool.category,
      provider: tool.provider || "other",
      providerCustom: tool.providerCustom || "",
      forms: tool.forms || [],
      isOpenSource: tool.isOpenSource || false,
      repoUrl: tool.repoUrl || "",
      status: tool.status || "active",
      notes: tool.notes || "",
    });
  });

  const patch = (values: Partial<ToolFormData>) =>
    setFormData((previous) => ({ ...previous, ...values }));

  const showCustomProvider = () => formData().provider === "other";

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    const data = formData();
    if (!data.name.trim()) return;
    if (data.repoUrl && !isValidHTTPURL(data.repoUrl)) {
      setUrlError("仓库地址必须是有效的 HTTP 或 HTTPS URL");
      return;
    }
    const saved = await props.onSubmit({
      ...data,
      name: data.name.trim(),
      category: data.category.trim(),
      provider: data.provider.trim(),
      providerCustom: data.providerCustom?.trim() || undefined,
      repoUrl: data.repoUrl?.trim() || undefined,
      notes: data.notes?.trim() || undefined,
    });
    if (saved) props.onOpenChange(false);
  };

  const toggleForm = (form: string) => {
    const forms = formData().forms;
    patch({
      forms: forms.includes(form)
        ? forms.filter((item) => item !== form)
        : [...forms, form],
    });
  };

  const dialogFocus = createDialogFocus(() => props.onOpenChange(false));

  return (
    <Show when={props.open}>
      <div class="dialog-backdrop" role="presentation">
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          ref={dialogFocus.ref}
          onKeyDown={dialogFocus.onKeyDown}
        >
          <h2>{props.tool ? "编辑工具" : "添加工具"}</h2>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <div class="form-grid">
              <label for="tool-name">
                <span>名称 *</span>
                <input
                  id="tool-name"
                  value={formData().name}
                  onInput={(event) =>
                    patch({ name: event.currentTarget.value })
                  }
                  placeholder="输入工具名称"
                  required
                  autocomplete="off"
                />
              </label>

              <label for="tool-category">
                <span>分类 *</span>
                <select
                  id="tool-category"
                  value={formData().category}
                  onChange={(event) =>
                    patch({ category: event.currentTarget.value })
                  }
                >
                  <For each={categories()}>
                    {(category) => <option value={category}>{category}</option>}
                  </For>
                </select>
              </label>

              <label for="tool-provider">
                <span>提供商 *</span>
                <select
                  id="tool-provider"
                  value={formData().provider}
                  onChange={(event) =>
                    patch({ provider: event.currentTarget.value })
                  }
                >
                  <For each={props.providers}>
                    {(provider) => (
                      <option value={provider.id}>{provider.name}</option>
                    )}
                  </For>
                  <Show
                    when={
                      !props.providers.some(
                        (provider) => provider.id === "other"
                      )
                    }
                  >
                    <option value="other">其他</option>
                  </Show>
                </select>
              </label>

              <Show when={showCustomProvider()}>
                <label for="tool-provider-custom">
                  <span>自定义提供商名称 *</span>
                  <input
                    id="tool-provider-custom"
                    value={formData().providerCustom ?? ""}
                    onInput={(event) =>
                      patch({ providerCustom: event.currentTarget.value })
                    }
                    required
                    autocomplete="off"
                  />
                </label>
              </Show>

              <div class="form-field-wide">
                <span>工具形式</span>
                <div class="checkbox-row">
                  <For each={allowedToolForms}>
                    {(form) => (
                      <label class="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={formData().forms.includes(form)}
                          onChange={() => toggleForm(form)}
                        />
                        {form}
                      </label>
                    )}
                  </For>
                </div>
              </div>

              <label class="checkbox-chip">
                <input
                  type="checkbox"
                  checked={formData().isOpenSource}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    patch({
                      isOpenSource: checked,
                      repoUrl: checked ? formData().repoUrl : "",
                    });
                  }}
                />
                <span>开源工具</span>
              </label>

              <Show when={formData().isOpenSource}>
                <label for="tool-repo-url">
                  <span>仓库地址</span>
                  <input
                    id="tool-repo-url"
                    value={formData().repoUrl ?? ""}
                    onInput={(event) => {
                      patch({ repoUrl: event.currentTarget.value });
                      setUrlError("");
                    }}
                    placeholder="https://github.com/user/repo"
                    autocomplete="off"
                  />
                  <Show when={urlError()}>
                    <span class="form-error">{urlError()}</span>
                  </Show>
                </label>
              </Show>

              <label for="tool-status">
                <span>状态</span>
                <select
                  id="tool-status"
                  value={formData().status}
                  onChange={(event) =>
                    patch({ status: event.currentTarget.value as ToolStatus })
                  }
                >
                  <option value="active">活跃</option>
                  <option value="paused">暂停</option>
                  <option value="cancelled">已取消</option>
                </select>
              </label>

              <label for="tool-notes">
                <span>备注</span>
                <input
                  id="tool-notes"
                  value={formData().notes ?? ""}
                  onInput={(event) =>
                    patch({ notes: event.currentTarget.value })
                  }
                  placeholder="输入备注信息"
                  autocomplete="off"
                />
              </label>
            </div>

            <div class="form-actions">
              <button
                type="button"
                class="ghost"
                onClick={() => props.onOpenChange(false)}
              >
                取消
              </button>
              <button type="submit">{props.tool ? "保存" : "添加"}</button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
