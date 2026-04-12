/**
 * Initialize a render template YAML file.
 *
 * Usage:
 *   bun run src/init-template.ts [output-path]
 *
 * Default output: ./render.yaml
 */

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const TEMPLATE = `# notebook-tui render template
# Usage: ntui render notebook.ipynb -o out.mp4 --template template.yaml

# ─── Animation ───────────────────────────────────────────────────────

# How code appears in cells:
#   char    - character by character (typewriter effect)
#   word    - word by word
#   line    - line by line
#   block   - entire cell appears at once on focus
#   present - all code is visible from the start
animation: char

# ─── Video ───────────────────────────────────────────────────────────

# Resolution preset: sd | hd | 4k (default: hd)
quality: hd

# Aspect ratio: horizontal | vertical | square (default: horizontal)
aspect: horizontal

#   Preset table:
#     sd   horizontal  854x480     vertical  480x854     square  640x640
#     hd   horizontal  1920x1080   vertical  1080x1920   square  1080x1080
#     4k   horizontal  3840x2160   vertical  2160x3840   square  2160x2160

# Frames per second
# fps: 30

# Custom resolution (overrides quality/aspect presets)
# width: 1920
# height: 1080

# ─── Font ────────────────────────────────────────────────────────────

# Base font size in pixels (default: 16)
# fontSize: 16

# ─── Python ──────────────────────────────────────────────────────────

# Python interpreter path (auto-detected if omitted)
# python: /usr/bin/python3

# Virtual environment path (auto-detected if omitted)
# venv: .venv

# ─── Cache ───────────────────────────────────────────────────────────

# Force re-execution of notebook (ignores cache)
# force: false
`;

function main() {
  const arg = Bun.argv[2];
  const outputPath = arg
    ? (isAbsolute(arg) ? arg : join(process.cwd(), arg))
    : join(process.cwd(), "render.yaml");

  if (existsSync(outputPath)) {
    console.error(`  File already exists: ${outputPath}`);
    console.error(`  Delete it first or choose a different path.`);
    process.exit(1);
  }

  Bun.write(outputPath, TEMPLATE);
  console.log(`  Created render template: ${outputPath}`);
  console.log(`  Edit the file, then run: ntui render notebook.ipynb --template ${outputPath}`);
}

main();
