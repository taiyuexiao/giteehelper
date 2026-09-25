#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (existsSync(new URL("../dist/cli/index.js", import.meta.url))) {
  const result = spawnSync(process.execPath, [new URL("../dist/cli/index.js", import.meta.url).pathname, ...args], {
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}
const result = spawnSync(process.execPath, [new URL("../node_modules/.bin/tsx", import.meta.url).pathname, new URL("../src/cli/index.ts", import.meta.url).pathname, ...args], {
  stdio: "inherit"
});
process.exit(result.status ?? 1);
