#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const NTUI_PACKAGE_SPEC = process.env.NTUI_PACKAGE_SPEC || "notebook-tui@latest";
const NTUI_PACKAGE_NAME = process.env.NTUI_PACKAGE_NAME || "notebook-tui";
const SKILLS_CLI_SPEC = process.env.NTUI_SKILLS_CLI_SPEC || "skills@latest";

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

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

console.log(`Installing ${NTUI_PACKAGE_SPEC}...`);
run("npm", ["install", "-g", NTUI_PACKAGE_SPEC]);

const globalRoot = capture("npm", ["root", "-g"]);
const packageRoot = join(globalRoot, NTUI_PACKAGE_NAME);
const agentsDir = join(packageRoot, "AGENTS");

if (!has("bun")) {
  console.warn("\nBun was not found on PATH. `ntui` is a Bun CLI, so install Bun before running it.");
}

let skillsInstalled = false;

if (existsSync(agentsDir)) {
  console.log("");
  console.log("notebook-tui ships with agent skills (SKILL.md files) that help");
  console.log("AI coding agents work with notebooks more effectively.");
  console.log("");

  const installSkills = await ask("Install agent skills? (Y/n) ");

  if (installSkills === "" || installSkills === "y" || installSkills === "yes") {
    console.log("");
    // Let the skills CLI handle agent selection interactively
    run("npx", ["--yes", SKILLS_CLI_SPEC, "add", agentsDir]);
    skillsInstalled = true;
  } else {
    console.log("Skipping skill installation.");
  }
}

console.log("");
console.log("Installed:");
console.log("  - ntui CLI (global)");
if (skillsInstalled) {
  console.log("  - bundled agent skills");
}
console.log("");
console.log("Next:");
console.log("  ntui --help");
