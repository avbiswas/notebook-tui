export type CellKind = "code" | "markdown";

export type ImagePreviewSpan = {
  text: string;
  fg: string;
  bg: string;
};

export type ImagePreviewRow = ImagePreviewSpan[];

export type NotebookOutput =
  | { kind: "stream"; text: string }
  | { kind: "result"; text: string }
  | { kind: "error"; text: string }
  | {
      kind: "image";
      mimeType: "image/png" | "image/jpeg";
      data: string;
      width: number;
      height: number;
      alt: string;
      preview: ImagePreviewRow[] | null;
    };

export type NotebookCell = {
  id: string;
  kind: CellKind;
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
};

export type ClipboardData =
  | { kind: "cells"; cells: NotebookCell[] }
  | { kind: "text"; text: string; linewise: boolean };

export type NotebookDocument = {
  cells: NotebookCell[];
  clipboard: ClipboardData | null;
  nextCellId: number;
  executionCounter: number;
};

export type NotebookHistory = {
  past: NotebookDocument[];
  present: NotebookDocument;
  future: NotebookDocument[];
};

export type AppMode =
  | "normal"
  | "insert"
  | "visual"
  | "visual_line"
  | "cell_visual"
  | "command";

export type Cursor = {
  row: number;
  col: number;
};

export type ThemeName = "monokai";

export type UIState = {
  mode: AppMode;
  notebookPath: string | null;
  focusedCellId: string;
  cursorByCellId: Record<string, Cursor>;
  selectionAnchorCellId: string | null;
  selectionAnchorCursor: Cursor | null;
  pendingOperator: "delete" | "yank" | "change" | null;
  pendingMotion:
    | "goto"
    | "leader"
    | "leader_v"
    | "find_forward"
    | "find_backward"
    | "till_forward"
    | "till_backward"
    | null;
  lastFind:
    | {
        char: string;
        direction: "forward" | "backward";
        till: boolean;
      }
    | null;
  commandBuffer: string;
  statusMessage: string;
  themeName: ThemeName;
};

export type KernelStatus = "starting" | "idle" | "busy" | "error" | "stopped";

export type KernelState = {
  status: KernelStatus;
  interpreterPath: string | null;
  provider: "bridge" | "ipykernel";
  currentCellId: string | null;
  lastError: string | null;
};

export type AppState = {
  notebook: NotebookHistory;
  ui: UIState;
  kernel: KernelState;
};

export type ExecuteResult = {
  error: string | null;
  executionCount: number;
};
