import { createCliRenderer, SyntaxStyle, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { basename, isAbsolute, join } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  appendCellOutput,
  applyExecutionResult,
  backspaceAtCursor,
  clearCellOutputs,
  copySelectedCells,
  copyVisualLineSelection,
  copyVisualSelection,
  changeWordForward,
  createAppStateFromDocument,
  createInitialAppState,
  defaultCursorForCell,
  deleteCharAtCursor,
  deleteCurrentLine,
  deleteToEndOfLine,
  deleteWordBackward,
  deleteWordForward,
  deleteSelectedCells,
  deleteVisualLineSelection,
  deleteVisualSelection,
  findCharacterOnLine,
  getCellIndex,
  getFocusedCell,
  getLines,
  getVisualLineSelectionOffsets,
  getVisualSelectionOffsets,
  insertCellRelative,
  insertTextAtCursor,
  joinLineBelow,
  moveCursor,
  moveCursorToFirstNonWhitespace,
  moveCursorToCellBoundary,
  moveCursorByWord,
  moveCursorToLineBoundary,
  moveFocusToBoundary,
  moveFocusToRelativeCell,
  pasteClipboard,
  repeatLastFind,
  redoNotebook,
  setClipboardText,
  undoNotebook,
  toggleCellKind,
  yankCurrentLine,
  yankWordForward,
} from "./notebook-state";
import { deserializeIpynb, serializeIpynb } from "./ipynb";
import { executeNotebookCell } from "./notebook-execution";
import { getDisplayLines } from "./output-model";
import { PythonSession, resolvePython } from "./python-session";
import { themes } from "./theme";
import type { AppState, NotebookCell, NotebookOutput } from "./types";

type ParsedArgs = {
  pythonPath?: string;
  venvPath?: string;
  themeName?: "monokai";
  notebookPath?: string;
  render?: boolean;
  renderPause?: number;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) {
      continue;
    }
    if (value === "--python") {
      parsed.pythonPath = argv[index + 1];
      index += 1;
    } else if (value === "--venv") {
      parsed.venvPath = argv[index + 1];
      index += 1;
    } else if (value === "--theme") {
      parsed.themeName = (argv[index + 1] as "monokai") ?? "monokai";
      index += 1;
    } else if (value === "--render") {
      parsed.render = true;
    } else if (value === "--pause") {
      parsed.renderPause = Number(argv[index + 1]) || 1000;
      index += 1;
    } else if (!value.startsWith("-") && !parsed.notebookPath) {
      parsed.notebookPath = isAbsolute(value) ? value : join(process.cwd(), value);
    }
  }
  return parsed;
}

function withStatus(state: AppState, statusMessage: string): AppState {
  return {
    ...state,
    ui: { ...state.ui, statusMessage, pendingOperator: null, pendingMotion: null },
  };
}

function isPrintableKey(sequence: string) {
  return sequence.length === 1 && sequence >= " " && sequence !== "\u007f";
}

function truncateText(value: string, maxWidth: number) {
  if (value.length <= maxWidth) {
    return value;
  }
  if (maxWidth <= 1) {
    return "…";
  }
  return `${value.slice(0, maxWidth - 1)}…`;
}

function renderEditorLines(cell: NotebookCell, state: AppState) {
  const cursor = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const lines = getLines(cell.source);

  return lines.map((line, index) => {
    const isCursorLine = index === cursor.row;
    return { lineNumber: index + 1, text: line, isCursorLine };
  });
}

function renderImageOutput(output: Extract<NotebookOutput, { kind: "image" }>, theme: {
  muted: string;
  border: string;
  panelAlt: string;
  text: string;
}) {
  return (
    <box
      flexDirection="column"
      marginTop={1}
      paddingX={1}
      paddingY={1}
      border
      borderStyle="rounded"
      borderColor={theme.border}
      backgroundColor={theme.panelAlt}
    >
      <text fg={theme.muted}>
        {output.mimeType} {output.width > 0 && output.height > 0 ? `(${output.width}x${output.height})` : ""}
      </text>
      {output.preview && output.preview.length > 0 ? (
        <box flexDirection="column" marginTop={1}>
          {output.preview.map((row, rowIndex) => (
            <text key={`img-row-${rowIndex}`}>
              {row.map((span, spanIndex) => (
                <span key={`img-span-${rowIndex}-${spanIndex}`} fg={span.fg} bg={span.bg}>
                  {span.text}
                </span>
              ))}
            </text>
          ))}
        </box>
      ) : (
        <text fg={theme.text}>{output.alt}</text>
      )}
    </box>
  );
}

function renderTextOutput(
  output: Extract<NotebookOutput, { kind: "stream" | "result" | "error" }>,
  keyPrefix: string,
  color: string,
) {
  return getDisplayLines(output.text).map((line, lineIndex) => (
    <text key={`${keyPrefix}-line-${lineIndex}`} fg={color}>
      {line.length > 0 ? line : " "}
    </text>
  ));
}

