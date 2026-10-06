import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

/**
 * Generic pagination helper for providers that need to paginate through
 * a large list of items. Handles defensive limit to prevent infinite loops.
 *
 * @param fetchPage - Function that fetches a single page and returns { items, hasMore }
 *                    Receives the current page number and total items collected so far.
 * @param maxItems - Defensive limit (default 1000)
 * @returns Array of all items collected across pages
 */
export async function paginateAll<T>(
  fetchPage: (
    pageNumber: number,
    totalCollected: number
  ) => Promise<{ items: T[]; hasMore: boolean }> | { items: T[]; hasMore: boolean },
  maxItems: number = 1000
): Promise<T[]> {
  const allItems: T[] = [];
  let pageNumber = 1;
  let hasMore = true;

  while (hasMore && allItems.length < maxItems) {
    const result = await fetchPage(pageNumber, allItems.length);
    const items = result.items;

    for (const item of items) {
      if (allItems.length < maxItems) {
        allItems.push(item);
      }
    }

    hasMore = result.hasMore;
    pageNumber++;
  }

  return allItems;
}

/**
 * Helper for fetch-based pagination that handles the HTTP request.
 * Similar to paginateAll but includes the fetch logic.
 */
export async function paginateFetch<T>(
  urlBuilder: (pageNumber: number) => string,
  parseResponse: (data: unknown) => { items: T[]; hasMore: boolean },
  requestInit: RequestInit,
  maxItems: number = 1000
): Promise<T[]> {
  return paginateAll(
    async (pageNumber) => {
      const url = urlBuilder(pageNumber);
      const response = await fetchWithTimeout(
        url,
        requestInit,
        DEFAULT_TIMEOUT
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Pagination API error:", response.status, errorText);
        throw new Error(`Pagination API returned ${response.status}`);
      }

      const data = await response.json();
      return parseResponse(data);
    },
    maxItems
  );
}
