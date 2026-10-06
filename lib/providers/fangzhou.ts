import { signVolcengineRequest } from "@/lib/volcengine-signer";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const LIST_MODELS_URL =
  "https://ark.cn-beijing.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01";

// Defensive limit to prevent infinite pagination loops
const MAX_ITEMS = 1000;
const DEFAULT_PAGE_SIZE = 100;

interface ListModelsResponse {
  ResponseMetadata?: {
    RequestId?: string;
    Action?: string;
  };
  Result?: {
    Items?: Array<{
      Name?: string;
      DisplayName?: string;
      Description?: string;
      VendorName?: string;
    }>;
    TotalCount?: number;
    PageNumber?: number;
    PageSize?: number;
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

  const allModels: string[] = [];
  let pageNumber = 1;
  let hasMore = true;

  while (hasMore && allModels.length < MAX_ITEMS) {
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

    for (const item of items) {
      if (item.Name && allModels.length < MAX_ITEMS) {
        allModels.push(item.Name);
      }
    }

    // Check if we've reached the end
    const totalCount = data.Result?.TotalCount ?? 0;
    if (allModels.length >= totalCount || items.length === 0) {
      hasMore = false;
    } else {
      pageNumber++;
    }
  }

  return allModels;
}
