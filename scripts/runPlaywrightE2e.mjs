import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findFreePort(start = 4173) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(start, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : start;
      server.close(() => resolve(port));
    });
  });
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

const port = await findFreePort(4173);
const baseUrl = `http://127.0.0.1:${port}`;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const preview = spawn(
  npm,
  ["run", "preview:e2e", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);

try {
  await waitForUrl(baseUrl);
  await run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["playwright", "test"],
    {
      ...process.env,
      CI: "1",
      E2E_PREVIEW_PORT: String(port),
      E2E_MANAGED_PREVIEW: "1",
    },
  );
} finally {
  if (!preview.killed) preview.kill("SIGTERM");
}