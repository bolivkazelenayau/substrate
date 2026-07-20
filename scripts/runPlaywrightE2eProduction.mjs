import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function findFreePort(start = 4173, attempts = 32) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    const candidate = start + index;
    try {
      const port = await new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on("error", reject);
        server.listen(candidate, "127.0.0.1", () => {
          const address = server.address();
          const bound = typeof address === "object" && address ? address.port : candidate;
          server.close(() => resolve(bound));
        });
      });
      return port;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`No free preview port found from ${start}`);
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

// Build the production bundle first so the preview server serves it.
const traceBuild = process.env.VITE_SUBSTRATE_TRACE === "1";
const buildCommand = traceBuild ? "build:trace" : "build";
await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", buildCommand]);

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
    ["playwright", "test", "e2e/geometry-authority.production.spec.ts"],
    {
      ...process.env,
      CI: "1",
      E2E_PREVIEW_PORT: String(port),
      E2E_MANAGED_PREVIEW: "1",
    },
  );
} finally {
  if (!preview.killed) {
    // Windows does not support SIGTERM; default kill signal works reliably.
    preview.kill(process.platform === "win32" ? undefined : "SIGTERM");
  }
}
