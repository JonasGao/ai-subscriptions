// Tag name validation, ported from lib/tags.ts. Kept free of SolidJS so the
// input and the form share one contract.

export const MAX_TAG_NAME_LENGTH = 30;
export const MAX_TAGS_PER_SUBSCRIPTION = 20;

export function normalizeTagName(value: string): string {
  return value.trim();
}

export function getTagNameError(value: string): string | null {
  const normalized = normalizeTagName(value);

  if (!normalized) {
    return "标签不能为空";
  }
  if (/[,，\r\n]/.test(normalized)) {
    return "标签不能包含中英文逗号或换行";
  }
  if (Array.from(normalized).length > MAX_TAG_NAME_LENGTH) {
    return `标签不能超过 ${MAX_TAG_NAME_LENGTH} 个字符`;
  }

  return null;
}
