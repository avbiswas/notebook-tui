#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const NTUI_PACKAGE_SPEC = process.env.NTUI_PACKAGE_SPEC || "notebook-tui@latest";
const NTUI_PACKAGE_NAME = process.env.NTUI_PACKAGE_NAME || "notebook-tui";
const SKILLS_CLI_SPEC = process.env.NTUI_SKILLS_CLI_SPEC || "skills@latest";
const SKILLS_AGENT = process.env.NTUI_SKILLS_AGENT || "codex";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout.trim();
}

function has(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

console.log(`Installing ${NTUI_PACKAGE_SPEC}...`);
run("npm", ["install", "-g", NTUI_PACKAGE_SPEC]);

const globalRoot = capture("npm", ["root", "-g"]);
const packageRoot = join(globalRoot, NTUI_PACKAGE_NAME);
const agentsDir = join(packageRoot, "AGENTS");

if (!has("bun")) {
  console.warn("Bun was not found on PATH. `ntui` is a Bun CLI, so install Bun before running it.");
}

if (existsSync(agentsDir)) {
  console.log("Installing bundled ntui skills...");
  run("npx", ["--yes", SKILLS_CLI_SPEC, "add", agentsDir, "-a", SKILLS_AGENT, "-y"]);
} else {
  console.warn(`No AGENTS directory found at ${agentsDir}. Skipping skill installation.`);
}

console.log("");
console.log("Installed:");
console.log("  - ntui");
console.log("  - bundled ntui agent skills");
console.log("");
console.log("Next:");
console.log("  ntui --help");
