export type NotebookOutput =
  | { kind: "stream"; text: string }
  | { kind: "result"; text: string }
  | { kind: "error"; text: string }
  | {
      kind: "image";
      mimeType: string;
      data: string;
      width: number;
      height: number;
      alt: string;
      preview: Array<Array<{ text: string; fg: string; bg: string }>> | null;
    };

export type TimelineEvent =
  | { type: "clear"; ts: number }
  | { type: "focus"; ts: number; cellIndex: number }
  | { type: "source"; ts: number; cellIndex: number; source: string }
  | { type: "output"; ts: number; cellIndex: number; output: NotebookOutput }
  | { type: "complete"; ts: number; cellIndex: number; executionCount: number; error: string | null }
  | { type: "done"; ts: number };

export type CellKind = "code" | "markdown";

export type Timeline = {
  cells: { source: string; kind?: CellKind }[];
  events: TimelineEvent[];
};

export type AnimationMode = "char" | "word" | "line" | "block" | "present";

export type CellState = {
  source: string;
  kind: CellKind;
  executionCount: number | null;
  outputs: NotebookOutput[];
  focused: boolean;
  running: boolean;
};
