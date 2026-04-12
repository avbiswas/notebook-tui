import { spawn } from "bun";
import { applyNotebookOutput } from "./output-model";
import type {
  AppState,
  CellKind,
  ClipboardData,
  Cursor,
  NotebookCell,
  NotebookDocument,
  NotebookHistory,
  NotebookOutput,
} from "./types";

// Ordered list of CLI clipboard writers to try, per platform. The first one
// that spawns successfully wins — this lets the same build work on macOS,
// Linux (x11/wayland), and Windows without runtime probing of every tool.
function clipboardCommands(): string[][] {
  if (process.platform === "darwin") {
    return [["pbcopy"]];
  }
  if (process.platform === "win32") {
    return [["clip"]];
  }
  return [
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
  ];
}

/** Copy plain text to the OS clipboard (pbcopy, wl-copy, xclip, clip, …). */
export function copyStringToSystemClipboard(text: string): void {
  for (const command of clipboardCommands()) {
    try {
      const proc = spawn(command, {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(text);
      proc.stdin.end();
      return;
    } catch {
      // Binary is probably missing; fall through to the next candidate.
    }
  }
}

function writeSystemClipboard(data: ClipboardData): void {
  const text =
    data.kind === "text"
      ? data.text
      : data.cells.map((cell) => cell.source).join("\n\n");
  copyStringToSystemClipboard(text);
}

function cloneDocument(document: NotebookDocument): NotebookDocument {
  return JSON.parse(JSON.stringify(document)) as NotebookDocument;
}

export function createCell(id: string, source = "", kind: CellKind = "code"): NotebookCell {
  return {
    id,
    kind,
    source,
    executionCount: null,
    outputs: [],
  };
}

/** Default first cell when starting without a notebook file (shown as markdown). */
const DEFAULT_NOTEBOOK_INTRO_MARKDOWN = `# Welcome to notebook-tui

Vim-style notebook editing in the terminal. **Space ?** or **Shift+H** for full help.

- **i** insert · **Esc** normal · **{** / **}** navigate cells
- **R** run cell · **Space o** new cell · **Space d** delete cell · **:w** save · **:q** quit
`;

export function createInitialDocument(): NotebookDocument {
  return {
    cells: [
      createCell("cell-1", DEFAULT_NOTEBOOK_INTRO_MARKDOWN, "markdown"),
      createCell("cell-2", 'print("Hello, World!")', "code"),
    ],
    clipboard: null,
    nextCellId: 3,
    executionCounter: 0,
  };
}

export function createInitialHistory(): NotebookHistory {
  return {
    past: [],
    present: createInitialDocument(),
    future: [],
  };
}

export function defaultCursorForCell(cell: NotebookCell): Cursor {
  const lines = getLines(cell.source);
  const row = lines.length - 1;
  return { row, col: lines[row]?.length ?? 0 };
}

export function createInitialAppState(): AppState {
  const history = createInitialHistory();
  return createAppStateFromDocument(history.present, null);
}

export function createAppStateFromDocument(
  document: NotebookDocument,
  notebookPath: string | null,
): AppState {
  const focusedCellId = document.cells[0]?.id ?? "cell-1";
  const cursorByCellId = Object.fromEntries(
    document.cells.map((cell) => [cell.id, defaultCursorForCell(cell)]),
  );

  return {
    notebook: {
      past: [],
      present: document,
      future: [],
    },
    ui: {
      mode: "normal",
      notebookPath,
      focusedCellId,
      lastVisitedCellId: null,
      focusTarget: "editor",
      cursorByCellId,
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      pendingOperator: null,
      pendingMotion: null,
      lastFind: null,
      commandBuffer: "",
      statusMessage:
        "Normal mode. Press H for shortcuts.",
      themeName: "monokai",
      helpOpen: false,
      outputDialogCellId: null,
      runningCellId: null,
    },
    kernel: {
      status: "starting",
      interpreterPath: null,
      provider: "bridge",
      currentCellId: null,
      lastError: null,
    },
  };
}

function mapFocusedCell(
  state: AppState,
  updater: (cell: NotebookCell, cursor: Cursor) => { cell: NotebookCell; cursor: Cursor },
): AppState {
  const focusedCell = getFocusedCell(state);
  if (!focusedCell) {
    return state;
  }

  const currentCursor =
    state.ui.cursorByCellId[focusedCell.id] ?? defaultCursorForCell(focusedCell);
  const next = updater(focusedCell, currentCursor);

  return applyNotebookMutation(state, (document) => {
    document.cells = document.cells.map((cell) =>
      cell.id === focusedCell.id ? next.cell : cell,
    );
  }, {
    cursorByCellId: {
      ...state.ui.cursorByCellId,
      [focusedCell.id]: next.cursor,
    },
  });
}

export function getFocusedCell(state: AppState): NotebookCell | null {
  return (
    state.notebook.present.cells.find((cell) => cell.id === state.ui.focusedCellId) ?? null
  );
}

export function getCellIndex(state: AppState, cellId: string): number {
  return state.notebook.present.cells.findIndex((cell) => cell.id === cellId);
}

export function getLines(source: string): string[] {
  return source.length === 0 ? [""] : source.split("\n");
}

export function sourceFromLines(lines: string[]): string {
  return lines.join("\n");
}

export function clampCursor(source: string, cursor: Cursor): Cursor {
  const lines = getLines(source);
  const row = Math.max(0, Math.min(cursor.row, lines.length - 1));
  const col = Math.max(0, Math.min(cursor.col, lines[row]?.length ?? 0));
  return { row, col };
}

function cursorToOffset(source: string, cursor: Cursor): number {
  const lines = getLines(source);
  let offset = 0;
  for (let row = 0; row < cursor.row; row += 1) {
    offset += (lines[row]?.length ?? 0) + 1;
  }
  return offset + cursor.col;
}

function offsetToCursor(source: string, offset: number): Cursor {
  const clampedOffset = Math.max(0, Math.min(offset, source.length));
  const lines = getLines(source);
  let remaining = clampedOffset;

  for (let row = 0; row < lines.length; row += 1) {
    const lineLength = lines[row]?.length ?? 0;
    if (remaining <= lineLength) {
      return { row, col: remaining };
    }
    remaining -= lineLength + 1;
  }

  return {
    row: Math.max(0, lines.length - 1),
    col: lines.at(-1)?.length ?? 0,
  };
}

type CharClass = "whitespace" | "word" | "punct";

function getCharClass(char: string | undefined): CharClass {
  if (!char || /\s/.test(char)) {
    return "whitespace";
  }
  if (/[A-Za-z0-9_]/.test(char)) {
    return "word";
  }
  return "punct";
}

function nextWordStart(source: string, offset: number): number {
  let index = Math.max(0, Math.min(offset, source.length));
  const currentClass = getCharClass(source[index]);

  if (currentClass !== "whitespace") {
    while (index < source.length && getCharClass(source[index]) === currentClass) {
      index += 1;
    }
  }
  while (index < source.length && getCharClass(source[index]) === "whitespace") {
    index += 1;
  }
  return index;
}

function previousWordStart(source: string, offset: number): number {
  let index = Math.max(0, Math.min(offset, source.length));
  while (index > 0 && getCharClass(source[index - 1]) === "whitespace") {
    index -= 1;
  }
  const targetClass = getCharClass(source[index - 1]);
  while (index > 0 && getCharClass(source[index - 1]) === targetClass) {
    index -= 1;
  }
  return index;
}

function nextWordEnd(source: string, offset: number): number {
  let index = Math.max(0, Math.min(offset, source.length));
  while (index < source.length && getCharClass(source[index]) === "whitespace") {
    index += 1;
  }
  const targetClass = getCharClass(source[index]);
  while (index < source.length && getCharClass(source[index]) === targetClass) {
    index += 1;
  }
  return Math.max(0, index - 1);
}

export function applyNotebookMutation(
  state: AppState,
  mutate: (document: NotebookDocument) => void,
  uiPatch?: Partial<AppState["ui"]>,
): AppState {
  const previous = cloneDocument(state.notebook.present);
  const next = cloneDocument(state.notebook.present);
  mutate(next);

  if (JSON.stringify(previous) === JSON.stringify(next)) {
    return uiPatch ? { ...state, ui: { ...state.ui, ...uiPatch } } : state;
  }

  return {
    ...state,
    notebook: {
      past: [...state.notebook.past, previous].slice(-200),
      present: next,
      future: [],
    },
    ui: {
      ...state.ui,
      ...uiPatch,
      pendingOperator: null,
      pendingMotion: null,
    },
  };
}

export function undoNotebook(state: AppState): AppState {
  const previous = state.notebook.past.at(-1);
  if (!previous) {
    return {
      ...state,
      ui: {
        ...state.ui,
        statusMessage: "Nothing to undo.",
        pendingOperator: null,
        pendingMotion: null,
        lastFind: state.ui.lastFind,
        commandBuffer: "",
      },
    };
  }

  return {
    ...state,
    notebook: {
      past: state.notebook.past.slice(0, -1),
      present: previous,
      future: [cloneDocument(state.notebook.present), ...state.notebook.future],
    },
    ui: {
      ...state.ui,
      pendingOperator: null,
      pendingMotion: null,
      lastFind: state.ui.lastFind,
      commandBuffer: "",
      focusedCellId:
        previous.cells.find((cell) => cell.id === state.ui.focusedCellId)?.id ??
        previous.cells[0]?.id ??
        state.ui.focusedCellId,
      statusMessage: "Undo.",
    },
  };
}

export function redoNotebook(state: AppState): AppState {
  const next = state.notebook.future[0];
  if (!next) {
    return {
      ...state,
      ui: {
        ...state.ui,
        statusMessage: "Nothing to redo.",
        pendingOperator: null,
        pendingMotion: null,
        lastFind: state.ui.lastFind,
        commandBuffer: "",
      },
    };
  }

  return {
    ...state,
    notebook: {
      past: [...state.notebook.past, cloneDocument(state.notebook.present)],
      present: next,
      future: state.notebook.future.slice(1),
    },
    ui: {
      ...state.ui,
      pendingOperator: null,
      pendingMotion: null,
      lastFind: state.ui.lastFind,
      commandBuffer: "",
      focusedCellId:
        next.cells.find((cell) => cell.id === state.ui.focusedCellId)?.id ??
        next.cells[0]?.id ??
        state.ui.focusedCellId,
      statusMessage: "Redo.",
    },
  };
}

export function moveFocusToRelativeCell(state: AppState, delta: number): AppState {
  const currentIndex = getCellIndex(state, state.ui.focusedCellId);
  if (currentIndex === -1) {
    return state;
  }
  const nextIndex = Math.max(
    0,
    Math.min(currentIndex + delta, state.notebook.present.cells.length - 1),
  );
  const nextCellId = state.notebook.present.cells[nextIndex]?.id ?? state.ui.focusedCellId;
  const selectionAnchorCellId =
    state.ui.mode === "cell_visual"
      ? state.ui.selectionAnchorCellId ?? state.ui.focusedCellId
      : null;

  return {
    ...state,
    ui: {
      ...state.ui,
      focusedCellId: nextCellId,
      lastVisitedCellId:
        nextCellId !== state.ui.focusedCellId ? state.ui.focusedCellId : state.ui.lastVisitedCellId,
      focusTarget: "editor",
      selectionAnchorCellId,
      selectionAnchorCursor:
        state.ui.mode === "visual" ? state.ui.selectionAnchorCursor : null,
      pendingOperator: null,
      pendingMotion: null,
      statusMessage:
        state.ui.mode === "visual"
          ? "Visual cell selection."
          : "Moved between cells.",
    },
  };
}

export function moveCursor(
  state: AppState,
  rowDelta: number,
  colDelta: number,
): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const current = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const currentLines = getLines(cell.source);

  if (rowDelta !== 0) {
    const targetRow = current.row + rowDelta;
    const currentIndex = getCellIndex(state, cell.id);

    if (targetRow < 0 && currentIndex > 0) {
      const previousCell = state.notebook.present.cells[currentIndex - 1];
      if (!previousCell) {
        return state;
      }
      const previousLines = getLines(previousCell.source);
      const nextCursor = {
        row: Math.max(0, previousLines.length - 1),
        col: Math.min(current.col, previousLines.at(-1)?.length ?? 0),
      };
      return {
        ...state,
        ui: {
          ...state.ui,
          focusedCellId: previousCell.id,
          cursorByCellId: { ...state.ui.cursorByCellId, [previousCell.id]: nextCursor },
          pendingOperator: null,
          pendingMotion: null,
          statusMessage: "Cursor moved.",
        },
      };
    }

    if (targetRow >= currentLines.length && currentIndex < state.notebook.present.cells.length - 1) {
      const nextCell = state.notebook.present.cells[currentIndex + 1];
      if (!nextCell) {
        return state;
      }
      const nextLines = getLines(nextCell.source);
      const nextCursor = {
        row: 0,
        col: Math.min(current.col, nextLines[0]?.length ?? 0),
      };
      return {
        ...state,
        ui: {
          ...state.ui,
          focusedCellId: nextCell.id,
          cursorByCellId: { ...state.ui.cursorByCellId, [nextCell.id]: nextCursor },
          pendingOperator: null,
          pendingMotion: null,
          statusMessage: "Cursor moved.",
        },
      };
    }
  }

  const next = clampCursor(cell.source, {
    row: current.row + rowDelta,
    col: current.col + colDelta,
  });

  return {
    ...state,
    ui: {
      ...state.ui,
      cursorByCellId: { ...state.ui.cursorByCellId, [cell.id]: next },
      pendingOperator: null,
      pendingMotion: null,
      statusMessage: "Cursor moved.",
    },
  };
}

export function moveCursorToLineBoundary(state: AppState, edge: "start" | "end"): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const current = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const lines = getLines(cell.source);
  const line = lines[current.row] ?? "";
  const next = { row: current.row, col: edge === "start" ? 0 : line.length };
  return {
    ...state,
    ui: {
      ...state.ui,
      cursorByCellId: { ...state.ui.cursorByCellId, [cell.id]: next },
      pendingOperator: null,
      pendingMotion: null,
      statusMessage: "Cursor moved.",
    },
  };
}

