/**
 * Unified notebook-to-video renderer.
 *
 * Usage:
 *   bun run video [render.yaml]           — render from template (default: ./render.yaml)
 *   bun run video <notebook.ipynb> [opts] — render with CLI args
 *
 * CLI options override template values. See `bun run init-template` to create a template.
 */

import { createHash } from "node:crypto";
import { isAbsolute, join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { captureTimeline, type AnimationMode } from "./capture";

const ROOT = resolve(import.meta.dir, "..");
const REMOTION_DIR = join(ROOT, "remotion");
const CACHE_DIR = join(ROOT, ".cache");
const PROPS_PATH = join(REMOTION_DIR, "public", "timeline.json");
const REMOTION_BIN = join(REMOTION_DIR, "node_modules", ".bin", "remotion");

const ANIMATION_MODES = ["char", "word", "line", "block", "present"] as const;

// ── Presets ────────────────────────────────────────────────────────

type Quality = "sd" | "hd" | "4k";
type Aspect = "horizontal" | "vertical" | "square";

const RESOLUTIONS: Record<Quality, Record<Aspect, [number, number]>> = {
  sd: {
    horizontal: [854, 480],
    vertical:   [480, 854],
    square:     [640, 640],
  },
  hd: {
    horizontal: [1920, 1080],
    vertical:   [1080, 1920],
    square:     [1080, 1080],
  },
  "4k": {
    horizontal: [3840, 2160],
    vertical:   [2160, 3840],
    square:     [2160, 2160],
  },
};

function resolveResolution(
  quality?: string,
  aspect?: string,
  explicitWidth?: number,
  explicitHeight?: number,
): [number, number] {
  // Explicit width/height takes priority
  if (explicitWidth && explicitHeight) return [explicitWidth, explicitHeight];

  const q = (quality ?? "hd") as Quality;
  const a = (aspect ?? "horizontal") as Aspect;

  if (!(q in RESOLUTIONS)) {
    console.error(`  Unknown quality: ${q}. Use: sd, hd, 4k`);
    process.exit(1);
  }
  if (!(a in RESOLUTIONS[q]!)) {
    console.error(`  Unknown aspect: ${a}. Use: horizontal, vertical, square`);
    process.exit(1);
  }

  return RESOLUTIONS[q]![a]!;
}

// ── Config ─────────────────────────────────────────────────────────

type RenderConfig = {
  notebookPath: string;
  outputPath: string;
  animationMode: AnimationMode;
  force: boolean;
  pythonPath?: string;
  venvPath?: string;
  fps: number;
  width: number;
  height: number;
  quality?: Quality;
  aspect?: Aspect;
};

// ── YAML template ──────────────────────────────────────────────────

type TemplateYaml = {
  notebook?: string;
  output?: string;
  animation?: string;
  force?: boolean;
  python?: string;
  venv?: string;
  fps?: number;
  width?: number;
  height?: number;
  quality?: string;
  aspect?: string;
};

function loadTemplate(templatePath: string): Partial<RenderConfig> {
  const raw = require("node:fs").readFileSync(templatePath, "utf-8") as string;
  const yaml = parseYaml(raw) as TemplateYaml | null;
  if (!yaml) return {};

  const dir = dirname(templatePath);
  const resolvePath = (p: string) => (isAbsolute(p) ? p : join(dir, p));

  const config: Partial<RenderConfig> = {};

  if (yaml.notebook) config.notebookPath = resolvePath(yaml.notebook);
  if (yaml.output) config.outputPath = resolvePath(yaml.output);
  if (yaml.animation && ANIMATION_MODES.includes(yaml.animation as AnimationMode)) {
    config.animationMode = yaml.animation as AnimationMode;
  }
  if (yaml.force === true) config.force = true;
  if (yaml.python) config.pythonPath = resolvePath(yaml.python);
  if (yaml.venv) config.venvPath = resolvePath(yaml.venv);
  if (yaml.fps) config.fps = yaml.fps;
  if (yaml.width) config.width = yaml.width;
  if (yaml.height) config.height = yaml.height;
  if (yaml.quality) config.quality = yaml.quality as Quality;
  if (yaml.aspect) config.aspect = yaml.aspect as Aspect;

  return config;
}

// ── CLI args ───────────────────────────────────────────────────────

function usage(): never {
  console.error(`Usage:
  ntui render [render.yaml]              Render from template
  ntui render <notebook.ipynb> [opts]    Render with CLI args

Options:
  -o, --output <path>        Output video path (default: out/video.mp4)
  --animation <mode>         char | word | line | block | present (default: char)
  --force, -f                Re-execute notebook (ignore cache)
  --python <path>            Python interpreter path
  --venv <path>              Virtual environment path

Resolution presets:
  --quality <preset>         sd | hd | 4k (default: hd)
  --aspect <ratio>           horizontal | vertical | square (default: horizontal)

  Preset table:
    sd   horizontal  854x480     vertical  480x854     square  640x640
    hd   horizontal  1920x1080   vertical  1080x1920   square  1080x1080
    4k   horizontal  3840x2160   vertical  2160x3840   square  2160x2160

Custom resolution (overrides presets):
  --width <n>                Video width
  --height <n>               Video height
  --fps <n>                  Frames per second (default: 30)

Template:
  ntui init                  Create a render.yaml template`);
  process.exit(1);
}

function parseCliArgs(argv: string[]): { templatePath?: string; overrides: Partial<RenderConfig> } {
  const overrides: Partial<RenderConfig> = {};
  let positional: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "-o" || v === "--output") {
      const val = argv[++i];
      if (val) overrides.outputPath = isAbsolute(val) ? val : join(process.cwd(), val);
    } else if (v === "--animation" || v === "--anim") {
      const mode = argv[++i] as AnimationMode;
      if (ANIMATION_MODES.includes(mode)) {
        overrides.animationMode = mode;
      } else {
        console.error(`Invalid animation mode: ${mode}`);
        usage();
      }
    } else if (v === "--force" || v === "-f") {
      overrides.force = true;
    } else if (v === "--python") {
      overrides.pythonPath = argv[++i];
    } else if (v === "--venv") {
      const val = argv[++i];
      if (val) overrides.venvPath = isAbsolute(val) ? val : join(process.cwd(), val);
    } else if (v === "--quality" || v === "-q") {
      overrides.quality = argv[++i] as Quality;
    } else if (v === "--aspect") {
      overrides.aspect = argv[++i] as Aspect;
    } else if (v === "--fps") {
      overrides.fps = parseInt(argv[++i] ?? "30", 10);
    } else if (v === "--width") {
      overrides.width = parseInt(argv[++i] ?? "1920", 10);
    } else if (v === "--height") {
      overrides.height = parseInt(argv[++i] ?? "1080", 10);
    } else if (v === "-h" || v === "--help") {
      usage();
    } else if (!v.startsWith("-") && !positional) {
      positional = isAbsolute(v) ? v : join(process.cwd(), v);
    }
  }

  if (positional) {
    if (positional.endsWith(".yaml") || positional.endsWith(".yml")) {
      return { templatePath: positional, overrides };
    }
    if (positional.endsWith(".ipynb")) {
      overrides.notebookPath = positional;
      return { overrides };
    }
    if (existsSync(positional)) {
      const content = require("node:fs").readFileSync(positional, "utf-8") as string;
      if (content.trimStart().startsWith("{")) {
        overrides.notebookPath = positional;
      } else {
        return { templatePath: positional, overrides };
      }
    } else {
      overrides.notebookPath = positional;
    }
  }

  return { overrides };
}

