import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { auth } from "@/lib/auth";
import { createRapidoPlaywrightToken } from "@/lib/integrations/rapido-playwright-token";

export const dynamic = "force-dynamic";

function getBaseUrl(req: Request): string {
  const envUrl =
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL;

  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  const url = new URL(req.url);
  return url.origin.replace(/\/+$/, "");
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const baseUrl = getBaseUrl(req);
    const token = createRapidoPlaywrightToken(userId);
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "rapido-connect-playwright.cjs",
    );
    const logsDir = path.join(process.cwd(), ".logs");
    const logPath = path.join(logsDir, "rapido-playwright.log");

    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(
      logPath,
      `\n[${new Date().toISOString()}] Starting Rapido Playwright connect flow for user ${userId}\n`,
    );

    const logFd = fs.openSync(logPath, "a");

    const child = spawn(
      process.execPath,
      [scriptPath, `--base-url=${baseUrl}`, `--token=${token}`],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: {
          ...process.env,
        },
      },
    );

    child.on("error", (spawnError) => {
      try {
        fs.appendFileSync(
          logPath,
          `[${new Date().toISOString()}] Failed to spawn Rapido Playwright helper: ${
            spawnError instanceof Error
              ? spawnError.message
              : String(spawnError)
          }\n`,
        );
      } catch {
        // ignore log write failures
      }
    });

    if (!child.pid) {
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] Rapido Playwright helper failed to start: no child pid\n`,
      );
      fs.closeSync(logFd);

      return NextResponse.json(
        {
          error: "Failed to launch Rapido browser helper process",
          logPath,
        },
        { status: 500 },
      );
    }

    child.unref();
    fs.closeSync(logFd);

    return NextResponse.json({
      success: true,
      message:
        "Launching browser for Rapido login. Complete login in the opened window and return here once it closes.",
      pid: child.pid,
      logPath,
    });
  } catch (error) {
    console.error("Failed to start Rapido Playwright connect flow:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to launch Rapido browser login flow",
      },
      { status: 500 },
    );
  }
}
