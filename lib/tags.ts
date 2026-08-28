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

export function validateTagName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Tag name must be a string");
  }

  const error = getTagNameError(value);
  if (error) {
    throw new Error(error);
  }

  return normalizeTagName(value);
}

export function validateTagNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("tagNames must be an array");
  }

  const uniqueNames: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const name = validateTagName(item);
    if (!seen.has(name)) {
      seen.add(name);
      uniqueNames.push(name);
    }
  }

  if (uniqueNames.length > MAX_TAGS_PER_SUBSCRIPTION) {
    throw new Error(`每个订阅最多添加 ${MAX_TAGS_PER_SUBSCRIPTION} 个标签`);
  }

  return uniqueNames;
}
