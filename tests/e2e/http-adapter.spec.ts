import { test, expect } from "@playwright/test";

test("direct vs proxied fetch and XHR hit the same service worker", async ({
  page,
}) => {
  await page.goto("/http-adapter-host.test.html");

  await page.waitForFunction(() => (window as any).__hostReady === true, null, {
    timeout: 20000,
  });

  const appFrameHandle = await page.waitForSelector("#app-frame");
  const appFrame = await appFrameHandle.contentFrame();
  if (!appFrame) {
    throw new Error("App iframe did not load");
  }
  const fetchPayload = { id: `fetch-${Date.now()}`, value: 42 };
  const xhrPayload = { id: `xhr-${Date.now()}`, value: 7 };

  const directResult = await appFrame.evaluate(
    (body) => (window as any).__runScenario("fetch", "direct", body),
    fetchPayload,
  );

  await page.waitForFunction(
    () => (window as any).__mswRequests?.length >= 1,
    null,
    { timeout: 10000 },
  );

  const directLog = await page.evaluate(() => {
    const logs = (window as any).__mswRequests as Array<any>;
    return logs[logs.length - 1];
  });

  const proxyResult = await appFrame.evaluate(
    (body) => (window as any).__runScenario("fetch", "proxy", body),
    fetchPayload,
  );

  await page.waitForFunction(
    () => (window as any).__mswRequests?.length >= 2,
    null,
    { timeout: 10000 },
  );

  const proxyLog = await page.evaluate(() => {
    const logs = (window as any).__mswRequests as Array<any>;
    return logs[logs.length - 1];
  });

  expect(directResult.status).toBe(200);
  expect(proxyResult.status).toBe(200);
  expect(directResult.json).toEqual(proxyResult.json);

  expect(directLog.method).toBe("POST");
  expect(proxyLog.method).toBe("POST");
  expect(directLog.url).toBe("/api/echo");
  expect(proxyLog.url).toBe("/api/echo");
  expect(directLog.body).toBe(JSON.stringify(fetchPayload));
  expect(proxyLog.body).toBe(JSON.stringify(fetchPayload));
  expect(directLog.headers["x-test-id"]).toBe(fetchPayload.id);
  expect(proxyLog.headers["x-test-id"]).toBe(fetchPayload.id);

  const directXhrResult = await appFrame.evaluate(
    (body) => (window as any).__runScenario("xhr", "direct", body),
    xhrPayload,
  );

  await page.waitForFunction(
    () => (window as any).__mswRequests?.length >= 3,
    null,
    { timeout: 10000 },
  );

  const directXhrLog = await page.evaluate(() => {
    const logs = (window as any).__mswRequests as Array<any>;
    return logs[logs.length - 1];
  });

  const proxyXhrResult = await appFrame.evaluate(
    (body) => (window as any).__runScenario("xhr", "proxy", body),
    xhrPayload,
  );

  await page.waitForFunction(
    () => (window as any).__mswRequests?.length >= 4,
    null,
    { timeout: 10000 },
  );

  const proxyXhrLog = await page.evaluate(() => {
    const logs = (window as any).__mswRequests as Array<any>;
    return logs[logs.length - 1];
  });

  expect(directXhrResult.status).toBe(200);
  expect(proxyXhrResult.status).toBe(200);
  expect(directXhrResult.json).toEqual(proxyXhrResult.json);

  expect(directXhrLog.method).toBe("POST");
  expect(proxyXhrLog.method).toBe("POST");
  expect(directXhrLog.url).toBe("/api/echo");
  expect(proxyXhrLog.url).toBe("/api/echo");
  expect(directXhrLog.body).toBe(JSON.stringify(xhrPayload));
  expect(proxyXhrLog.body).toBe(JSON.stringify(xhrPayload));
  expect(directXhrLog.headers["x-test-id"]).toBe(xhrPayload.id);
  expect(proxyXhrLog.headers["x-test-id"]).toBe(xhrPayload.id);
});