export function moveCursorToFirstNonWhitespace(state: AppState): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const current = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const lines = getLines(cell.source);
  const line = lines[current.row] ?? "";
  const match = line.match(/\S/);
  const next = { row: current.row, col: match ? match.index ?? 0 : 0 };
  return {
    ...state,
    ui: {
      ...state.ui,
      cursorByCellId: { ...state.ui.cursorByCellId, [cell.id]: next },
      pendingOperator: null,
      pendingMotion: null,
      statusMessage: "Cursor moved.",
    },
  };
}

export function moveCursorToCellBoundary(state: AppState, edge: "start" | "end"): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const lines = getLines(cell.source);
  const next =
    edge === "start"
      ? { row: 0, col: 0 }
      : { row: Math.max(0, lines.length - 1), col: lines.at(-1)?.length ?? 0 };
  return {
    ...state,
    ui: {
      ...state.ui,
      cursorByCellId: { ...state.ui.cursorByCellId, [cell.id]: next },
      pendingOperator: null,
      pendingMotion: null,
      statusMessage: "Cursor moved.",
    },
  };
}

export function moveCursorByWord(
  state: AppState,
  direction: "forward" | "backward" | "end",
): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const current = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const offset = cursorToOffset(cell.source, current);
  const nextOffset =
    direction === "forward"
      ? nextWordStart(cell.source, offset)
      : direction === "backward"
        ? previousWordStart(cell.source, offset)
        : nextWordEnd(cell.source, offset);
  const next = offsetToCursor(cell.source, nextOffset);

  return {
    ...state,
    ui: {
      ...state.ui,
      cursorByCellId: { ...state.ui.cursorByCellId, [cell.id]: next },
      pendingOperator: null,
      pendingMotion: null,
      statusMessage: "Cursor moved by word.",
    },
  };
}