function renderActiveLine(
  line: string,
  isActive: boolean,
  isCursorLine: boolean,
  cursorCol: number,
  mode: AppState["ui"]["mode"],
  theme: {
    text: string;
    borderActive: string;
    accent: string;
    selection: string;
    selectionText: string;
  },
  selection: { start: number; end: number } | null,
  lineStartOffset: number,
) {
  const text = line.length === 0 ? " " : line;

  if (!selection) {
    if (!isActive || !isCursorLine) {
      return <text fg={theme.text}>{text}</text>;
    }

    const cursorIndex = Math.min(cursorCol, line.length);
    const before = line.slice(0, cursorIndex);
    const currentChar = line[cursorIndex] ?? " ";
    const after = line.slice(line[cursorIndex] ? cursorIndex + 1 : cursorIndex);

    if (mode === "insert") {
      return (
        <text fg={theme.text}>
          {before}
          <span fg={theme.borderActive}>|</span>
          {currentChar}
          {after.length === 0 ? "" : after}
        </text>
      );
    }

    const cursorBg = theme.borderActive;

    return (
      <text fg={theme.text}>
        {before}
        <span fg="#000000" bg={cursorBg}>
          {currentChar}
        </span>
        {after.length === 0 ? "" : after}
      </text>
    );
  }

  const spans: Array<{ text: string; selected: boolean; cursor: boolean }> = [];
  let currentText = "";
  let currentSelected = false;

  for (let index = 0; index < text.length; index += 1) {
    const absoluteOffset = lineStartOffset + index;
    const selected =
      absoluteOffset >= selection.start && absoluteOffset < selection.end;
    const cursor = isActive && isCursorLine && index === Math.min(cursorCol, line.length);

    if (currentText.length === 0) {
      currentText = text[index] ?? " ";
      currentSelected = selected;
      if (cursor) {
        spans.push({ text: currentText, selected: currentSelected, cursor: true });
        currentText = "";
      }
      continue;
    }

    if (selected === currentSelected && !cursor) {
      currentText += text[index] ?? " ";
      continue;
    }

    spans.push({ text: currentText, selected: currentSelected, cursor: false });
    currentText = text[index] ?? " ";
    currentSelected = selected;
    if (cursor) {
      spans.push({ text: currentText, selected: currentSelected, cursor: true });
      currentText = "";
    }
  }

  if (currentText.length > 0) {
    spans.push({ text: currentText, selected: currentSelected, cursor: false });
  }

  if (isActive && isCursorLine && cursorCol >= line.length) {
    spans.push({ text: " ", selected: false, cursor: true });
  }

  return (
    <text fg={theme.text}>
      {spans.map((span, index) =>
        span.cursor ? (
          <span
            key={`cursor-${index}`}
            fg="#000000"
            bg={span.selected ? theme.selection : theme.borderActive}
          >
            {span.text}
          </span>
        ) : span.selected ? (
          <span key={`sel-${index}`} fg={theme.selectionText} bg={theme.selection}>
            {span.text}
          </span>
        ) : (
          <span key={`txt-${index}`} fg={theme.text}>
            {span.text}
          </span>
        ),
      )}
    </text>
  );
}

