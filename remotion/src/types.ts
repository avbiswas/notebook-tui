import type { NtuiCommandMap } from "../../src/ntui-commands";
import type { NotebookOutput as SharedNotebookOutput } from "../../src/types";

export type NotebookOutput = SharedNotebookOutput;

export type TimelineEvent =
  | { type: "clear"; ts: number }
  | { type: "focus"; ts: number; cellIndex: number }
  | { type: "source"; ts: number; cellIndex: number; source: string }
  | { type: "output"; ts: number; cellIndex: number; output: NotebookOutput }
  | { type: "complete"; ts: number; cellIndex: number; executionCount: number; error: string | null }
  | { type: "done"; ts: number };

export type CellKind = "code" | "markdown";

export type Timeline = {
  cells: { source: string; kind?: CellKind; commands?: NtuiCommandMap }[];
  events: TimelineEvent[];
};

export type AnimationMode = "char" | "word" | "line" | "block" | "present";

export type CellState = {
  source: string;
  kind: CellKind;
  commands?: NtuiCommandMap;
  executionCount: number | null;
  outputs: NotebookOutput[];
  focused: boolean;
  running: boolean;
};