export function insertTextAtCursor(state: AppState, text: string): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const lines = getLines(cell.source);
    const line = lines[cursor.row] ?? "";
    const before = line.slice(0, cursor.col);
    const after = line.slice(cursor.col);

    if (text === "\n") {
      lines.splice(cursor.row, 1, before, after);
      return {
        cell: { ...cell, source: sourceFromLines(lines) },
        cursor: { row: cursor.row + 1, col: 0 },
      };
    }

    lines[cursor.row] = `${before}${text}${after}`;
    return {
      cell: { ...cell, source: sourceFromLines(lines) },
      cursor: { row: cursor.row, col: cursor.col + text.length },
    };
  });
}

export function backspaceAtCursor(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const lines = getLines(cell.source);
    if (cursor.col > 0) {
      const line = lines[cursor.row] ?? "";
      lines[cursor.row] = `${line.slice(0, cursor.col - 1)}${line.slice(cursor.col)}`;
      return {
        cell: { ...cell, source: sourceFromLines(lines) },
        cursor: { row: cursor.row, col: cursor.col - 1 },
      };
    }

    if (cursor.row === 0) {
      return { cell, cursor };
    }

    const previousLine = lines[cursor.row - 1] ?? "";
    const currentLine = lines[cursor.row] ?? "";
    lines.splice(cursor.row - 1, 2, `${previousLine}${currentLine}`);
    return {
      cell: { ...cell, source: sourceFromLines(lines) },
      cursor: { row: cursor.row - 1, col: previousLine.length },
    };
  });
}

