#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const remotionDir = join(root, "remotion");
const remotionMarker = join(remotionDir, "node_modules", "remotion", "package.json");

if (existsSync(remotionMarker)) {
  process.exit(0);
}

const installers = [
  ["bun", ["install"]],
  ["npm", ["install", "--no-fund", "--no-audit"]],
];

for (const [command, args] of installers) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (probe.status !== 0) {
    continue;
  }

  const result = spawnSync(command, args, {
    cwd: remotionDir,
    stdio: "inherit",
  });

  process.exit(result.status ?? 1);
}

console.warn("ntui: could not install Remotion dependencies automatically. Run `bun install` or `npm install` inside the package's remotion directory.");
