import { signVolcengineRequest } from "@/lib/volcengine-signer";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";
import { paginateAll } from "./pagination";

const LIST_MODELS_URL =
  "https://ark.cn-beijing.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01";

// Defensive limit to prevent infinite pagination loops
const MAX_ITEMS = 1000;
const DEFAULT_PAGE_SIZE = 100;

interface ListModelsResponse {
  Result?: {
    Items?: Array<{
      Name?: string;
    }>;
    TotalCount?: number;
  };
}

/**
 * Fetch the list of available models from Volcengine Ark (Fangzhou).
 * Uses V4 signature with AK/SK credentials and paginates through all
 * available models using PageNumber/PageSize.
 * Defensive limit of 1000 items prevents infinite loops.
 */
export async function fetchFangzhouModels(
  credentials: Record<string, string>
): Promise<string[]> {
  const { ak, sk } = credentials;
  if (!ak || !sk) throw new Error("AK/SK not configured");

  return paginateAll<string>(async (pageNumber, totalCollected) => {
    const url = `${LIST_MODELS_URL}&PageNumber=${pageNumber}&PageSize=${DEFAULT_PAGE_SIZE}`;
    const body = JSON.stringify({});

    const headers = signVolcengineRequest({
      method: "GET",
      url,
      body,
      ak,
      sk,
    });

    const response = await fetchWithTimeout(
      url,
      { method: "GET", headers },
      DEFAULT_TIMEOUT
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "ListFoundationModels API error:",
        response.status,
        errorText
      );
      throw new Error(`ListFoundationModels API returned ${response.status}`);
    }

    const data = (await response.json()) as ListModelsResponse;
    const items = data.Result?.Items ?? [];
    const names = items.map((item) => item.Name).filter((n): n is string => !!n);

    const totalCount = data.Result?.TotalCount ?? 0;
    // Continue if we haven't reached totalCount AND we got items
    const hasMore = totalCollected + names.length < totalCount && items.length > 0;

    return { items: names, hasMore };
  }, MAX_ITEMS);
}
