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

const port = Number(process.env.E2E_PREVIEW_PORT) || await findFreePort(4173);
process.stdout.write(`${port}\n`);

const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "preview:e2e", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    cwd: root,
    env: { ...process.env, E2E_PREVIEW_PORT: String(port) },
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

const shutdown = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));