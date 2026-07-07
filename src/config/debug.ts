export const DEBUG_SEARCH_TRACE_STORAGE_KEY = 'debugSearchTrace';

export async function isSearchTraceEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(DEBUG_SEARCH_TRACE_STORAGE_KEY);
  return stored[DEBUG_SEARCH_TRACE_STORAGE_KEY] === true;
}

export async function setSearchTraceEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [DEBUG_SEARCH_TRACE_STORAGE_KEY]: enabled });
}
