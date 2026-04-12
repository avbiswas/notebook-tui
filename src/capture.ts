/**
 * Executes a notebook and captures a timeline of events for Remotion rendering.
 *
 * Can be used standalone or imported by render-video.ts.
 */

import { isAbsolute, join } from "node:path";
import { deserializeIpynb } from "./ipynb";
import { executeNotebookCell } from "./notebook-execution";
import { parseNtuiCommands, stripNtuiCommands, type NtuiCommandMap } from "./ntui-commands";
import type { NotebookOutput } from "./types";
import { PythonSession, resolvePython } from "./python-session";

export type TimelineEvent =
  | { type: "clear"; ts: number }
  | { type: "focus"; ts: number; cellIndex: number }
  | { type: "source"; ts: number; cellIndex: number; source: string }
  | { type: "output"; ts: number; cellIndex: number; output: NotebookOutput }
  | { type: "complete"; ts: number; cellIndex: number; executionCount: number; error: string | null }
  | { type: "done"; ts: number };

export type Timeline = {
  cells: { source: string; kind?: "code" | "markdown"; commands?: NtuiCommandMap }[];
  events: TimelineEvent[];
};

export type AnimationMode = "char" | "word" | "line" | "block" | "present";

export type CaptureOptions = {
  notebookPath: string;
  pythonPath?: string;
  venvPath?: string;
};

/**
 * Execute a notebook and return the captured timeline.
 */
export async function captureTimeline(opts: CaptureOptions): Promise<Timeline> {
  const text = await Bun.file(opts.notebookPath).text();
  const doc = deserializeIpynb(text);

  console.log(`Resolving Python...`);
  const resolution = await resolvePython(
    { pythonPath: opts.pythonPath, venvPath: opts.venvPath },
    process.cwd(),
  );
  const session = new PythonSession(resolution.pythonPath);
  const backend = await session.backendInfo();
  console.log(`Backend: ${backend.backend} (${resolution.pythonPath})`);

  const events: TimelineEvent[] = [];
  const t0 = Date.now();
  const ts = () => Date.now() - t0;

  events.push({ type: "clear", ts: ts() });

  for (let i = 0; i < doc.cells.length; i++) {
    const cell = doc.cells[i]!;
    const parsedCommands = parseNtuiCommands(cell.source);
    const visibleSource = parsedCommands.bodySource;

    events.push({ type: "focus", ts: ts(), cellIndex: i });
    events.push({ type: "source", ts: ts(), cellIndex: i, source: visibleSource });

    if (cell.kind === "markdown") {
      console.log(`  [${i + 1}/${doc.cells.length}] Markdown cell (skipping execution)`);
      events.push({
        type: "complete",
        ts: ts(),
        cellIndex: i,
        executionCount: 0,
        error: null,
      });
      continue;
    }

    console.log(`  [${i + 1}/${doc.cells.length}] Running cell...`);

    try {
      await executeNotebookCell(session, cell.source, (event) => {
        if (event.type === "output") {
          events.push({
            type: "output",
            ts: ts(),
            cellIndex: i,
            output: event.output,
          });
          return;
        }

        events.push({
          type: "complete",
          ts: ts(),
          cellIndex: i,
          executionCount: event.executionCount,
          error: event.error,
        });
      });
    } catch (error) {
      events.push({
        type: "complete",
        ts: ts(),
        cellIndex: i,
        executionCount: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  events.push({ type: "done", ts: ts() });
  await session.stop();

  return {
    cells: doc.cells.map((c) => {
      const parsed = parseNtuiCommands(c.source);
      return {
        source: stripNtuiCommands(c.source),
        kind: c.kind,
        commands: parsed.commands,
      };
    }),
    events,
  };
}

// Standalone usage
if (import.meta.main) {
  function parseArgs(argv: string[]) {
    let notebookPath: string | undefined;
    let outputPath = "remotion/public/timeline.json";
    let pythonPath: string | undefined;
    let venvPath: string | undefined;
    let animationMode: AnimationMode = "char";

    for (let i = 0; i < argv.length; i++) {
      const v = argv[i]!;
      if (v === "-o" || v === "--output") {
        outputPath = argv[++i] ?? outputPath;
      } else if (v === "--python") {
        pythonPath = argv[++i];
      } else if (v === "--venv") {
        venvPath = argv[++i];
      } else if (v === "--animation" || v === "--anim") {
        const mode = argv[++i] as AnimationMode;
        if (["char", "word", "line", "block", "present"].includes(mode)) {
          animationMode = mode;
        }
      } else if (!v.startsWith("-") && !notebookPath) {
        notebookPath = isAbsolute(v) ? v : join(process.cwd(), v);
      }
    }

    if (!notebookPath) {
      console.error("Usage: bun run src/capture.ts <notebook.ipynb> [-o timeline.json] [--animation char|word|line|block|present]");
      process.exit(1);
    }

    return { notebookPath, outputPath, pythonPath, venvPath, animationMode };
  }

  const args = parseArgs(Bun.argv.slice(2));
  console.log(`Loading ${args.notebookPath}...`);
  const timeline = await captureTimeline({
    notebookPath: args.notebookPath!,
    pythonPath: args.pythonPath,
    venvPath: args.venvPath,
  });

  const props = { timeline, animationMode: args.animationMode };
  await Bun.write(args.outputPath, JSON.stringify(props, null, 2));
  console.log(`Timeline written to ${args.outputPath} (${timeline.events.length} events, animation: ${args.animationMode})`);
}
