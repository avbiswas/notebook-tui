import { createCanvas } from "@napi-rs/canvas";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import type { CapturedFrame } from "@opentui/core";
import { isAbsolute, join } from "node:path";
import { App } from "./index";

// --- Config ---

const COLS = 120;
const ROWS = 40;
const CELL_W = 10;
const CELL_H = 20;
const FPS = 8;
const FONT_SIZE = 16;
const FONT_FAMILY = "JetBrainsMono Nerd Font";

const WIDTH = COLS * CELL_W;
const HEIGHT = ROWS * CELL_H;

// --- Parse args ---

function parseRenderArgs(argv: string[]) {
  let notebookPath: string | undefined;
  let outputPath = "output.mp4";
  let pause = 1000;
  let pythonPath: string | undefined;
  let venvPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "--output" || v === "-o") {
      outputPath = argv[++i] ?? outputPath;
    } else if (v === "--pause") {
      pause = Number(argv[++i]) || 1000;
    } else if (v === "--python") {
      pythonPath = argv[++i];
    } else if (v === "--venv") {
      venvPath = argv[++i];
    } else if (!v.startsWith("-") && !notebookPath) {
      notebookPath = isAbsolute(v) ? v : join(process.cwd(), v);
    }
  }

  if (!notebookPath) {
    console.error("Usage: bun run src/render.tsx <notebook.ipynb> [--output out.mp4] [--pause 1000]");
    process.exit(1);
  }

  return { notebookPath, outputPath, pause, pythonPath, venvPath };
}

const args = parseRenderArgs(Bun.argv.slice(2));

// Patch Bun.argv so App sees --render + notebook path
const fakeArgv = [
  Bun.argv[0]!, Bun.argv[1]!,
  args.notebookPath!,
  "--render",
  "--pause", String(args.pause),
];
if (args.pythonPath) fakeArgv.push("--python", args.pythonPath);
if (args.venvPath) fakeArgv.push("--venv", args.venvPath);
(Bun as any).argv = fakeArgv;

// --- Frame rendering ---

function rgbaToCSS(rgba: { r: number; g: number; b: number; a: number }): string {
  const r = Math.round(rgba.r * 255);
  const g = Math.round(rgba.g * 255);
  const b = Math.round(rgba.b * 255);
  return `rgb(${r},${g},${b})`;
}

function renderFrameToPNG(frame: CapturedFrame): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#171717";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.font = `${FONT_SIZE}px "${FONT_FAMILY}"`;
  ctx.textBaseline = "top";

  for (let row = 0; row < frame.lines.length && row < ROWS; row++) {
    const line = frame.lines[row]!;
    let x = 0;

    for (const span of line.spans) {
      const cellCount = span.width;
      const bgColor = rgbaToCSS(span.bg);
      const fgColor = rgbaToCSS(span.fg);
      const y = row * CELL_H;

      if (span.bg.a > 0.01) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(x, y, cellCount * CELL_W, CELL_H);
      }

      ctx.fillStyle = fgColor;
      for (let i = 0; i < span.text.length; i++) {
        const ch = span.text[i]!;
        if (ch !== " ") {
          ctx.fillText(ch, x + i * CELL_W + 1, y + 2);
        }
      }

      x += cellCount * CELL_W;
    }
  }

  return canvas.toBuffer("image/png") as Buffer;
}

// --- Main ---

async function main() {
  console.log(`Rendering ${args.notebookPath} -> ${args.outputPath}`);
  console.log(`Resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps, pause: ${args.pause}ms`);

  // Suppress React act() warnings — we're not in a test, we just want headless rendering
  const originalError = console.error;
  console.error = (...a: any[]) => {
    if (typeof a[0] === "string" && a[0].includes("act(")) return;
    if (typeof a[0] === "string" && a[0].includes("TreeSitter")) return;
    originalError(...a);
  };

  let destroyed = false;

  const setup = await createTestRenderer({
    width: COLS,
    height: ROWS,
  });

  // Intercept destroy so the App's auto-quit doesn't crash the renderer mid-capture
  const originalDestroy = setup.renderer.destroy.bind(setup.renderer);
  setup.renderer.destroy = () => {
    destroyed = true;
  };

  const root = createRoot(setup.renderer);
  root.render(<App />);

  const frameInterval = 1000 / FPS;

  // Stream frames directly to ffmpeg instead of buffering all in memory
  const ffmpeg = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-i", "-",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "medium",
      "-crf", "18",
      "-movflags", "+faststart",
      args.outputPath,
    ],
    {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    },
  );

  let frameCount = 0;

  while (!destroyed) {
    await setup.renderOnce();
    const frame = setup.captureSpans();
    const png = renderFrameToPNG(frame);
    ffmpeg.stdin.write(png);
    frameCount++;

    if (frameCount % FPS === 0) {
      process.stdout.write(`\r  ${frameCount} frames (${(frameCount / FPS).toFixed(0)}s)...`);
    }

    await new Promise((r) => setTimeout(r, frameInterval));
  }

  // Hold final frame briefly
  await setup.renderOnce();
  const finalFrame = setup.captureSpans();
  const finalPng = renderFrameToPNG(finalFrame);
  for (let i = 0; i < FPS; i++) {
    ffmpeg.stdin.write(finalPng);
    frameCount++;
  }

  // Now actually destroy
  originalDestroy();

  ffmpeg.stdin.end();

  const exitCode = await ffmpeg.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(ffmpeg.stderr).text();
    console.error("\nffmpeg failed:", stderr.slice(-500));
    process.exit(1);
  }

  console.log(`\nDone: ${args.outputPath} (${frameCount} frames, ${(frameCount / FPS).toFixed(1)}s)`);
  process.exit(0);
}

main();
