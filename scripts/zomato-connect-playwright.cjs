// Playwright-assisted Zomato connect helper.
//
// Usage:
//   node scripts/zomato-connect-playwright.cjs --base-url=http://localhost:3000 --token=SIGNED_TOKEN
//
// Flow:
// 1. Launch a visible Chromium browser.
// 2. User logs into Zomato manually (OTP / phone flow).
// 3. Script waits until required cookies are present: cid, PHPSESSID, zat.
// 4. Script POSTs those cookies to the app's completion endpoint.
// 5. Browser closes and the script exits.

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");

const REQUIRED_COOKIES = ["cid", "PHPSESSID", "zat"];
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      out[arg.slice(2)] = "true";
    } else {
      const key = arg.slice(2, eqIndex);
      const value = arg.slice(eqIndex + 1);
      out[key] = value;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mask(value) {
  if (!value) return "";
  return value.length <= 4 ? value : `…${value.slice(-4)}`;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

async function getRelevantCookies(context) {
  const cookies = await context.cookies();
  const map = new Map();

  for (const cookie of cookies) {
    const domain = String(cookie.domain || "");
    if (!domain.includes("zomato")) continue;
    if (REQUIRED_COOKIES.includes(cookie.name)) {
      map.set(cookie.name, cookie.value);
    }
  }

  return {
    cid: map.get("cid") || "",
    PHPSESSID: map.get("PHPSESSID") || "",
    zat: map.get("zat") || "",
    user_city_ids: map.get("user_city_ids") || "",
  };
}

function hasAllCookies(cookies) {
  return REQUIRED_COOKIES.every((key) => Boolean(cookies[key]));
}

async function postCompletion(baseUrl, token, cookies) {
  const res = await fetch(
    `${baseUrl}/api/integrations/zomato/playwright/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        cid: cookies.cid,
        PHPSESSID: cookies.PHPSESSID,
        zat: cookies.zat,
        user_city_ids: cookies.user_city_ids,
      }),
    },
  );

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok || !data || !data.success) {
    const message =
      (data && (data.error || data.message)) ||
      `Completion request failed with status ${res.status}`;
    throw new Error(message);
  }

  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args["base-url"]);
  const token = String(args.token || "").trim();

  if (!baseUrl) {
    throw new Error("Missing required argument: --base-url");
  }

  if (!token) {
    throw new Error("Missing required argument: --token");
  }

  console.log("[Zomato Connect] Launching browser...");
  console.log(
    "[Zomato Connect] Complete your login in the opened Zomato window.",
  );
  console.log(
    "[Zomato Connect] This helper will automatically capture the session once login succeeds.",
  );

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  try {
    await page.goto("https://www.zomato.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    console.log("[Zomato Connect] Opened https://www.zomato.com/");
    console.log(
      "[Zomato Connect] If login does not appear automatically, click Sign in and complete OTP.",
    );

    const startedAt = Date.now();

    while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      const cookies = await getRelevantCookies(context);

      if (hasAllCookies(cookies)) {
        console.log(
          `[Zomato Connect] Captured cookies: cid ${mask(cookies.cid)}, PHPSESSID ${mask(
            cookies.PHPSESSID,
          )}, zat ${mask(cookies.zat)}, user_city_ids ${mask(cookies.user_city_ids)}`,
        );

        await postCompletion(baseUrl, token, cookies);
        console.log("[Zomato Connect] Session saved successfully.");
        await browser.close();
        process.exit(0);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      "Timed out waiting for Zomato login cookies. Please retry and complete login within 5 minutes.",
    );
  } catch (error) {
    console.error(
      "[Zomato Connect] Failed:",
      error && error.message ? error.message : error,
    );
    try {
      await browser.close();
    } catch { }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "[Zomato Connect] Unhandled error:",
    error && error.message ? error.message : error,
  );
  process.exit(1);
});