function App() {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const args = useMemo(() => parseArgs(Bun.argv.slice(2)), []);
  const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);
  const [state, setState] = useState(() => {
    const initial = createInitialAppState();
    if (args.themeName) {
      initial.ui.themeName = args.themeName;
    }
    if (args.notebookPath) {
      initial.ui.notebookPath = args.notebookPath;
    }
    return initial;
  });
  const sessionRef = useRef<PythonSession | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const theme = themes[state.ui.themeName];
  const notebookWidth = Math.min(120, Math.max(72, width - 6));
  const bodyHeight = Math.max(10, height - 4);

  useEffect(() => () => syntaxStyle.destroy(), [syntaxStyle]);

  useEffect(() => {
    const sb = scrollRef.current;
    if (sb) {
      sb.scrollChildIntoView(state.ui.focusedCellId);
    }
  }, [state.ui.focusedCellId, state.notebook.present]);

  useEffect(() => {
    if (!args.notebookPath) {
      return;
    }

    let cancelled = false;

    async function loadNotebook() {
      try {
        const text = await Bun.file(args.notebookPath!).text();
        const document = deserializeIpynb(text);
        if (cancelled) {
          return;
        }
        setState((current) => {
          const next = createAppStateFromDocument(document, args.notebookPath ?? null);
          next.ui.themeName = current.ui.themeName;
          next.kernel = current.kernel;
          next.ui.statusMessage = `Opened ${basename(args.notebookPath!)}`;
          return next;
        });
      } catch (error) {
        setState((current) =>
          withStatus(
            current,
            error instanceof Error
              ? `Failed to open ${basename(args.notebookPath!)}: ${error.message}`
              : "Failed to open notebook.",
          ),
        );
      }
    }

    void loadNotebook();

    return () => {
      cancelled = true;
    };
  }, [args.notebookPath]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const resolution = await resolvePython(
          { pythonPath: args.pythonPath, venvPath: args.venvPath },
          process.cwd(),
        );
        const session = new PythonSession(resolution.pythonPath);
        const backend = await session.backendInfo();
        sessionRef.current = session;
        if (cancelled) {
          await session.stop();
          return;
        }
        setState((current) => ({
          ...current,
          kernel: {
            ...current.kernel,
            status: "idle",
            interpreterPath: resolution.pythonPath,
            provider: backend.backend,
            lastError: null,
          },
          ui: {
            ...current.ui,
            statusMessage: backend.detail
              ? truncateText(backend.detail, 120)
              : "Python ready.",
          },
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          kernel: {
            ...current.kernel,
            status: "error",
            lastError: error instanceof Error ? error.message : String(error),
          },
          ui: {
            ...current.ui,
            statusMessage:
              error instanceof Error ? error.message : "Failed to resolve Python.",
          },
        }));
      }
    }

    void start();

    return () => {
      cancelled = true;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        void session.stop();
      }
    };
  }, [args.pythonPath, args.venvPath]);

  const renderStartedRef = useRef(false);

  useEffect(() => {
    if (!args.render) return;
    if (state.kernel.status !== "idle") return;
    if (renderStartedRef.current) return;
    renderStartedRef.current = true;

    const pause = args.renderPause ?? 1000;

    async function autoRun() {
      // Clear all outputs first
      setState((current) => {
        const next = structuredClone(current) as AppState;
        next.notebook.present = {
          ...current.notebook.present,
          cells: current.notebook.present.cells.map((cell) => ({
            ...cell,
            outputs: [],
            executionCount: null,
          })),
        };
        next.ui.statusMessage = "Render mode: starting...";
        return next;
      });

      await new Promise((r) => setTimeout(r, pause));

      const cells = state.notebook.present.cells;
      const session = sessionRef.current;
      if (!session) return;

      for (let i = 0; i < cells.length; i++) {
        const cellId = cells[i]!.id;

        // Focus this cell
        setState((current) => ({
          ...current,
          ui: {
            ...current.ui,
            focusedCellId: cellId,
            statusMessage: `Render: running cell ${i + 1}/${cells.length}...`,
          },
        }));

        await new Promise((r) => setTimeout(r, pause / 2));

        // Run it
        setState((current) => ({
          ...clearCellOutputs(current, cellId),
          kernel: { ...current.kernel, status: "busy", currentCellId: cellId, lastError: null },
        }));

        try {
          const cellSource = cells[i]!.source;
          const result = await executeNotebookCell(session, cellSource, (event) => {
            if (event.type === "output") {
              setState((current) => appendCellOutput(current, cellId, event.output));
            }
          });
          setState((current) => ({
            ...applyExecutionResult(current, cellId, {
              executionCount: result.executionCount,
              outputs: result.outputs,
            }),
            kernel: { ...current.kernel, status: "idle", currentCellId: null, lastError: result.error },
            ui: {
              ...current.ui,
              statusMessage: `Render: executed cell ${i + 1}/${cells.length}.`,
            },
          }));
        } catch (error) {
          setState((current) => ({
            ...current,
            kernel: { ...current.kernel, status: "error", currentCellId: null },
            ui: { ...current.ui, statusMessage: `Render: error in cell ${i + 1}.` },
          }));
          break;
        }

        await new Promise((r) => setTimeout(r, pause));
      }

      // Final pause then quit
      setState((current) => ({
        ...current,
        ui: { ...current.ui, statusMessage: "Render complete." },
      }));
      await new Promise((r) => setTimeout(r, pause));
      renderer.destroy();
    }

    void autoRun();
  }, [args.render, state.kernel.status]);

  async function runFocusedCell() {
    const session = sessionRef.current;
    const focusedCell = getFocusedCell(state);
    if (!focusedCell) return;
    if (focusedCell.kind === "markdown") {
      setState((current) => withStatus(current, "Markdown cells cannot be executed."));
      return;
    }
    if (!session) {
      setState((current) =>
        withStatus(current, "Python session is not ready. Resolve --python or ./.venv first."),
      );
      return;
    }

    setState((current) => ({
      ...clearCellOutputs(current, focusedCell.id),
      kernel: { ...current.kernel, status: "busy", currentCellId: focusedCell.id, lastError: null },
      ui: { ...current.ui, statusMessage: `Running ${focusedCell.id}...`, pendingOperator: null },
    }));

    try {
      const cellId = focusedCell.id;
      const result = await executeNotebookCell(session, focusedCell.source, (event) => {
        if (event.type === "output") {
          setState((current) => appendCellOutput(current, cellId, event.output));
        }
      });
      setState((current) => ({
        ...applyExecutionResult(current, cellId, {
          executionCount: result.executionCount,
          outputs: result.outputs,
        }),
        kernel: {
          ...current.kernel,
          status: "idle",
          currentCellId: null,
          lastError: result.error,
        },
        ui: {
          ...current.ui,
          statusMessage: result.error
            ? `Execution failed in ${cellId}.`
            : `Executed ${cellId}.`,
          pendingOperator: null,
        },
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        kernel: {
          ...current.kernel,
          status: "error",
          currentCellId: null,
          lastError: error instanceof Error ? error.message : String(error),
        },
        ui: {
          ...current.ui,
          statusMessage:
            error instanceof Error ? error.message : "Execution bridge failed unexpectedly.",
          pendingOperator: null,
        },
      }));
    }
  }

  async function runAllCells() {
    const session = sessionRef.current;
    if (!session) {
      setState((current) =>
        withStatus(current, "Python session is not ready. Resolve --python or ./.venv first."),
      );
      return;
    }

    const cellIds = state.notebook.present.cells.map((cell) => cell.id);
    setState((current) =>
      withStatus(
        {
          ...current,
          kernel: { ...current.kernel, status: "busy", currentCellId: null, lastError: null },
        },
        "Running all cells...",
      ),
    );

    for (const cellId of cellIds) {
      const currentCell = state.notebook.present.cells.find((cell) => cell.id === cellId);
      if (!currentCell) {
        continue;
      }
      setState((current) => ({
        ...clearCellOutputs(current, cellId),
        kernel: { ...current.kernel, status: "busy", currentCellId: cellId, lastError: null },
        ui: {
          ...current.ui,
          focusedCellId: cellId,
          statusMessage: `Running ${cellId}...`,
          pendingOperator: null,
          pendingMotion: null,
          commandBuffer: "",
        },
      }));
      try {
        const result = await executeNotebookCell(session, currentCell.source, (event) => {
          if (event.type === "output") {
            setState((current) => appendCellOutput(current, cellId, event.output));
          }
        });
        setState((current) => ({
          ...applyExecutionResult(current, cellId, {
            executionCount: result.executionCount,
            outputs: result.outputs,
          }),
          kernel: {
            ...current.kernel,
            status: "busy",
            currentCellId: null,
            lastError: result.error,
          },
          ui: {
            ...current.ui,
            statusMessage: `Executed ${cellId}.`,
            pendingOperator: null,
            pendingMotion: null,
            commandBuffer: "",
          },
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          kernel: {
            ...current.kernel,
            status: "error",
            currentCellId: cellId,
            lastError: error instanceof Error ? error.message : String(error),
          },
          ui: {
            ...current.ui,
            statusMessage:
              error instanceof Error ? error.message : `Execution failed in ${cellId}.`,
            pendingOperator: null,
            pendingMotion: null,
            commandBuffer: "",
            mode: "normal",
          },
        }));
        return;
      }
    }

    setState((current) => ({
      ...current,
      kernel: { ...current.kernel, status: "idle", currentCellId: null },
      ui: {
        ...current.ui,
        mode: "normal",
        commandBuffer: "",
        statusMessage: "Executed all cells.",
      },
    }));
  }

  function clearAllOutputs() {
    setState((current) => {
      const next = structuredClone(current) as AppState;
      next.notebook.past = [...current.notebook.past, current.notebook.present];
      next.notebook.future = [];
      next.notebook.present = {
        ...current.notebook.present,
        cells: current.notebook.present.cells.map((cell) => ({
          ...cell,
          outputs: [],
        })),
      };
      next.ui = {
        ...current.ui,
        mode: "normal",
        commandBuffer: "",
        statusMessage: "Cleared all outputs.",
      };
      return next;
    });
  }

  async function saveNotebook() {
    const path = state.ui.notebookPath ?? join(process.cwd(), "notebook.ipynb");
    await Bun.write(path, serializeIpynb(state.notebook.present));
    setState((current) => ({
      ...current,
      ui: {
        ...current.ui,
        mode: "normal",
        notebookPath: path,
        commandBuffer: "",
        statusMessage: `Saved ${path}`,
      },
    }));
  }

  async function executeCommand(rawCommand: string) {
    const command = rawCommand.trim();
    if (!command) {
      setState((current) => ({
        ...current,
        ui: { ...current.ui, mode: "normal", commandBuffer: "", statusMessage: "Normal mode." },
      }));
      return;
    }

    if (command === "q") {
      renderer.destroy();
      return;
    }

    if (command === "w") {
      await saveNotebook();
      return;
    }

    if (command === "wq") {
      await saveNotebook();
      renderer.destroy();
      return;
    }

    if (command === "r") {
      await runAllCells();
      return;
    }

    if (command === "clear" || command === "c") {
      clearAllOutputs();
      return;
    }

    setState((current) => ({
      ...current,
      ui: {
        ...current.ui,
        mode: "normal",
        commandBuffer: "",
        statusMessage: `Unknown command: :${command}`,
      },
    }));
  }

  function handleNormalMode(key: KeyEvent) {
    if (key.shift && key.name === "enter") {
      void runFocusedCell();
      return;
    }

    setState((current) => {
      if (key.ctrl && key.name === "c") {
        renderer.destroy();
        return current;
      }

      if (key.meta && key.name === "z") {
        return undoNotebook(current);
      }

      if (key.ctrl && key.name === "r") {
        return redoNotebook(current);
      }

      switch (key.name) {
        case "space":
          return {
            ...current,
            ui: {
              ...current.ui,
              pendingMotion: "leader",
              pendingOperator: null,
              statusMessage: "Leader pressed.",
            },
          };
        case "r":
          void runFocusedCell();
          return current;
        case ":":
          return {
            ...current,
            ui: {
              ...current.ui,
              mode: "command",
              commandBuffer: "",
              pendingOperator: null,
              pendingMotion: null,
              statusMessage: "Command mode.",
            },
          };
        case "i":
          if (key.shift) {
            const moved = moveCursorToFirstNonWhitespace(current);
            return {
              ...moved,
              ui: { ...moved.ui, mode: "insert", statusMessage: "Insert mode." },
            };
          }
          return {
            ...current,
            ui: {
              ...current.ui,
              mode: "insert",
              pendingOperator: null,
              pendingMotion: null,
              statusMessage: "Insert mode.",
            },
          };
        case "a": {
          if (key.shift) {
            const moved = moveCursorToLineBoundary(current, "end");
            return {
              ...moved,
              ui: { ...moved.ui, mode: "insert", statusMessage: "Insert mode." },
            };
          }
          const focusedCell = getFocusedCell(current);
          if (!focusedCell) {
            return current;
          }
          const moved = moveCursor(current, 0, 1);
          return {
            ...moved,
            ui: {
              ...moved.ui,
              mode: "insert",
              statusMessage: "Insert mode.",
            },
          };
        }
        case "v":
          if (key.shift) {
            return {
              ...current,
              ui: {
                ...current.ui,
                mode: "visual_line",
                selectionAnchorCellId: null,
                selectionAnchorCursor:
                  current.ui.cursorByCellId[current.ui.focusedCellId] ??
                  (getFocusedCell(current)
                    ? defaultCursorForCell(getFocusedCell(current)!)
                    : { row: 0, col: 0 }),
                pendingOperator: null,
                pendingMotion: null,
                statusMessage: "Visual line selection.",
              },
            };
          }
          if (current.ui.pendingMotion === "leader_v") {
            return {
              ...current,
              ui: {
                ...current.ui,
                mode: "cell_visual",
                selectionAnchorCellId: current.ui.focusedCellId,
                selectionAnchorCursor: null,
                pendingOperator: null,
                pendingMotion: null,
                statusMessage: "Visual cell selection.",
              },
            };
          }
          if (current.ui.pendingMotion === "leader") {
            return {
              ...current,
              ui: {
                ...current.ui,
                pendingMotion: "leader_v",
                pendingOperator: null,
                statusMessage: "Leader v pending. Press v again for cell selection.",
              },
            };
          }
          return {
            ...current,
            ui: {
              ...current.ui,
              mode: "visual",
              selectionAnchorCellId: null,
              selectionAnchorCursor:
                current.ui.cursorByCellId[current.ui.focusedCellId] ??
                (getFocusedCell(current)
                  ? defaultCursorForCell(getFocusedCell(current)!)
                  : { row: 0, col: 0 }),
              pendingOperator: null,
              pendingMotion: null,
              statusMessage: "Visual selection.",
            },
          };
        case "escape":
          return withStatus(current, "Normal mode.");
        case "left":
        case "h":
          if (key.option || key.meta) {
            return moveCursorByWord(current, "backward");
          }
          return moveCursor(current, 0, -1);
        case "right":
        case "l":
          if (key.option || key.meta) {
            return moveCursorByWord(current, "forward");
          }
          return moveCursor(current, 0, 1);
        case "up":
        case "k":
          return moveCursor(current, -1, 0);
        case "down":
        case "j":
          if (key.shift) {
            return joinLineBelow(current);
          }
          return moveCursor(current, 1, 0);
        case "0":
          return moveCursorToLineBoundary(current, "start");
        case "home":
          return moveCursorToFirstNonWhitespace(current);
        case "6":
          if (key.shift) {
            return moveCursorToFirstNonWhitespace(current);
          }
          return current;
        case "$":
          return moveCursorToLineBoundary(current, "end");
        case "{":
          return moveFocusToRelativeCell(current, -1);
        case "}":
          return moveFocusToRelativeCell(current, 1);
        case "o":
          if (key.shift) {
            return insertCellRelative(current, 0);
          }
          return insertCellRelative(current, 1);
        case "m":
          if (key.shift) {
            return toggleCellKind(current);
          }
          return current;
        case "b":
          if (key.shift) {
            return insertCellRelative(current, 1);
          }
          if (current.ui.pendingOperator === "delete") {
            return deleteWordForward(current);
          }
          if (current.ui.pendingOperator === "change") {
            const changed = changeWordForward(current);
            return { ...changed, ui: { ...changed.ui, mode: "insert", statusMessage: "Insert mode." } };
          }
          if (current.ui.pendingOperator === "yank") {
            return yankWordForward(current);
          }
          return moveCursorByWord(current, "backward");
        case "x":
          return deleteCharAtCursor(current);
        case "u":
          return undoNotebook(current);
        case "z":
          if (key.shift) {
            return undoNotebook(current);
          }
          return current;
        case "w":
          if (current.ui.pendingOperator === "delete") {
            return deleteWordForward(current);
          }
          if (current.ui.pendingOperator === "change") {
            const changed = changeWordForward(current);
            return { ...changed, ui: { ...changed.ui, mode: "insert", statusMessage: "Insert mode." } };
          }
          if (current.ui.pendingOperator === "yank") {
            return yankWordForward(current);
          }
          return moveCursorByWord(current, "forward");
        case "e":
          return moveCursorByWord(current, "end");
        case "d":
          if (key.shift) {
            return deleteToEndOfLine(current);
          }
          if (current.ui.pendingOperator === "delete") {
            return deleteCurrentLine(current);
          }
          return {
            ...current,
            ui: {
              ...current.ui,
              pendingOperator: "delete",
              pendingMotion: null,
              statusMessage: "d pending.",
            },
          };
        case "c":
          if (key.shift) {
            const changed = deleteToEndOfLine(current);
            return { ...changed, ui: { ...changed.ui, mode: "insert", statusMessage: "Insert mode." } };
          }
          if (current.ui.pendingOperator === "change") {
            const changed = deleteCurrentLine(current);
            return { ...changed, ui: { ...changed.ui, mode: "insert", statusMessage: "Insert mode." } };
          }
          return {
            ...current,
            ui: {
              ...current.ui,
              pendingOperator: "change",
              pendingMotion: null,
              statusMessage: "c pending.",
            },
          };
        case "s":
          if (key.shift) {
            const deleted = deleteCurrentLine(current);
            return { ...deleted, ui: { ...deleted.ui, mode: "insert", statusMessage: "Insert mode." } };
          }
          return {
            ...deleteCharAtCursor(current),
            ui: { ...current.ui, mode: "insert", pendingOperator: null, pendingMotion: null, statusMessage: "Insert mode." },
          };
        case "y":
          if (key.shift) {
            return yankCurrentLine(current);
          }
          if (current.ui.pendingOperator === "yank") {
            return yankCurrentLine(current);
          }
          return {
            ...current,
            ui: {
              ...current.ui,
              pendingOperator: "yank",
              pendingMotion: null,
              statusMessage: "y pending.",
            },
          };
        case "p":
          if (key.shift) {
            return pasteClipboard(current, true);
          }
          return pasteClipboard(current);
        case "g":
          if (key.shift) {
            return moveCursorToCellBoundary(current, "end");
          }
          if (current.ui.pendingMotion === "goto") {
            return moveCursorToCellBoundary(current, "start");
          }
          return {
            ...current,
            ui: {
              ...current.ui,
              pendingMotion: "goto",
              pendingOperator: null,
              statusMessage: "g pending.",
            },
          };
        case "f":
          return {
            ...current,
            ui: {
              ...current.ui,
              pendingMotion: key.shift ? "find_backward" : "find_forward",
              pendingOperator: null,
              statusMessage: key.shift ? "F pending." : "f pending.",
            },
          };
        case "t":
          return {
            ...current,
            ui: {
              ...current.ui,
              pendingMotion: key.shift ? "till_backward" : "till_forward",
              pendingOperator: null,
              statusMessage: key.shift ? "T pending." : "t pending.",
            },
          };
        case ";":
          return repeatLastFind(current, false);
        case ",":
          return repeatLastFind(current, true);
        case "return":
        case "enter":
          return {
            ...current,
            ui: {
              ...current.ui,
              mode: "insert",
              pendingOperator: null,
              pendingMotion: null,
              statusMessage: "Insert mode.",
            },
          };
        default:
          if (
            current.ui.pendingMotion === "find_forward" ||
            current.ui.pendingMotion === "find_backward" ||
            current.ui.pendingMotion === "till_forward" ||
            current.ui.pendingMotion === "till_backward"
          ) {
            if (isPrintableKey(key.sequence)) {
              const direction =
                current.ui.pendingMotion === "find_backward" || current.ui.pendingMotion === "till_backward"
                  ? "backward"
                  : "forward";
              const till =
                current.ui.pendingMotion === "till_forward" || current.ui.pendingMotion === "till_backward";
              return findCharacterOnLine(current, key.sequence, direction, till);
            }
          }
          if (
            current.ui.pendingMotion === "goto" ||
            current.ui.pendingMotion === "leader" ||
            current.ui.pendingMotion === "leader_v"
          ) {
            return withStatus(current, "Cancelled pending motion.");
          }
          return current;
      }
    });
  }

  function handleInsertMode(key: KeyEvent) {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      return;
    }

    setState((current) => {
      if (key.name === "escape") {
        return {
          ...current,
          ui: {
            ...current.ui,
            mode: "normal",
            pendingOperator: null,
            pendingMotion: null,
            statusMessage: "Normal mode.",
          },
        };
      }

      switch (key.name) {
        case "backspace":
          if (key.option || key.meta) {
            return deleteWordBackward(current);
          }
          return backspaceAtCursor(current);
        case "delete":
          if (key.option || key.meta) {
            return deleteWordBackward(current);
          }
          return deleteCharAtCursor(current);
        case "left":
          if (key.option || key.meta) {
            return moveCursorByWord(current, "backward");
          }
          return moveCursor(current, 0, -1);
        case "right":
          if (key.option || key.meta) {
            return moveCursorByWord(current, "forward");
          }
          return moveCursor(current, 0, 1);
        case "up":
          return moveCursor(current, -1, 0);
        case "down":
          return moveCursor(current, 1, 0);
        case "tab":
          return insertTextAtCursor(current, "  ");
        case "return":
        case "enter":
          return insertTextAtCursor(current, "\n");
        default:
          if (isPrintableKey(key.sequence) && !key.ctrl && !key.meta) {
            return insertTextAtCursor(current, key.sequence);
          }
          return current;
      }
    });
  }

  function handleCommandMode(key: KeyEvent) {
    if (key.name === "escape") {
      setState((current) => ({
        ...current,
        ui: {
          ...current.ui,
          mode: "normal",
          commandBuffer: "",
          pendingOperator: null,
          pendingMotion: null,
          statusMessage: "Normal mode.",
        },
      }));
      return;
    }

    if (key.name === "backspace") {
      setState((current) => ({
        ...current,
        ui: {
          ...current.ui,
          commandBuffer: current.ui.commandBuffer.slice(0, -1),
        },
      }));
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      void executeCommand(state.ui.commandBuffer);
      return;
    }

    if (isPrintableKey(key.sequence) && !key.ctrl && !key.meta) {
      setState((current) => ({
        ...current,
        ui: {
          ...current.ui,
          commandBuffer: `${current.ui.commandBuffer}${key.sequence}`,
        },
      }));
    }
  }

  function handleVisualMode(key: KeyEvent) {
    setState((current) => {
      if (key.name === "escape") {
        return {
          ...current,
          ui: {
            ...current.ui,
            mode: "normal",
            selectionAnchorCellId: null,
            selectionAnchorCursor: null,
            pendingOperator: null,
            pendingMotion: null,
            statusMessage: "Normal mode.",
          },
        };
      }

      if (current.ui.mode === "cell_visual") {
        switch (key.name) {
          case "{":
          case "up":
          case "k":
            return moveFocusToRelativeCell(current, -1);
          case "}":
          case "down":
          case "j":
            return moveFocusToRelativeCell(current, 1);
          case "y":
            return copySelectedCells(current);
          case "d":
            return deleteSelectedCells(current);
          default:
            return current;
        }
      }

      switch (key.name) {
        case "left":
        case "h":
          return moveCursor(current, 0, -1);
        case "right":
        case "l":
          return moveCursor(current, 0, 1);
        case "up":
        case "k":
          return moveCursor(current, -1, 0);
        case "down":
        case "j":
          return moveCursor(current, 1, 0);
        case "w":
          return moveCursorByWord(current, "forward");
        case "b":
          return moveCursorByWord(current, "backward");
        case "e":
          return moveCursorByWord(current, "end");
        case "y":
          if (current.ui.mode === "visual_line") {
            return copyVisualLineSelection(current);
          }
          return copyVisualSelection(current);
        case "d":
          if (current.ui.mode === "visual_line") {
            return {
              ...deleteVisualLineSelection(current),
              ui: {
                ...current.ui,
                mode: "normal",
                selectionAnchorCellId: null,
                selectionAnchorCursor: null,
                pendingOperator: null,
                pendingMotion: null,
                statusMessage: "Deleted selected lines.",
              },
            };
          }
          return {
            ...deleteVisualSelection(current),
            ui: {
              ...current.ui,
              mode: "normal",
              selectionAnchorCellId: null,
              selectionAnchorCursor: null,
              pendingOperator: null,
              pendingMotion: null,
              statusMessage: "Deleted selection.",
            },
          };
        default:
          return current;
      }
    });
  }

  useKeyboard((key) => {
    if (state.ui.mode === "insert") {
      handleInsertMode(key);
      return;
    }
    if (
      state.ui.mode === "visual" ||
      state.ui.mode === "visual_line" ||
      state.ui.mode === "cell_visual"
    ) {
      handleVisualMode(key);
      return;
    }
    if (state.ui.mode === "command") {
      handleCommandMode(key);
      return;
    }
    handleNormalMode(key);
  });

  const statusSummary = truncateText(
    [
      `mode=${state.ui.mode.toUpperCase()}`,
      `kernel=${state.kernel.status}`,
      `provider=${state.kernel.provider}`,
    ].join("  |  "),
    Math.max(10, width - 4),
  );
  const statusMessage = truncateText(state.ui.statusMessage, Math.max(10, width - 4));

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.background}>
      <scrollbox ref={scrollRef} height={bodyHeight} style={{ rootOptions: { backgroundColor: theme.background } }}>
        <box
          flexDirection="column"
          alignItems="center"
          width="100%"
          paddingY={1}
          backgroundColor={theme.background}
        >
          <box
            width={notebookWidth}
            flexDirection="column"
            gap={1}
            backgroundColor={theme.background}
          >
            {state.notebook.present.cells.map((cell) => {
              const active = cell.id === state.ui.focusedCellId;
              const editorLines = renderEditorLines(cell, state);
              const cursor = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
              const cellIndex = getCellIndex(state, cell.id);
              const textSelection =
                active && state.ui.mode === "visual"
                  ? getVisualSelectionOffsets(state)
                  : active && state.ui.mode === "visual_line"
                    ? getVisualLineSelectionOffsets(state)
                    : null;
              let runningOffset = 0;

              // Markdown cells: minimal note style — black bg, gray border, compact
              if (cell.kind === "markdown" && !(active && state.ui.mode === "insert")) {
                return (
                  <box
                    key={cell.id}
                    id={cell.id}
                    flexDirection="column"
                    border
                    borderStyle="rounded"
                    borderColor={active ? theme.muted : "#333333"}
                    backgroundColor="#000000"
                    paddingX={1}
                  >
                    {active ? (
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme.muted}>md</text>
                        <text fg={theme.muted}>
                          {cell.id}  [{cellIndex + 1}/{state.notebook.present.cells.length}]
                        </text>
                      </box>
                    ) : null}
                    <markdown
                      content={cell.source || "*empty*"}
                      syntaxStyle={syntaxStyle}
                      fg={theme.text}
                      bg="#000000"
                    />
                  </box>
                );
              }

              return (
                <box
                  key={cell.id}
                  id={cell.id}
                  flexDirection="column"
                  border
                  borderStyle="rounded"
                  borderColor={active ? theme.borderActive : theme.border}
                  backgroundColor={
                    state.ui.mode === "cell_visual" &&
                    state.ui.selectionAnchorCellId &&
                    (() => {
                      const focusedIndex = getCellIndex(state, state.ui.focusedCellId);
                      const anchorIndex = getCellIndex(state, state.ui.selectionAnchorCellId);
                      const start = Math.min(focusedIndex, anchorIndex);
                      const end = Math.max(focusedIndex, anchorIndex);
                      return cellIndex >= start && cellIndex <= end;
                    })()
                      ? theme.selectionCell
                      : active
                        ? theme.panelAlt
                        : theme.panel
                  }
                  paddingX={1}
                  paddingY={1}
                >
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={active ? theme.accent : theme.muted}>
                      {cell.kind === "markdown" ? "md" : `In [${cell.executionCount ?? " "}]:`}
                    </text>
                    <box flexDirection="row" gap={1}>
                      {active && state.ui.mode === "insert" ? (
                        <text fg="#000000" bg={theme.borderActive}>
                          {" editing "}
                        </text>
                      ) : null}
                      <text fg={theme.muted}>
                        {cell.id}  [{cellIndex + 1}/{state.notebook.present.cells.length}]
                      </text>
                    </box>
                  </box>

                  <box flexDirection="row" marginTop={1}>
                      <box width={8} flexDirection="column">
                        {editorLines.map((line) => (
                          <text key={`${cell.id}-ln-${line.lineNumber}`} fg={theme.muted}>
                            {String(line.lineNumber).padStart(3, " ")}
                          </text>
                        ))}
                      </box>
                      <box flexDirection="column" flexGrow={1}>
                        {state.ui.mode === "normal" && !active ? (
                          <code
                            content={cell.source}
                            filetype="python"
                            syntaxStyle={syntaxStyle}
                            bg={active ? theme.panelAlt : theme.panel}
                            fg={theme.text}
                          />
                        ) : (
                          editorLines.map((line) => (
                            <box
                              key={`${cell.id}-line-${line.lineNumber}`}
                              backgroundColor={
                                textSelection &&
                                runningOffset + line.text.length >= textSelection.start &&
                                runningOffset <= textSelection.end
                                  ? theme.selectionCell
                                  : active &&
                                      line.isCursorLine &&
                                      state.ui.mode !== "visual" &&
                                      state.ui.mode !== "visual_line" &&
                                      state.ui.mode !== "cell_visual"
                                    ? "#303225"
                                    : "transparent"
                              }
                            >
                              {renderActiveLine(
                                line.text,
                                active,
                                line.isCursorLine,
                                cursor.col,
                                state.ui.mode,
                                theme,
                                textSelection,
                                (() => {
                                  const start = runningOffset;
                                  runningOffset += line.text.length + 1;
                                  return start;
                                })(),
                              )}
                            </box>
                          ))
                        )}
                      </box>
                    </box>

                  {cell.kind === "code" && cell.outputs.length > 0 ? (
                    <box
                      flexDirection="column"
                      marginTop={1}
                      paddingLeft={1}
                      border={["left"]}
                      borderColor={theme.border}
                    >
                      <text fg={theme.muted}>
                        {`Out: ${cell.outputs.map((output) => output.kind).join(", ")}`}
                      </text>
                      {cell.outputs.map((output, index) =>
                        output.kind === "image" ? (
                          <box key={`${cell.id}-output-${index}`} flexDirection="column">
                            {renderImageOutput(output, theme)}
                          </box>
                        ) : (
                          <box
                            key={`${cell.id}-output-${index}`}
                            flexDirection="column"
                          >
                            {renderTextOutput(
                              output,
                              `${cell.id}-output-${index}`,
                              output.kind === "error"
                                ? theme.error
                                : output.kind === "result"
                                  ? theme.success
                                  : theme.text,
                            )}
                          </box>
                        ),
                      )}
                    </box>
                  ) : null}
                </box>
              );
            })}
          </box>
        </box>
      </scrollbox>

      <box
        height={4}
        paddingX={1}
        flexDirection="column"
        backgroundColor={theme.statusBarBg}
        border={["top"]}
        borderColor={theme.border}
      >
        <text fg={theme.statusBarText}>{statusSummary}</text>
        <text fg={theme.statusBarText}>
          {state.ui.mode === "command" ? `:${state.ui.commandBuffer}` : statusMessage}
        </text>
      </box>
    </box>
  );
}

export { App };

if (import.meta.main) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: false });
  createRoot(renderer).render(<App />);
}