function resolveConfig(templateConfig: Partial<RenderConfig>, cliOverrides: Partial<RenderConfig>): RenderConfig {
  const merged = { ...templateConfig, ...cliOverrides };

  const [w, h] = resolveResolution(
    merged.quality,
    merged.aspect,
    merged.width,
    merged.height,
  );

  return {
    notebookPath: merged.notebookPath ?? "",
    outputPath: merged.outputPath ?? join(process.cwd(), "out/video.mp4"),
    animationMode: merged.animationMode ?? "char",
    force: merged.force ?? false,
    pythonPath: merged.pythonPath,
    venvPath: merged.venvPath,
    fps: merged.fps ?? 30,
    width: w,
    height: h,
    quality: merged.quality,
    aspect: merged.aspect,
  };
}

// ── Cache ──────────────────────────────────────────────────────────

async function hashFile(path: string): Promise<string> {
  const content = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(Buffer.from(content)).digest("hex").slice(0, 16);
}

async function getCachedTimeline(hash: string): Promise<string | null> {
  const cachePath = join(CACHE_DIR, `${hash}.json`);
  if (existsSync(cachePath)) return cachePath;
  return null;
}

async function saveCachedTimeline(hash: string, data: string): Promise<string> {
  await Bun.write(join(CACHE_DIR, ".gitkeep"), "");
  const cachePath = join(CACHE_DIR, `${hash}.json`);
  await Bun.write(cachePath, data);
  return cachePath;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const { templatePath, overrides } = parseCliArgs(Bun.argv.slice(2));

  let templateConfig: Partial<RenderConfig> = {};
  const resolvedTemplatePath = templatePath ?? join(process.cwd(), "render.yaml");

  if (templatePath) {
    if (!existsSync(templatePath)) {
      console.error(`  Template not found: ${templatePath}`);
      process.exit(1);
    }
    console.log(`  Template: ${templatePath}`);
    templateConfig = loadTemplate(templatePath);
  } else if (existsSync(resolvedTemplatePath) && !overrides.notebookPath) {
    console.log(`  Template: ${resolvedTemplatePath}`);
    templateConfig = loadTemplate(resolvedTemplatePath);
  }

  const config = resolveConfig(templateConfig, overrides);

  if (!config.notebookPath) {
    console.error("  No notebook specified. Pass a .ipynb file or create a render.yaml template.");
    console.error("  Run: ntui init");
    process.exit(1);
  }

  if (!existsSync(config.notebookPath)) {
    console.error(`  Notebook not found: ${config.notebookPath}`);
    process.exit(1);
  }

  const absOutput = isAbsolute(config.outputPath) ? config.outputPath : join(process.cwd(), config.outputPath);

  console.log(`\n  Notebook:   ${config.notebookPath}`);
  console.log(`  Output:     ${absOutput}`);
  console.log(`  Animation:  ${config.animationMode}`);
  console.log(`  Resolution: ${config.width}x${config.height} @ ${config.fps}fps`);

  // --- Step 1: Capture or use cache ---
  const notebookHash = await hashFile(config.notebookPath);
  const cacheKey = `${notebookHash}-${config.animationMode}`;
  let propsJson: string;

  if (!config.force) {
    const cached = await getCachedTimeline(cacheKey);
    if (cached) {
      console.log(`\n  Cache hit (${cacheKey}), skipping execution.`);
      propsJson = await Bun.file(cached).text();
    } else {
      console.log(`\n  No cache, executing notebook...`);
      propsJson = await executeAndCache(config, cacheKey);
    }
  } else {
    console.log(`\n  --force: re-executing notebook...`);
    propsJson = await executeAndCache(config, cacheKey);
  }

  await Bun.write(PROPS_PATH, propsJson);

  // --- Step 2: Render with Remotion ---
  console.log(`\n  Rendering video...`);

  const remotionArgs = [
    REMOTION_BIN, "render", "src/index.ts", "NotebookRender",
    "--output", absOutput,
    "--props", PROPS_PATH,
    "--width", String(config.width),
    "--height", String(config.height),
  ];

  const proc = Bun.spawn(remotionArgs, {
    cwd: REMOTION_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`\n  Remotion exited with code ${exitCode}`);
    process.exit(exitCode);
  }

  console.log(`\n  Done: ${absOutput}\n`);
}

async function executeAndCache(config: RenderConfig, cacheKey: string): Promise<string> {
  const timeline = await captureTimeline({
    notebookPath: config.notebookPath,
    pythonPath: config.pythonPath,
    venvPath: config.venvPath,
  });

  const props = { timeline, animationMode: config.animationMode };
  const json = JSON.stringify(props, null, 2);
  await saveCachedTimeline(cacheKey, json);
  console.log(`  Cached as ${cacheKey}`);
  return json;
}

main();