export function deleteCharAtCursor(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const lines = getLines(cell.source);
    const line = lines[cursor.row] ?? "";

    if (cursor.col < line.length) {
      lines[cursor.row] = `${line.slice(0, cursor.col)}${line.slice(cursor.col + 1)}`;
      return {
        cell: { ...cell, source: sourceFromLines(lines) },
        cursor,
      };
    }

    if (cursor.row >= lines.length - 1) {
      return { cell, cursor };
    }

    const current = lines[cursor.row] ?? "";
    const next = lines[cursor.row + 1] ?? "";
    lines.splice(cursor.row, 2, `${current}${next}`);
    return {
      cell: { ...cell, source: sourceFromLines(lines) },
      cursor,
    };
  });
}

export function deleteWordBackward(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const source = cell.source;
    const endOffset = cursorToOffset(source, cursor);
    const startOffset = previousWordStart(source, endOffset);
    if (startOffset === endOffset) {
      return { cell, cursor };
    }
    const nextSource = `${source.slice(0, startOffset)}${source.slice(endOffset)}`;
    return {
      cell: { ...cell, source: nextSource },
      cursor: offsetToCursor(nextSource, startOffset),
    };
  });
}

function rangeForToEndOfLine(cell: NotebookCell, cursor: Cursor): { start: number; end: number } {
  const start = cursorToOffset(cell.source, cursor);
  const lines = getLines(cell.source);
  const line = lines[cursor.row] ?? "";
  return {
    start,
    end: start + Math.max(0, line.length - cursor.col),
  };
}

function rangeForCurrentLine(cell: NotebookCell, cursor: Cursor): { start: number; end: number } {
  const lines = getLines(cell.source);
  let start = 0;
  for (let row = 0; row < cursor.row; row += 1) {
    start += (lines[row]?.length ?? 0) + 1;
  }
  let end = start + (lines[cursor.row]?.length ?? 0);
  if (cursor.row < lines.length - 1) {
    end += 1;
  }
  return { start, end };
}

function rangeForWordForward(cell: NotebookCell, cursor: Cursor): { start: number; end: number } {
  const start = cursorToOffset(cell.source, cursor);
  const end = nextWordStart(cell.source, start);
  return { start, end: Math.max(start, end) };
}

function replaceRange(
  cell: NotebookCell,
  range: { start: number; end: number },
  replacement: string,
): { cell: NotebookCell; cursor: Cursor } {
  const nextSource = `${cell.source.slice(0, range.start)}${replacement}${cell.source.slice(range.end)}`;
  const nextCursor = offsetToCursor(nextSource, range.start + replacement.length);
  return {
    cell: { ...cell, source: nextSource },
    cursor: nextCursor,
  };
}

