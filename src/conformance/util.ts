export const CLICK_TIMEOUT_MS = 12_000;
export const PAGE_LOAD_TIMEOUT_MS = 30_000;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
