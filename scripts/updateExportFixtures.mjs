import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const vitest = resolve("node_modules/vitest/vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitest, "run", "tests/exportGolden.test.ts", "--disableConsoleIntercept"],
  {
    env: { ...process.env, UPDATE_EXPORT_FIXTURES: "1" },
    stdio: "inherit",
  },
);

process.exitCode = result.status ?? 1;