export function deleteToEndOfLine(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => replaceRange(cell, rangeForToEndOfLine(cell, cursor), ""));
}

export function deleteCurrentLine(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const lines = getLines(cell.source);
    const nextLines = lines.filter((_, index) => index !== cursor.row);
    const normalizedLines = nextLines.length === 0 ? [""] : nextLines;
    const nextSource = sourceFromLines(normalizedLines);
    return {
      cell: { ...cell, source: nextSource },
      cursor: clampCursor(nextSource, { row: Math.min(cursor.row, normalizedLines.length - 1), col: 0 }),
    };
  });
}

export function joinLineBelow(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const lines = getLines(cell.source);
    if (cursor.row >= lines.length - 1) {
      return { cell, cursor };
    }
    const currentLine = (lines[cursor.row] ?? "").replace(/\s+$/, "");
    const nextLine = (lines[cursor.row + 1] ?? "").replace(/^\s+/, "");
    lines.splice(cursor.row, 2, `${currentLine} ${nextLine}`.trimEnd());
    const nextSource = sourceFromLines(lines);
    return {
      cell: { ...cell, source: nextSource },
      cursor: { row: cursor.row, col: currentLine.length },
    };
  });
}

export function setClipboardText(
  state: AppState,
  text: string,
  linewise: boolean,
  message: string,
): AppState {
  const clipboard: ClipboardData = { kind: "text", text, linewise };
  writeSystemClipboard(clipboard);
  return applyNotebookMutation(
    state,
    (document) => {
      document.clipboard = clipboard;
    },
    { statusMessage: message },
  );
}

export function yankWordForward(state: AppState): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const cursor = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const range = rangeForWordForward(cell, cursor);
  return setClipboardText(state, cell.source.slice(range.start, range.end), false, "Yanked word.");
}

export function yankCurrentLine(state: AppState): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const cursor = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const range = rangeForCurrentLine(cell, cursor);
  return setClipboardText(state, cell.source.slice(range.start, range.end), true, "Yanked line.");
}

export function deleteWordForward(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => replaceRange(cell, rangeForWordForward(cell, cursor), ""));
}

export function changeWordForward(state: AppState): AppState {
  return deleteWordForward(state);
}

export function pasteTextAtCursor(
  state: AppState,
  text: string,
  linewise: boolean,
  before: boolean,
): AppState {
  return mapFocusedCell(state, (focusedCell, cursor) => {
    const source = focusedCell.source;
    const offset = cursorToOffset(source, cursor);

    if (linewise) {
      const lines = getLines(source);
      const insertionIndex = before ? cursor.row : cursor.row + 1;
      const insertedLines = getLines(text.replace(/\n$/, ""));
      lines.splice(insertionIndex, 0, ...insertedLines);
      const nextSource = sourceFromLines(lines);
      return {
        cell: { ...focusedCell, source: nextSource },
        cursor: { row: insertionIndex, col: 0 },
      };
    }

    const insertOffset = before ? offset : Math.min(offset + 1, source.length);
    const nextSource = `${source.slice(0, insertOffset)}${text}${source.slice(insertOffset)}`;
    const nextCursor = offsetToCursor(nextSource, Math.max(0, insertOffset + text.length - 1));
    return {
      cell: { ...focusedCell, source: nextSource },
      cursor: nextCursor,
    };
  });
}

export function findCharacterOnLine(
  state: AppState,
  char: string,
  direction: "forward" | "backward",
  till: boolean,
): AppState {
  const cell = getFocusedCell(state);
  if (!cell) {
    return state;
  }
  const cursor = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const lines = getLines(cell.source);
  const line = lines[cursor.row] ?? "";
  const startIndex = direction === "forward" ? cursor.col + 1 : cursor.col - 1;
  const index =
    direction === "forward" ? line.indexOf(char, Math.max(0, startIndex)) : line.lastIndexOf(char, Math.max(0, startIndex));
  if (index === -1) {
    return state;
  }
  const col = till ? index + (direction === "forward" ? -1 : 1) : index;
  return {
    ...state,
    ui: {
      ...state.ui,
      cursorByCellId: {
        ...state.ui.cursorByCellId,
        [cell.id]: { row: cursor.row, col: Math.max(0, Math.min(col, line.length)) },
      },
      pendingOperator: null,
      pendingMotion: null,
      lastFind: { char, direction, till },
      statusMessage: "Cursor moved.",
    },
  };
}

export function repeatLastFind(state: AppState, reverse: boolean): AppState {
  const find = state.ui.lastFind;
  if (!find) {
    return state;
  }
  const direction =
    reverse
      ? find.direction === "forward"
        ? "backward"
        : "forward"
      : find.direction;
  return findCharacterOnLine(state, find.char, direction, find.till);
}

