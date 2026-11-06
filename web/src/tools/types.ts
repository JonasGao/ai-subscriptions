// Wire types for the managed-tool catalog (#35). The shapes are the old
// stack's lib/types.ts verbatim — they are the API contract.

export type ToolStatus = "active" | "paused" | "cancelled";
export type ToolFormType = "CLI / TUI" | "GUI" | "Web";

/** allowedToolForms mirrors lib/types.ts allowedToolForms. */
export const allowedToolForms: ToolFormType[] = ["CLI / TUI", "GUI", "Web"];

export interface Tool {
  id: string;
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  forms: string[];
  order: number;
  isOpenSource: boolean;
  repoUrl?: string;
  status: ToolStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** ToolFormData is what the create/edit form submits. */
export interface ToolFormData {
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  forms: string[];
  isOpenSource: boolean;
  repoUrl?: string;
  status: ToolStatus;
  notes?: string;
}
