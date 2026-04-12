#!/usr/bin/env bun
/**
 * ntui — notebook-tui CLI
 *
 * Global entry point for editing and rendering Jupyter notebooks in the terminal.
 */

import { resolve, join, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "..");
const VERSION = "0.1.0";

// ── Help ───────────────────────────────────────────────────────────

const HELP = `
  ntui — terminal notebook editor & video renderer

  Usage:
    ntui <notebook.ipynb> [options]       Open notebook in terminal editor
    ntui render [options]                 Render notebook to video
    ntui init                             Create a render.yaml template
    ntui -h, --help                       Show this help
    ntui -v, --version                    Show version

  Editor:
    ntui <notebook.ipynb>                 Open notebook for editing
    ntui notebook.ipynb --venv .venv      Use specific virtual environment
    ntui notebook.ipynb --python python3  Use specific Python interpreter

    Editor options:
      --python <path>       Python interpreter path
      --venv <path>         Virtual environment path (default: ./.venv)
      --theme <name>        Color theme (default: monokai)

    Keybindings (in editor):
      Shift+Enter / r       Run focused cell
      j/k                   Move between cells
      i                     Enter insert mode
      Escape                Return to normal mode
      Shift+M               Toggle cell type (code/markdown)
      o/O                   Insert cell below/above
      :w                    Save notebook
      :q                    Quit

  Render:
    ntui render <notebook.ipynb>                         Render notebook to video
    ntui render notebook.ipynb -o out.mp4                Render with custom output
    ntui render notebook.ipynb --template template.yaml  Render with template settings

    Render options:
      -o, --output <path>   Output video path (default: out/video.mp4)
      --template <path>     Load render settings from YAML template
      --animation <mode>    char | word | line | block | present (default: char)
      --font-size, --font_size <n>
                            Base font size in px (default: 16)
      --max-output-lines <n>
                           Truncate rendered outputs after N wrapped lines (default: 10)
      --collapse-code-cells-over <n>
                           Collapse past code cells longer than N lines (default: 5)
      --quality <preset>    sd | hd | 4k (default: hd)
      --aspect <ratio>      horizontal | vertical | square (default: horizontal)
      --force, -f           Re-execute notebook (ignore cache)
      --python <path>       Python interpreter path
      --venv <path>         Virtual environment path (default: ./.venv)
      --fps <n>             Frames per second (default: 30)
      --width <n>           Custom width (overrides quality/aspect)
      --height <n>          Custom height (overrides quality/aspect)

    Resolution presets:
      sd   horizontal  854x480     vertical  480x854     square  640x640
      hd   horizontal  1920x1080   vertical  1080x1920   square  1080x1080
      4k   horizontal  3840x2160   vertical  2160x3840   square  2160x2160

  Init:
    ntui init                             Create render.yaml in current directory
    ntui init my-render.yaml              Create template at custom path

  Python resolution:
    By default, ntui looks for .venv/bin/python in the current directory.
    Use --venv or --python to override.

  Examples:
    ntui analysis.ipynb
    ntui render analysis.ipynb --animation line --venv .venv
    ntui render analysis.ipynb -o out.mp4 --template template.yaml
    ntui init && vim render.yaml && ntui render notebook.ipynb --template render.yaml
`;

// ── Dispatch ───────────────────────────────────────────────────────

async function main() {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(HELP);
    process.exit(0);
  }

  if (args[0] === "-v" || args[0] === "--version") {
    console.log(`ntui ${VERSION}`);
    process.exit(0);
  }

  const command = args[0]!;

  // ntui init [path]
  if (command === "init") {
    const initScript = join(ROOT, "src", "init-template.ts");
    const proc = Bun.spawn(["bun", "run", initScript, ...args.slice(1)], {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await proc.exited);
  }

  // ntui render [...]
  if (command === "render") {
    const renderScript = join(ROOT, "src", "render-video.ts");
    const proc = Bun.spawn(["bun", "run", renderScript, ...args.slice(1)], {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await proc.exited);
  }

  // ntui <notebook.ipynb> [...] — open editor
  if (command.startsWith("-")) {
    console.error(`  Unknown flag: ${command}`);
    console.error(`  Run: ntui --help`);
    process.exit(1);
  }

  // Editor needs full TTY passthrough
  const editorScript = join(ROOT, "src", "index.tsx");
  const proc = Bun.spawn(["bun", "run", editorScript, ...args], {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  process.exit(await proc.exited);
}

main();