export function insertCellRelative(state: AppState, delta: 0 | 1): AppState {
  const currentIndex = getCellIndex(state, state.ui.focusedCellId);
  if (currentIndex === -1) {
    return state;
  }
  const nextId = `cell-${state.notebook.present.nextCellId}`;
  const cell = createCell(nextId, "");
  const insertIndex = currentIndex + delta;

  return applyNotebookMutation(
    state,
    (document) => {
      document.cells.splice(insertIndex, 0, cell);
      document.nextCellId += 1;
    },
    {
      focusedCellId: nextId,
      lastVisitedCellId: state.ui.focusedCellId,
      focusTarget: "editor",
      mode: "insert",
      cursorByCellId: { ...state.ui.cursorByCellId, [nextId]: { row: 0, col: 0 } },
      statusMessage: "Inserted a new cell.",
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      pendingMotion: null,
      helpOpen: false,
      outputDialogCellId: null,
    },
  );
}

export function insertLineBelow(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const lines = getLines(cell.source);
    const insertionRow = cursor.row + 1;
    lines.splice(insertionRow, 0, "");
    return {
      cell: { ...cell, source: sourceFromLines(lines) },
      cursor: { row: insertionRow, col: 0 },
    };
  });
}

export function insertLineAbove(state: AppState): AppState {
  return mapFocusedCell(state, (cell, cursor) => {
    const lines = getLines(cell.source);
    const insertionRow = cursor.row;
    lines.splice(insertionRow, 0, "");
    return {
      cell: { ...cell, source: sourceFromLines(lines) },
      cursor: { row: insertionRow, col: 0 },
    };
  });
}

export function toggleCellKind(state: AppState): AppState {
  const cell = getFocusedCell(state);
  if (!cell) return state;
  const newKind: CellKind = cell.kind === "code" ? "markdown" : "code";
  return applyNotebookMutation(
    state,
    (document) => {
      const c = document.cells.find((c) => c.id === cell.id);
      if (c) {
        c.kind = newKind;
        if (newKind === "markdown") {
          c.executionCount = null;
          c.outputs = [];
        }
      }
    },
    {
      statusMessage: `Cell type: ${newKind}`,
    },
  );
}

export function getVisualSelectionOffsets(state: AppState): { start: number; end: number } | null {
  if (state.ui.mode !== "visual" || !state.ui.selectionAnchorCursor) {
    return null;
  }
  const cell = getFocusedCell(state);
  if (!cell) {
    return null;
  }
  const current = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const anchor = clampCursor(cell.source, state.ui.selectionAnchorCursor);
  const currentOffset = cursorToOffset(cell.source, current);
  const anchorOffset = cursorToOffset(cell.source, anchor);
  return {
    start: Math.min(anchorOffset, currentOffset),
    end: Math.max(anchorOffset, currentOffset),
  };
}

export function getVisualLineSelectionRows(
  state: AppState,
): { startRow: number; endRow: number } | null {
  if (state.ui.mode !== "visual_line" || !state.ui.selectionAnchorCursor) {
    return null;
  }
  const cell = getFocusedCell(state);
  if (!cell) {
    return null;
  }
  const current = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  return {
    startRow: Math.min(state.ui.selectionAnchorCursor.row, current.row),
    endRow: Math.max(state.ui.selectionAnchorCursor.row, current.row),
  };
}

export function getVisualLineSelectionOffsets(
  state: AppState,
): { start: number; end: number } | null {
  const rows = getVisualLineSelectionRows(state);
  const cell = getFocusedCell(state);
  if (!rows || !cell) {
    return null;
  }

  const lines = getLines(cell.source);
  let start = 0;
  for (let row = 0; row < rows.startRow; row += 1) {
    start += (lines[row]?.length ?? 0) + 1;
  }

  let end = start;
  for (let row = rows.startRow; row <= rows.endRow; row += 1) {
    end += (lines[row]?.length ?? 0);
    if (row < rows.endRow || row < lines.length - 1) {
      end += 1;
    }
  }

  return { start, end };
}

function getSelectedCellIds(state: AppState): string[] {
  if (state.ui.mode !== "cell_visual" || !state.ui.selectionAnchorCellId) {
    return [state.ui.focusedCellId];
  }

  const currentIndex = getCellIndex(state, state.ui.focusedCellId);
  const anchorIndex = getCellIndex(state, state.ui.selectionAnchorCellId);
  if (currentIndex === -1 || anchorIndex === -1) {
    return [state.ui.focusedCellId];
  }

  const start = Math.min(currentIndex, anchorIndex);
  const end = Math.max(currentIndex, anchorIndex);
  return state.notebook.present.cells.slice(start, end + 1).map((cell) => cell.id);
}

export function copySelectedCells(state: AppState): AppState {
  const selectedCellIds = getSelectedCellIds(state);
  const cells = state.notebook.present.cells
    .filter((cell) => selectedCellIds.includes(cell.id))
    .map((cell) => ({ ...cell, outputs: [...cell.outputs] }));
  const clipboard: ClipboardData = { kind: "cells", cells };
  writeSystemClipboard(clipboard);

  return applyNotebookMutation(
    state,
    (document) => {
      document.clipboard = clipboard;
    },
    {
      mode: "normal",
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      statusMessage: `Copied ${cells.length} cell${cells.length === 1 ? "" : "s"}.`,
    },
  );
}

