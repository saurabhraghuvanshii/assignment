// Playwright-assisted Rapido connect helper.
//
// Usage:
//   node scripts/rapido-connect-playwright.cjs --base-url=http://localhost:3000 --token=SIGNED_TOKEN
//
// Flow:
// 1. Launch a visible Chromium browser.
// 2. User logs into Rapido manually (OTP / phone flow).
// 3. Script waits until authenticated cookies are present for rapido.bike.
// 4. Script POSTs the captured cookie header to the app's completion endpoint.
// 5. Browser closes and the script exits.

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;
const RAPIDO_URL = "https://m.rapido.bike/my-rides";

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

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function mask(value) {
  if (!value) return "";
  return value.length <= 6 ? value : `...${value.slice(-6)}`;
}

function isRelevantDomain(domain) {
  const d = String(domain || "").toLowerCase();
  return d.includes("rapido.bike") || d.includes(".rapido");
}

async function getRapidoCookies(context) {
  const cookies = await context.cookies();
  return cookies.filter((cookie) => isRelevantDomain(cookie.domain));
}

function buildCookieHeader(cookies) {
  return cookies
    .filter(
      (cookie) => cookie && cookie.name && typeof cookie.value === "string",
    )
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function hasAuthenticatedSession(cookies, currentUrl) {
  if (!cookies || cookies.length === 0) return false;

  const lowerUrl = String(currentUrl || "").toLowerCase();
  const onAuthPage =
    lowerUrl.includes("/login") ||
    lowerUrl.includes("/signin") ||
    lowerUrl.includes("/signup") ||
    lowerUrl.includes("/otp");

  if (onAuthPage) return false;

  const cookieNames = new Set(
    cookies.map((cookie) => String(cookie.name || "").toLowerCase()),
  );

  const likelyAuthCookie =
    cookieNames.has("token") ||
    cookieNames.has("auth_token") ||
    cookieNames.has("access_token") ||
    cookieNames.has("sessionid") ||
    cookieNames.has("session_id") ||
    cookieNames.has("jwt") ||
    cookieNames.has("rapido_token");

  return likelyAuthCookie || cookies.length >= 2;
}

function looksLikeAuthPrompt(text) {
  const lower = String(text || "").toLowerCase();
  return (
    lower.includes("confirm your number") ||
    lower.includes("get an sms") ||
    lower.includes("verify otp") ||
    lower.includes("enter otp") ||
    lower.includes("login") ||
    lower.includes("sign in")
  );
}

function looksLikeRideHistoryPage(text, currentUrl) {
  const lower = String(text || "").toLowerCase();
  const lowerUrl = String(currentUrl || "").toLowerCase();

  if (looksLikeAuthPrompt(lower)) return false;

  const hasRideSignals =
    lower.includes("my rides") ||
    lower.includes("rapido") ||
    lower.includes("bike") ||
    lower.includes("auto") ||
    lower.includes("cab") ||
    lower.includes("₹") ||
    lower.includes("pm") ||
    lower.includes("am");

  return lowerUrl.includes("/my-rides") && hasRideSignals;
}

async function postCompletion(
  baseUrl,
  token,
  cookieHeader,
  historyUrl,
  storageState,
) {
  const res = await fetch(
    `${baseUrl}/api/integrations/rapido/playwright/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        cookieHeader,
        historyUrl,
        storageState,
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

  console.log("[Rapido Connect] Launching browser...");
  console.log(
    "[Rapido Connect] Complete your login in the opened Rapido window.",
  );
  console.log(
    "[Rapido Connect] This helper will capture the authenticated session automatically.",
  );

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
  });

  const page = await context.newPage();

  try {
    await page.goto(RAPIDO_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    console.log(`[Rapido Connect] Opened ${RAPIDO_URL}`);
    console.log(
      "[Rapido Connect] If login does not appear automatically, complete it manually in the opened page.",
    );

    const startedAt = Date.now();

    while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      const cookies = await getRapidoCookies(context);
      const currentUrl = page.url();

      if (hasAuthenticatedSession(cookies, currentUrl)) {
        const cookieHeader = buildCookieHeader(cookies);

        if (cookieHeader) {
          await page.goto(RAPIDO_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await page.waitForTimeout(2500);

          const bodyText = await page
            .locator("body")
            .innerText()
            .catch(() => "");
          const finalUrl = page.url();

          if (!looksLikeRideHistoryPage(bodyText, finalUrl)) {
            await sleep(POLL_INTERVAL_MS);
            continue;
          }

          const storageState = JSON.stringify(await context.storageState());

          console.log(
            `[Rapido Connect] Captured ${cookies.length} cookies. Cookie header tail: ${mask(cookieHeader)}`,
          );

          await postCompletion(
            baseUrl,
            token,
            cookieHeader,
            RAPIDO_URL,
            storageState,
          );
          console.log("[Rapido Connect] Session saved successfully.");
          await browser.close();
          process.exit(0);
        }
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      "Timed out waiting for Rapido to reach the real my-rides page. Please retry, complete login, and stay on the rides screen within 5 minutes.",
    );
  } catch (error) {
    console.error(
      "[Rapido Connect] Failed:",
      error && error.message ? error.message : error,
    );
    try {
      await browser.close();
    } catch {}
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "[Rapido Connect] Unhandled error:",
    error && error.message ? error.message : error,
  );
  process.exit(1);
});