export function copyVisualSelection(state: AppState): AppState {
  const selection = getVisualSelectionOffsets(state);
  const cell = getFocusedCell(state);
  if (!selection || !cell) {
    return state;
  }

  const clipboard: ClipboardData = {
    kind: "text",
    text: cell.source.slice(selection.start, selection.end),
    linewise: false,
  };
  writeSystemClipboard(clipboard);

  return applyNotebookMutation(
    state,
    (document) => {
      document.clipboard = clipboard;
    },
    {
      mode: "normal",
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      statusMessage: "Yanked selection.",
    },
  );
}

export function copyVisualLineSelection(state: AppState): AppState {
  const selection = getVisualLineSelectionOffsets(state);
  const cell = getFocusedCell(state);
  if (!selection || !cell) {
    return state;
  }

  const clipboard: ClipboardData = {
    kind: "text",
    text: cell.source.slice(selection.start, selection.end),
    linewise: true,
  };
  writeSystemClipboard(clipboard);

  return applyNotebookMutation(
    state,
    (document) => {
      document.clipboard = clipboard;
    },
    {
      mode: "normal",
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      statusMessage: "Yanked selected lines.",
    },
  );

}

function pasteCellClipboardAfterFocus(
  state: AppState,
  clipboardData: ClipboardData & { kind: "cells" },
): AppState {
  if (clipboardData.cells.length === 0) {
    return {
      ...state,
      ui: { ...state.ui, statusMessage: "Clipboard is empty.", pendingOperator: null },
    };
  }

  const currentIndex = getCellIndex(state, state.ui.focusedCellId);
  if (currentIndex === -1) {
    return state;
  }

  const nextCells = clipboardData.cells.map((cell, index) => ({
    ...cell,
    id: `cell-${state.notebook.present.nextCellId + index}`,
    outputs: [...cell.outputs],
  }));

  return applyNotebookMutation(
    state,
    (document) => {
      document.cells.splice(currentIndex + 1, 0, ...nextCells);
      document.nextCellId += nextCells.length;
    },
    {
      focusedCellId: nextCells[0]?.id ?? state.ui.focusedCellId,
      statusMessage: `Pasted ${nextCells.length} cell${nextCells.length === 1 ? "" : "s"}.`,
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      pendingMotion: null,
    },
  );
}

function pasteTextClipboardAtCursor(
  state: AppState,
  clipboard: ClipboardData & { kind: "text" },
  before = false,
): AppState {
  return pasteTextAtCursor(state, clipboard.text, clipboard.linewise, before);
}

export function pasteClipboard(state: AppState, before = false): AppState {
  const clipboard = state.notebook.present.clipboard;
  if (!clipboard) {
    return {
      ...state,
      ui: { ...state.ui, statusMessage: "Clipboard is empty.", pendingOperator: null },
    };
  }

  return clipboard.kind === "cells"
    ? pasteCellClipboardAfterFocus(state, clipboard)
    : pasteTextClipboardAtCursor(state, clipboard, before);
}

export function deleteVisualSelection(state: AppState): AppState {
  const selection = getVisualSelectionOffsets(state);
  if (!selection) {
    return state;
  }
  return mapFocusedCell(state, (cell) => {
    const nextSource = `${cell.source.slice(0, selection.start)}${cell.source.slice(selection.end)}`;
    const nextCursor = offsetToCursor(nextSource, selection.start);
    return {
      cell: { ...cell, source: nextSource },
      cursor: nextCursor,
    };
  });
}

export function deleteVisualLineSelection(state: AppState): AppState {
  const selection = getVisualLineSelectionRows(state);
  if (!selection) {
    return state;
  }
  return mapFocusedCell(state, (cell) => {
    const lines = getLines(cell.source);
    const nextLines = lines.filter(
      (_, index) => index < selection.startRow || index > selection.endRow,
    );
    const normalizedLines = nextLines.length === 0 ? [""] : nextLines;
    const nextSource = sourceFromLines(normalizedLines);
    const nextCursor = clampCursor(nextSource, {
      row: Math.min(selection.startRow, normalizedLines.length - 1),
      col: 0,
    });
    return {
      cell: { ...cell, source: nextSource },
      cursor: nextCursor,
    };
  });
}

export function deleteSelectedCells(state: AppState): AppState {
  if (state.notebook.present.cells.length === 1) {
    return applyNotebookMutation(
      state,
      (document) => {
        document.cells[0] = createCell(state.ui.focusedCellId, "");
      },
      {
        statusMessage: "Cleared the last remaining cell.",
        mode: "normal",
        selectionAnchorCellId: null,
        selectionAnchorCursor: null,
        pendingMotion: null,
      },
    );
  }

  const selectedCellIds = new Set(getSelectedCellIds(state));
  const remainingCells = state.notebook.present.cells.filter(
    (cell) => !selectedCellIds.has(cell.id),
  );
  const firstRemovedIndex = state.notebook.present.cells.findIndex((cell) =>
    selectedCellIds.has(cell.id),
  );
  const nextFocusIndex = Math.max(
    0,
    Math.min(firstRemovedIndex, remainingCells.length - 1),
  );
  const nextFocusedCellId =
    remainingCells[nextFocusIndex]?.id ??
    remainingCells[0]?.id ??
    state.ui.focusedCellId;
  const nextCursorByCellId = Object.fromEntries(
    Object.entries(state.ui.cursorByCellId).filter(([cellId]) => !selectedCellIds.has(cellId)),
  );

  return applyNotebookMutation(
    state,
    (document) => {
      document.cells = document.cells.filter((cell) => !selectedCellIds.has(cell.id));
    },
    {
      focusedCellId: nextFocusedCellId,
      lastVisitedCellId:
        nextFocusedCellId !== state.ui.focusedCellId ? state.ui.focusedCellId : state.ui.lastVisitedCellId,
      focusTarget: "editor",
      cursorByCellId: nextCursorByCellId,
      statusMessage: "Deleted selected cell(s).",
      mode: "normal",
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      pendingMotion: null,
    },
  );
}

export function deleteFocusedCellAndRestorePrevious(state: AppState): AppState {
  if (state.notebook.present.cells.length === 1) {
    return applyNotebookMutation(
      state,
      (document) => {
        document.cells[0] = createCell(state.ui.focusedCellId, "");
      },
      {
        focusedCellId: state.ui.focusedCellId,
        lastVisitedCellId: null,
        focusTarget: "editor",
        statusMessage: "Cleared the last remaining cell.",
        mode: "normal",
        selectionAnchorCellId: null,
        selectionAnchorCursor: null,
        pendingMotion: null,
      },
    );
  }

  const currentCellId = state.ui.focusedCellId;
  const remainingCells = state.notebook.present.cells.filter((cell) => cell.id !== currentCellId);
  const preferredFocusId = state.ui.lastVisitedCellId
    ? remainingCells.find((cell) => cell.id === state.ui.lastVisitedCellId)?.id ?? null
    : null;
  const currentIndex = getCellIndex(state, currentCellId);
  const fallbackFocusId =
    remainingCells[Math.max(0, Math.min(currentIndex, remainingCells.length - 1))]?.id ??
    remainingCells[0]?.id ??
    currentCellId;
  const nextFocusedCellId = preferredFocusId ?? fallbackFocusId;
  const nextCursorByCellId = Object.fromEntries(
    Object.entries(state.ui.cursorByCellId).filter(([cellId]) => cellId !== currentCellId),
  );

  return applyNotebookMutation(
    state,
    (document) => {
      document.cells = document.cells.filter((cell) => cell.id !== currentCellId);
    },
    {
      focusedCellId: nextFocusedCellId,
      lastVisitedCellId: currentCellId,
      focusTarget: "editor",
      cursorByCellId: nextCursorByCellId,
      statusMessage: "Deleted cell.",
      mode: "normal",
      selectionAnchorCellId: null,
      selectionAnchorCursor: null,
      pendingOperator: null,
      pendingMotion: null,
    },
  );
}

export function moveFocusToBoundary(state: AppState, edge: "start" | "end"): AppState {
  const nextCellId =
    edge === "start"
      ? state.notebook.present.cells[0]?.id
      : state.notebook.present.cells.at(-1)?.id;
  if (!nextCellId) {
    return state;
  }
  return {
    ...state,
    ui: {
      ...state.ui,
      focusedCellId: nextCellId,
      lastVisitedCellId:
        nextCellId !== state.ui.focusedCellId ? state.ui.focusedCellId : state.ui.lastVisitedCellId,
      focusTarget: "editor",
      pendingOperator: null,
      pendingMotion: null,
      selectionAnchorCellId:
        state.ui.mode === "visual_line" ? state.ui.selectionAnchorCellId : null,
      selectionAnchorCursor:
        state.ui.mode === "visual" ? state.ui.selectionAnchorCursor : null,
      statusMessage: edge === "start" ? "Moved to first cell." : "Moved to last cell.",
    },
  };
}

export function clearCellOutputs(state: AppState, cellId: string): AppState {
  return applyNotebookMutation(state, (document) => {
    document.cells = document.cells.map((cell) =>
      cell.id === cellId ? { ...cell, outputs: [], executionCount: null } : cell,
    );
  });
}

export function applyExecutionResult(
  state: AppState,
  cellId: string,
  result: {
    outputs: NotebookOutput[];
    executionCount: number;
  },
): AppState {
  return applyNotebookMutation(state, (document) => {
    document.executionCounter = Math.max(document.executionCounter, result.executionCount);
    document.cells = document.cells.map((cell) =>
      cell.id === cellId
        ? {
            ...cell,
            executionCount: result.executionCount,
            outputs: result.outputs,
          }
        : cell,
    );
  });
}

export function appendCellOutput(
  state: AppState,
  cellId: string,
  output: NotebookOutput,
): AppState {
  return applyNotebookMutation(state, (document) => {
    const cell = document.cells.find((c) => c.id === cellId);
    if (!cell) return;
    cell.outputs = applyNotebookOutput(cell.outputs, output);
  });
}
