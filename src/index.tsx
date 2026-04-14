import {
  createCliRenderer,
  decodePasteBytes,
  SyntaxStyle,
  type KeyEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { basename, isAbsolute, join } from "node:path";
import { tokenizeSource } from "../remotion/src/shiki";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  appendCellOutput,
  applyExecutionResult,
  backspaceAtCursor,
  clearCellOutputs,
  copySelectedCells,
  copyStringToSystemClipboard,
  copyVisualLineSelection,
  copyVisualSelection,
  changeWordForward,
  createAppStateFromDocument,
  createInitialAppState,
  defaultCursorForCell,
  deleteCharAtCursor,
  deleteCurrentLine,
  deleteFocusedCellAndRestorePrevious,
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
  insertLineAbove,
  insertLineBelow,
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
import {
  getDisplayLines,
  getStructuredResultLines,
} from "./output-model";
import { PythonSession, resolvePython } from "./python-session";
import { themes } from "./theme";
import type { AppState, KernelStatus, NotebookCell, NotebookOutput } from "./types";

const OUTPUT_PREVIEW_MAX_LINES = 8;

const HELP_LINES = [
  "Navigation",
  "  { / }        previous / next cell",
  "  h j k l      move cursor inside cell",
  "  w / b / e    word forward / back / end",
  "  0 / $ / ^    line start / end / first non-blank",
  "  gg / G       top / bottom of cell",
  "",
  "Editing",
  "  i / a        insert before / after cursor",
  "  I / A        insert at line start / end",
  "  o / O        new line below / above",
  "  dd           delete line  ·  cc  change line  ·  yy  yank line",
  "  p / P        paste below / above",
  "  u / Ctrl+R   undo / redo",
  "  v / V        visual / visual-line selection",
  "",
  "Cells",
  "  Space o      new cell below  ·  Space O  new cell above",
  "  Space d      delete cell",
  "  Space vv     cell visual selection",
  "  Shift+M      toggle code / markdown",
  "",
  "Execution",
  "  R or Shift+Enter   run focused cell",
  "  :r           run all cells",
  "  :clear       clear outputs",
  "",
  "Outputs",
  "  Shift+E      expand output view",
  "",
  "Commands (press : then type)",
  "  :w   save  ·  :q  quit  ·  :wq  save & quit",
  "  :r   run all  ·  :clear  clear outputs",
  "",
  "ntui Rendering Commands",
  "  Add # ntui: key=value lines at the top of a code cell.",
  "  These directives are hidden during rendering / video export.",
  "",
  "  label=\"Title\"           set a label shown in the video overlay",
  "  id=myid                 give the cell a symbolic id for cross-references",
  "  highlight=4-6           highlight source lines 4–6",
  "  highlight_focus=5       emphasize line 5 within the highlight",
  "  callout=\"Note text\"     display a callout banner during preview",
  "  source=preview          show this cell's source in preview mode",
  "  output=preview          show this cell's output in preview mode",
  "  preview=@,@o,2,2o       preview specific targets (@ = this cell, 2 = cell 2, o suffix = output)",
  "  preview_layout=columns  layout: center | columns | rows | grid | main_rail",
  "  input=char              typing animation: char | word | line | block | fade | present",
  "",
  "  input modes:",
  "    char     character-by-character typing (default)",
  "    word     word-by-word typing",
  "    line     line-by-line typing",
  "    block    entire source appears at once",
  "    fade     instant reveal with fade-in effect",
  "    present  instant reveal, minimal delay",
  "",
  "  Example:",
  "  # ntui: label=\"Parsing\" highlight=4-6 highlight_focus=5",
  "  # ntui: id=parse preview=@,@o preview_layout=columns",
  "  # ntui: callout=\"This is the core step\"",
  "  # ntui: input=fade",
  "",
  "Esc or Shift+H: close this help",
];

function getStatusHint(mode: AppState["ui"]["mode"]): string {
  switch (mode) {
    case "insert":
      return "Esc: normal  ·  type to edit  ·  arrows: move";
    case "visual":
    case "visual_line":
      return "Esc: cancel  ·  y: yank  ·  d: delete  ·  c: change  ·  > <: indent";
    case "cell_visual":
      return "Esc: cancel  ·  { }: extend  ·  d: delete  ·  y: yank";
    case "command":
      return "Enter: execute  ·  Esc: cancel  ·  :w :q :wq :r :clear";
    default:
      return "i: edit  ·  { }: cells  ·  R: run  ·  Sp o/O: new cell ↓/↑  ·  Sp d: delete  ·  :w save  ·  Sp ?: help";
  }
}

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

function formatKernelProviderForStatus(
  provider: AppState["kernel"]["provider"],
  kernelStatus: KernelStatus,
): string {
  if (provider !== "bridge") {
    return provider;
  }
  if (kernelStatus === "starting") {
    return "bridge";
  }
  return "bridge (ipykernel not installed, some features may be missing)";
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

function renderEditorLines(source: string, cell: NotebookCell, state: AppState) {
  const cursor = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
  const lines = getLines(source);

  return lines.map((line, index) => {
    const isCursorLine = index === cursor.row;
    return { lineNumber: index + 1, text: line, isCursorLine };
  });
}

type MdToken = { text: string; color: string; bold?: boolean; italic?: boolean };

function parseInlineMarkdown(text: string, theme: { text: string; accent: string; muted: string; success: string }): MdToken[] {
  if (text.length === 0) return [];
  const tokens: MdToken[] = [];
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, match.index), color: theme.text });
    }
    if (match[2] !== undefined) {
      tokens.push({ text: "***", color: theme.muted });
      tokens.push({ text: match[2], color: theme.text, bold: true, italic: true });
      tokens.push({ text: "***", color: theme.muted });
    } else if (match[3] !== undefined) {
      tokens.push({ text: "**", color: theme.muted });
      tokens.push({ text: match[3], color: theme.text, bold: true });
      tokens.push({ text: "**", color: theme.muted });
    } else if (match[4] !== undefined) {
      tokens.push({ text: "*", color: theme.muted });
      tokens.push({ text: match[4], color: theme.text, italic: true });
      tokens.push({ text: "*", color: theme.muted });
    } else if (match[5] !== undefined) {
      tokens.push({ text: "`", color: theme.muted });
      tokens.push({ text: match[5], color: theme.success });
      tokens.push({ text: "`", color: theme.muted });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), color: theme.text });
  }
  return tokens;
}

function tokenizeMarkdownLine(line: string, theme: { text: string; accent: string; muted: string; success: string }): MdToken[] {
  const headerMatch = line.match(/^(#{1,6}\s)/);
  if (headerMatch) {
    const tokens: MdToken[] = [{ text: headerMatch[0], color: theme.muted, bold: true }];
    const rest = line.slice(headerMatch[0].length);
    if (rest.length > 0) {
      tokens.push({ text: rest, color: theme.accent, bold: true });
    }
    return tokens;
  }
  const quoteMatch = line.match(/^(>\s*)/);
  if (quoteMatch) {
    return [
      { text: quoteMatch[0], color: theme.accent, italic: true },
      ...parseInlineMarkdown(line.slice(quoteMatch[0].length), theme),
    ];
  }
  const listMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s)/);
  if (listMatch) {
    return [
      { text: listMatch[0], color: theme.accent },
      ...parseInlineMarkdown(line.slice(listMatch[0].length), theme),
    ];
  }
  if (/^[-*_]{3,}\s*$/.test(line)) {
    return [{ text: line, color: theme.muted }];
  }
  return parseInlineMarkdown(line, theme);
}

function tokenizeMarkdownSource(
  source: string,
  theme: { text: string; accent: string; muted: string; success: string },
): MdToken[][] {
  return getLines(source).map((line) => tokenizeMarkdownLine(line, theme));
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

function wrapLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) return [line];
  const wrapped: string[] = [];
  let remaining = line;
  while (remaining.length > 0) {
    if (remaining.length <= maxWidth) {
      wrapped.push(remaining);
      break;
    }
    // Try to break at a word boundary
    let breakAt = remaining.lastIndexOf(" ", maxWidth);
    if (breakAt <= 0) {
      // No word boundary found, break at maxWidth
      breakAt = maxWidth;
    }
    wrapped.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^ /, "");
  }
  return wrapped;
}

function renderTextOutput(
  output: Extract<NotebookOutput, { kind: "stream" | "result" | "error" }>,
  keyPrefix: string,
  color: string,
  mutedColor: string,
  keyColor: string,
  truncate = false,
  wrapWidth = 0,
) {
  const structuredLines =
    output.kind === "result" ? getStructuredResultLines(output.text, truncate) : null;
  const allLines = structuredLines
    ? structuredLines
    : (
      wrapWidth > 0
        ? getDisplayLines(output.text).flatMap((line) => wrapLine(line, wrapWidth))
        : getDisplayLines(output.text)
    );
  const lines = truncate ? allLines.slice(0, OUTPUT_PREVIEW_MAX_LINES) : allLines;
  const hiddenCount = Math.max(0, allLines.length - lines.length);

  return (
    <>
      {lines.map((line, lineIndex) => (
        <text key={`${keyPrefix}-line-${lineIndex}`} fg={color}>
          {typeof line === "string"
            ? (line.length > 0 ? line : " ")
            : line.map((segment, segmentIndex) => (
              <span
                key={`${keyPrefix}-line-${lineIndex}-segment-${segmentIndex}`}
                fg={
                  segment.kind === "key"
                    ? keyColor
                    : segment.kind === "punctuation"
                      ? mutedColor
                      : color
                }
              >
                {segment.text.length > 0 ? segment.text : " "}
              </span>
            ))}
        </text>
      ))}
      {hiddenCount > 0 ? (
        <text key={`${keyPrefix}-truncated`} fg={mutedColor}>
          {`... ${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}. Press Enter to expand.`}
        </text>
      ) : null}
    </>
  );
}

function estimateOutputRows(output: NotebookOutput, truncate = true, wrapWidth = 0): number {
  if (output.kind === "image") {
    return output.preview?.length ? output.preview.length + 3 : 4;
  }
  const structuredLines =
    output.kind === "result" ? getStructuredResultLines(output.text, truncate) : null;
  const lines = structuredLines
    ? structuredLines
    : (
      wrapWidth > 0
        ? getDisplayLines(output.text).flatMap((line) => wrapLine(line, wrapWidth))
        : getDisplayLines(output.text)
    );
  const visibleLines = truncate ? Math.min(lines.length, OUTPUT_PREVIEW_MAX_LINES) : lines.length;
  return visibleLines + (lines.length > visibleLines ? 1 : 0);
}

function estimateEditorBlockRows(cell: NotebookCell): number {
  const sourceLines = Math.max(1, getLines(cell.source).length);
  return 1 + 1 + sourceLines + 4;
}

function estimateOutputBlockRows(cell: NotebookCell, wrapWidth = 0): number {
  if (cell.outputs.length === 0) {
    return 0;
  }
  let rows = 3;
  for (const output of cell.outputs) {
    rows += estimateOutputRows(output, true, wrapWidth);
  }
  return rows;
}

type NotebookBlock = {
  cellId: string;
  focusTarget: "editor" | "output";
  top: number;
  height: number;
};

function getNotebookBlocks(state: AppState, wrapWidth = 0): NotebookBlock[] {
  const topPaddingRows = 1;
  const gapRows = 1;
  const blocks: NotebookBlock[] = [];
  let top = topPaddingRows;

  for (const cell of state.notebook.present.cells) {
    const editorHeight = estimateEditorBlockRows(cell);
    blocks.push({
      cellId: cell.id,
      focusTarget: "editor",
      top,
      height: editorHeight,
    });
    top += editorHeight;

    top += gapRows;
  }

  return blocks;
}

function getFocusedBlock(state: AppState, wrapWidth = 0): NotebookBlock | null {
  const blocks = getNotebookBlocks(state, wrapWidth);
  return (
    blocks.find(
      (block) =>
        block.cellId === state.ui.focusedCellId &&
        block.focusTarget === state.ui.focusTarget,
    ) ?? blocks[0] ?? null
  );
}

// Walk the renderable tree calling updateFromLayout so the JS-side
// _x/_y/_widthValue/_heightValue caches reflect the latest yoga-computed
// positions. We need this because react's useLayoutEffect runs AFTER
// reconciliation but BEFORE opentui's next render frame, which is normally
// where these values get refreshed.
function syncLayoutPositions(node: unknown): void {
  if (!node || typeof node !== "object") {
    return;
  }
  const renderable = node as {
    updateFromLayout?: () => void;
    getChildren?: () => unknown[];
  };
  if (typeof renderable.updateFromLayout === "function") {
    try {
      renderable.updateFromLayout();
    } catch {
      // Renderable may be in an inconsistent state (e.g. mid-destroy); ignore.
    }
  }
  const children =
    typeof renderable.getChildren === "function" ? renderable.getChildren() : [];
  for (const child of children) {
    syncLayoutPositions(child);
  }
}

const SCROLL_MARGIN_ROWS = 2;

function prepareScrollLayout(
  scrollBox: ScrollBoxRenderable,
  rendererRoot: { calculateLayout: () => void } & object,
): void {
  try {
    rendererRoot.calculateLayout();
  } catch {
    // If layout fails for any reason, fall back to whatever stale data exists.
  }
  syncLayoutPositions(rendererRoot);
}

function findScrollableTarget(
  scrollBox: ScrollBoxRenderable,
  targetId: string,
): { y: number; height: number } | null {
  const target = scrollBox.content.findDescendantById(targetId) as
    | { y: number; height: number }
    | undefined;
  return target ?? null;
}

function revealFocusedCell(
  scrollBox: ScrollBoxRenderable,
  rendererRoot: { calculateLayout: () => void } & object,
  state: AppState,
): void {
  const focusedCell = getFocusedCell(state);
  if (!focusedCell) {
    return;
  }
  prepareScrollLayout(scrollBox, rendererRoot);
  const target = findScrollableTarget(scrollBox, focusedCell.id);
  if (!target) {
    return;
  }

  const viewport = scrollBox.viewport;
  const desiredTop = viewport.y + Math.max(1, Math.floor(viewport.height / 2) - 1);
  const dy = target.y - desiredTop;

  if (dy !== 0) {
    scrollBox.scrollTo({ x: scrollBox.scrollLeft, y: Math.max(0, scrollBox.scrollTop + dy) });
  }
}

function keepCursorVisible(
  scrollBox: ScrollBoxRenderable,
  rendererRoot: { calculateLayout: () => void } & object,
): void {
  prepareScrollLayout(scrollBox, rendererRoot);
  const target = findScrollableTarget(scrollBox, "cursor-line");
  if (!target) {
    return;
  }

  const viewport = scrollBox.viewport;
  const viewportTop = viewport.y;
  const viewportBottom = viewport.y + viewport.height;
  const targetTop = target.y;
  const targetBottom = target.y + target.height;

  let dy = 0;
  if (targetBottom > viewportBottom - SCROLL_MARGIN_ROWS) {
    dy = targetBottom - (viewportBottom - SCROLL_MARGIN_ROWS);
  } else if (targetTop < viewportTop + SCROLL_MARGIN_ROWS) {
    dy = targetTop - (viewportTop + SCROLL_MARGIN_ROWS);
  }

  if (dy !== 0) {
    const nextScrollTop = Math.max(0, scrollBox.scrollTop + dy);
    if (nextScrollTop !== scrollBox.scrollTop) {
      scrollBox.scrollTo({ x: scrollBox.scrollLeft, y: nextScrollTop });
    }
  }
}

function moveFocusByBlock(state: AppState, delta: number, wrapWidth = 0): AppState {
  const blocks = getNotebookBlocks(state, wrapWidth);
  if (blocks.length === 0) {
    return state;
  }

  const currentIndex = blocks.findIndex(
    (block) =>
      block.cellId === state.ui.focusedCellId &&
      block.focusTarget === state.ui.focusTarget,
  );
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = Math.max(0, Math.min(blocks.length - 1, safeIndex + delta));
  const nextBlock = blocks[nextIndex]!;

  return {
    ...state,
    ui: {
      ...state.ui,
      focusedCellId: nextBlock.cellId,
      lastVisitedCellId:
        nextBlock.cellId !== state.ui.focusedCellId
          ? state.ui.focusedCellId
          : state.ui.lastVisitedCellId,
      focusTarget: nextBlock.focusTarget,
      pendingOperator: null,
      pendingMotion: null,
      statusMessage: "Block focused.",
    },
  };
}

function expandFocusedCellOutput(state: AppState): AppState {
  const focusedCell = getFocusedCell(state);
  if (!focusedCell || focusedCell.outputs.length === 0) {
    return withStatus(state, "Focused cell has no output.");
  }

  return {
    ...state,
    ui: {
      ...state.ui,
      outputDialogCellId: focusedCell.id,
      pendingOperator: null,
      pendingMotion: null,
      statusMessage: "Expanded output view.",
    },
  };
}

type StyledChar = { text: string; fg: string; bold?: boolean; italic?: boolean };

function renderStyledChar(char: StyledChar, key: string, bgOverride?: string) {
  if (char.bold && char.italic) {
    return <b key={key}><i fg={char.fg} bg={bgOverride}>{char.text}</i></b>;
  }
  if (char.bold) {
    return <b key={key} fg={char.fg} bg={bgOverride}>{char.text}</b>;
  }
  if (char.italic) {
    return <i key={key} fg={char.fg} bg={bgOverride}>{char.text}</i>;
  }
  return <span key={key} fg={char.fg} bg={bgOverride}>{char.text}</span>;
}

function renderActiveLine(
  line: string,
  lineTokens: Array<{ text: string; color: string; bold?: boolean; italic?: boolean }> | undefined,
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
  const chars: StyledChar[] = [];

  if (lineTokens && line.length > 0) {
    for (const token of lineTokens) {
      for (const ch of token.text) {
        chars.push({ text: ch, fg: token.color, bold: token.bold, italic: token.italic });
      }
    }
  }
  while (chars.length < line.length) {
    chars.push({ text: line[chars.length] ?? " ", fg: theme.text });
  }
  if (chars.length === 0) {
    chars.push({ text: " ", fg: theme.text });
  }

  if (!selection) {
    if (!isActive || !isCursorLine) {
      return (
        <text fg={theme.text} truncate>
          {chars.map((char, index) => renderStyledChar(char, `plain-${index}`))}
        </text>
      );
    }

    const cursorIndex = Math.min(cursorCol, line.length);

    if (mode === "insert") {
      return (
        <text fg={theme.text} truncate>
          {chars.slice(0, cursorIndex).map((char, index) => renderStyledChar(char, `before-${index}`))}
          <span fg={theme.borderActive}>|</span>
          {chars.slice(cursorIndex).map((char, index) => renderStyledChar(char, `after-${index}`))}
        </text>
      );
    }

    const cursorBg = theme.borderActive;

    return (
      <text fg={theme.text} truncate>
        {chars.map((char, index) =>
          index === cursorIndex ? (
            renderStyledChar({ ...char, fg: "#000000" }, `cursor-${index}`, cursorBg)
          ) : (
            renderStyledChar(char, `char-${index}`)
          ),
        )}
        {cursorIndex >= line.length && line.length > 0 ? (
          <span key="cursor-eol" fg="#000000" bg={cursorBg}>
            {" "}
          </span>
        ) : null}
      </text>
    );
  }

  const spans: Array<{ text: string; fg: string; bg?: string; bold?: boolean; italic?: boolean }> = [];
  const cursorIndex = Math.min(cursorCol, line.length);

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    const absoluteOffset = lineStartOffset + index;
    const selected =
      absoluteOffset >= selection.start && absoluteOffset < selection.end;
    const cursor = isActive && isCursorLine && index === cursorIndex;

    spans.push({
      text: char.text,
      bold: char.bold,
      italic: char.italic,
      fg: cursor
        ? "#000000"
        : selected
          ? theme.selectionText
          : char.fg,
      bg: cursor
        ? (selected ? theme.selection : theme.borderActive)
        : selected
          ? theme.selection
          : undefined,
    });
  }

  if (isActive && isCursorLine && cursorCol >= line.length && line.length > 0) {
    spans.push({ text: " ", fg: "#000000", bg: theme.borderActive });
  }

  return (
    <text fg={theme.text} truncate>
      {spans.map((s, index) => renderStyledChar(
        { text: s.text, fg: s.fg, bold: s.bold, italic: s.italic },
        `span-${index}`,
        s.bg,
      ))}
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
  const helpScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const outputDialogScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const previousFocusedCellIdRef = useRef<string | null>(null);
  const theme = themes[state.ui.themeName];
  const notebookWidth = Math.min(120, Math.max(72, width - 6));
  const statusBarHeight = 5;
  const bodyHeight = Math.max(10, height - statusBarHeight);
  const [runningTick, setRunningTick] = useState(0);

  useEffect(() => {
    if (!state.ui.runningCellId) {
      setRunningTick(0);
      return;
    }
    const interval = setInterval(() => {
      setRunningTick((tick) => tick + 1);
    }, 120);
    return () => clearInterval(interval);
  }, [state.ui.runningCellId]);

  // Track the cursor row of the focused cell so the scroll effect re-runs on
  // pure cursor moves (h/j/k/l, w/b, etc.) which don't otherwise touch
  // notebook.present.
  const focusedCursorRow =
    state.ui.cursorByCellId[state.ui.focusedCellId]?.row ?? 0;
  const focusedCursorCol =
    state.ui.cursorByCellId[state.ui.focusedCellId]?.col ?? 0;

  // Activate a cell via pointer input. Leaves mode untouched so that clicking
  // while in normal/insert/command doesn't surprise the user by switching
  // modes — we only move the focus.
  const activateCell = (cellId: string, focusTarget: "editor" | "output") => {
    setState((current) => {
      if (
        current.ui.focusedCellId === cellId &&
        current.ui.focusTarget === focusTarget
      ) {
        return current;
      }
      return {
        ...current,
        ui: {
          ...current.ui,
          focusedCellId: cellId,
          lastVisitedCellId:
            current.ui.focusedCellId !== cellId
              ? current.ui.focusedCellId
              : current.ui.lastVisitedCellId,
          focusTarget,
          pendingOperator: null,
          pendingMotion: null,
          statusMessage: "Cell focused.",
        },
      };
    });
  };

  useEffect(() => () => syntaxStyle.destroy(), [syntaxStyle]);

  useLayoutEffect(() => {
    const sb = scrollRef.current;
    if (!sb) {
      return;
    }
    const previousFocusedCellId = previousFocusedCellIdRef.current;
    const focusedCellChanged =
      previousFocusedCellId !== null &&
      previousFocusedCellId !== state.ui.focusedCellId;

    if (focusedCellChanged) {
      revealFocusedCell(sb, renderer.root, state);
    } else {
      keepCursorVisible(sb, renderer.root);
    }
    previousFocusedCellIdRef.current = state.ui.focusedCellId;
  }, [
    renderer,
    bodyHeight,
    notebookWidth,
    state.notebook.present,
    state.ui.focusedCellId,
    state.ui.focusTarget,
    state.ui.mode,
    focusedCursorRow,
    focusedCursorCol,
  ]);

  useEffect(() => {
    const keyInput = renderer.keyInput;
    const onPaste = (event: { bytes: Uint8Array; preventDefault(): void }) => {
      const text = decodePasteBytes(event.bytes);
      if (!text) {
        return;
      }
      event.preventDefault();
      setState((current) => {
        if (current.ui.helpOpen || current.ui.outputDialogCellId) {
          return current;
        }
        if (current.ui.mode === "command") {
          return {
            ...current,
            ui: {
              ...current.ui,
              commandBuffer: `${current.ui.commandBuffer}${text}`,
              statusMessage: "Pasted into command buffer.",
            },
          };
        }
        const inserted = insertTextAtCursor(current, text);
        return {
          ...inserted,
          ui: {
            ...inserted.ui,
            mode: "insert",
            focusTarget: "editor",
            statusMessage: "Pasted.",
          },
        };
      });
    };

    keyInput.on("paste", onPaste);
    return () => {
      keyInput.off("paste", onPaste);
    };
  }, [renderer]);

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
            runningCellId: cellId,
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
              setState((current) => {
                const next = appendCellOutput(current, cellId, event.output);
                return {
                  ...next,
                  ui: {
                    ...next.ui,
                    focusedCellId: cellId,
                    runningCellId: cellId,
                    statusMessage: "Streaming output...",
                  },
                };
              });
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
              runningCellId: null,
              statusMessage: `Render: executed cell ${i + 1}/${cells.length}.`,
            },
          }));
        } catch (error) {
          setState((current) => ({
            ...current,
            kernel: { ...current.kernel, status: "error", currentCellId: null },
            ui: { ...current.ui, runningCellId: null, statusMessage: `Render: error in cell ${i + 1}.` },
          }));
          break;
        }

        await new Promise((r) => setTimeout(r, pause));
      }

      // Final pause then quit
      setState((current) => ({
        ...current,
        ui: { ...current.ui, runningCellId: null, statusMessage: "Render complete." },
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
      ui: {
        ...current.ui,
        runningCellId: focusedCell.id,
        statusMessage: `Running ${focusedCell.id}...`,
        pendingOperator: null,
      },
    }));

    try {
      const cellId = focusedCell.id;
      const result = await executeNotebookCell(session, focusedCell.source, (event) => {
        if (event.type === "output") {
          setState((current) => {
            const next = appendCellOutput(current, cellId, event.output);
            return {
              ...next,
              ui: {
                ...next.ui,
                focusedCellId: cellId,
                runningCellId: cellId,
                statusMessage: "Streaming output...",
              },
            };
          });
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
          runningCellId: null,
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
          runningCellId: null,
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
          runningCellId: cellId,
          statusMessage: `Running ${cellId}...`,
          pendingOperator: null,
          pendingMotion: null,
          commandBuffer: "",
        },
      }));
      try {
        const result = await executeNotebookCell(session, currentCell.source, (event) => {
          if (event.type === "output") {
            setState((current) => {
              const next = appendCellOutput(current, cellId, event.output);
              return {
                ...next,
                ui: {
                  ...next.ui,
                  focusedCellId: cellId,
                  runningCellId: cellId,
                  statusMessage: "Streaming output...",
                },
              };
            });
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
            runningCellId: cellId,
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
            runningCellId: null,
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
        runningCellId: null,
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
        executionCounter: 0,
        cells: current.notebook.present.cells.map((cell) => ({
          ...cell,
          outputs: [],
          executionCount: null,
        })),
      };
      next.ui = {
        ...current.ui,
        mode: "normal",
        runningCellId: null,
        commandBuffer: "",
        statusMessage: "Cleared outputs and execution counts.",
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

  function scrollRenderable(ref: { current: ScrollBoxRenderable | null }, delta: number) {
    const renderable = ref.current;
    if (!renderable) {
      return;
    }
    renderable.scrollTo({ x: renderable.scrollLeft, y: Math.max(0, renderable.scrollTop + delta) });
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

      if (key.shift && key.name === "h") {
        return {
          ...current,
          ui: {
            ...current.ui,
            helpOpen: true,
            outputDialogCellId: null,
            statusMessage: "Shortcut help.",
          },
        };
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
              ui: {
                ...moved.ui,
                mode: "insert",
                focusTarget: "editor",
                statusMessage: "Insert mode.",
              },
            };
          }
          return {
            ...current,
            ui: {
              ...current.ui,
              mode: "insert",
              focusTarget: "editor",
              pendingOperator: null,
              pendingMotion: null,
              statusMessage: "Insert mode.",
            },
          };
        case "a": {
          if (current.ui.pendingMotion === "leader" && key.shift) {
            const inserted = insertCellRelative(current, 0);
            return {
              ...inserted,
              ui: {
                ...inserted.ui,
                pendingMotion: null,
                statusMessage: "Inserted a new cell above.",
              },
            };
          }
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
          if (current.ui.pendingMotion === "leader") {
            return moveFocusToRelativeCell(current, -1);
          }
          return moveCursor(current, -1, 0);
        case "down":
        case "j":
          if (current.ui.pendingMotion === "leader") {
            return moveFocusToRelativeCell(current, 1);
          }
          if (key.shift) {
            return joinLineBelow(current);
          }
          return moveCursor(current, 1, 0);
        case "e":
          if (key.shift) {
            return expandFocusedCellOutput(current);
          }
          return moveCursorByWord(current, "end");
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
            if (current.ui.pendingMotion === "leader") {
              const inserted = insertCellRelative(current, 0);
              return {
                ...inserted,
                ui: {
                  ...inserted.ui,
                  pendingMotion: null,
                  statusMessage: "Inserted a new cell above.",
                },
              };
            }
            const inserted = insertLineAbove(current);
            return {
              ...inserted,
              ui: {
                ...inserted.ui,
                mode: "insert",
                statusMessage: "Insert mode.",
              },
            };
          }
          if (current.ui.pendingMotion === "leader") {
            const inserted = insertCellRelative(current, 1);
            return {
              ...inserted,
              ui: {
                ...inserted.ui,
                pendingMotion: null,
                statusMessage: "Inserted a new cell below.",
              },
            };
          }
          const inserted = insertLineBelow(current);
          return {
            ...inserted,
            ui: {
              ...inserted.ui,
              mode: "insert",
              statusMessage: "Insert mode.",
            },
          };
        case "m":
          if (key.shift) {
            return toggleCellKind(current);
          }
          return current;
        case "b":
          if (key.shift) {
            if (current.ui.pendingMotion === "leader") {
              const inserted = insertCellRelative(current, 1);
              return {
                ...inserted,
                ui: {
                  ...inserted.ui,
                  pendingMotion: null,
                  statusMessage: "Inserted a new cell below.",
                },
              };
            }
            return moveCursorByWord(current, "backward");
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
        case "d":
          if (current.ui.pendingMotion === "leader") {
            return deleteFocusedCellAndRestorePrevious(current);
          }
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
        case "/":
          if (current.ui.pendingMotion === "leader" && key.shift) {
            return {
              ...current,
              ui: {
                ...current.ui,
                helpOpen: true,
                outputDialogCellId: null,
                pendingMotion: null,
                pendingOperator: null,
                statusMessage: "Shortcut help.",
              },
            };
          }
          if (
            current.ui.pendingMotion === "goto" ||
            current.ui.pendingMotion === "leader" ||
            current.ui.pendingMotion === "leader_v"
          ) {
            return withStatus(current, "Cancelled pending motion.");
          }
          return current;
        case "?":
          if (current.ui.pendingMotion === "leader") {
            return {
              ...current,
              ui: {
                ...current.ui,
                helpOpen: true,
                outputDialogCellId: null,
                pendingMotion: null,
                pendingOperator: null,
                statusMessage: "Shortcut help.",
              },
            };
          }
          return current;
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

  function handleHelpMode(key: KeyEvent) {
    if (key.name === "escape" || (key.shift && key.name === "h")) {
      setState((current) => ({
        ...current,
        ui: {
          ...current.ui,
          helpOpen: false,
          statusMessage: "Normal mode.",
        },
      }));
      return;
    }

    if (key.name === "up" || key.name === "k") {
      scrollRenderable(helpScrollRef, -1);
      return;
    }
    if (key.name === "down" || key.name === "j") {
      scrollRenderable(helpScrollRef, 1);
      return;
    }
    if (key.name === "pageup") {
      scrollRenderable(helpScrollRef, -Math.max(4, Math.floor(bodyHeight / 2)));
      return;
    }
    if (key.name === "pagedown") {
      scrollRenderable(helpScrollRef, Math.max(4, Math.floor(bodyHeight / 2)));
    }
  }

  function handleOutputDialogMode(key: KeyEvent) {
    if (key.name === "escape" || key.name === "q" || key.name === "return" || key.name === "enter") {
      setState((current) => ({
        ...current,
        ui: {
          ...current.ui,
          outputDialogCellId: null,
          statusMessage: "Collapsed output view.",
        },
      }));
      return;
    }

    if (key.name === "up" || key.name === "k") {
      scrollRenderable(outputDialogScrollRef, -1);
      return;
    }
    if (key.name === "down" || key.name === "j") {
      scrollRenderable(outputDialogScrollRef, 1);
      return;
    }
    if (key.name === "pageup") {
      scrollRenderable(outputDialogScrollRef, -Math.max(4, Math.floor(bodyHeight / 2)));
      return;
    }
    if (key.name === "pagedown") {
      scrollRenderable(outputDialogScrollRef, Math.max(4, Math.floor(bodyHeight / 2)));
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
    const wantsTerminalCopy =
      key.name === "c" &&
      (((key.meta || key.super) && !key.ctrl) || (key.ctrl && key.shift));
    if (wantsTerminalCopy && renderer.hasSelection) {
      const selection = renderer.getSelection();
      const text = selection?.getSelectedText() ?? "";
      if (text.length > 0) {
        key.preventDefault();
        if (renderer.isOsc52Supported()) {
          renderer.copyToClipboardOSC52(text);
        } else {
          copyStringToSystemClipboard(text);
        }
        setState((current) => withStatus(current, "Copied selection."));
        return;
      }
    }

    if (state.ui.helpOpen) {
      handleHelpMode(key);
      return;
    }
    if (state.ui.outputDialogCellId) {
      handleOutputDialogMode(key);
      return;
    }
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
      `provider=${formatKernelProviderForStatus(state.kernel.provider, state.kernel.status)}`,
    ].join("  |  "),
    Math.max(10, width - 4),
  );
  const statusShortcutsHint = truncateText(
    getStatusHint(state.ui.mode),
    Math.max(10, width - 4),
  );
  const statusMessage = truncateText(state.ui.statusMessage, Math.max(10, width - 4));

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.background}>
      <scrollbox
        ref={scrollRef}
        height={bodyHeight}
        style={{ rootOptions: { backgroundColor: theme.background } }}
      >
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
              const isRunningCell = state.ui.runningCellId === cell.id;
              const spinnerFrames = ["-", "\\", "|", "/"];
              const spinner = spinnerFrames[runningTick % spinnerFrames.length] ?? "-";
              const editorLines = renderEditorLines(cell.source, cell, state);
              const tokenizedSource =
                cell.kind === "markdown"
                  ? tokenizeMarkdownSource(cell.source, theme)
                  : tokenizeSource(cell.source);
              const cursor = state.ui.cursorByCellId[cell.id] ?? defaultCursorForCell(cell);
              const cellIndex = getCellIndex(state, cell.id);
              const textSelection =
                active && state.ui.mode === "visual"
                  ? getVisualSelectionOffsets(state)
                  : active && state.ui.mode === "visual_line"
                    ? getVisualLineSelectionOffsets(state)
                    : null;
              let runningOffset = 0;

              if (cell.kind === "markdown" && !active) {
                return (
                  <box
                    key={cell.id}
                    id={cell.id}
                    flexDirection="column"
                    border
                    borderStyle="rounded"
                    borderColor="#333333"
                    backgroundColor="#000000"
                    paddingX={1}
                    onMouseDown={(event: { button: number }) => {
                      if (event.button !== 0) return;
                      activateCell(cell.id, "editor");
                    }}
                  >
                    <box flexGrow={1}>
                      <markdown
                        content={cell.source || "*empty*"}
                        syntaxStyle={syntaxStyle}
                        fg={theme.text}
                        bg="#000000"
                      />
                    </box>
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
                  borderColor={
                    isRunningCell
                      ? theme.warning
                      : active
                        ? (cell.kind === "markdown" ? theme.accent : theme.borderActive)
                        : theme.border
                  }
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
                      : isRunningCell
                        ? "#312413"
                      : cell.kind === "markdown"
                        ? (active ? "#1a1e2a" : "#161a24")
                      : active
                        ? theme.panelAlt
                        : theme.panel
                  }
                  paddingX={1}
                  paddingY={1}
                  onMouseDown={(event: { button: number }) => {
                    if (event.button !== 0) return;
                    activateCell(cell.id, "editor");
                  }}
                >
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={isRunningCell ? theme.warning : active ? theme.accent : theme.muted}>
                      {cell.kind === "markdown"
                        ? "md"
                        : `In [${isRunningCell ? spinner : (cell.executionCount ?? " ")}]:`}
                    </text>
                    <box flexDirection="row" gap={1}>
                      {isRunningCell ? (
                        <text fg="#000000" bg={theme.warning}>
                          {" running "}
                        </text>
                      ) : null}
                      {active && state.ui.mode === "insert" ? (
                        <text fg={theme.muted}>editing · Esc → normal</text>
                      ) : active && state.ui.mode === "normal" ? (
                        <text fg={theme.muted}>
                          {cell.kind === "code"
                            ? "i: edit · R: run · V: visual · Space d: del · u: undo"
                            : "i: edit · V: visual · Space d: del · u: undo"}
                        </text>
                      ) : active && (state.ui.mode === "visual" || state.ui.mode === "visual_line") ? (
                        <text fg={theme.muted}>Esc: cancel · y: yank · d: del</text>
                      ) : null}
                      <text fg={theme.muted}>
                        [{cellIndex + 1}/{state.notebook.present.cells.length}]
                      </text>
                    </box>
                  </box>

                  <box flexDirection="row" marginTop={1}>
                      {cell.kind !== "markdown" ? (
                        <box width={8} flexDirection="column">
                          {editorLines.map((line) => (
                            <text key={`${cell.id}-ln-${line.lineNumber}`} fg={theme.muted}>
                              {String(line.lineNumber).padStart(3, " ")}
                            </text>
                          ))}
                        </box>
                      ) : null}
                      <box flexDirection="column" flexGrow={1}>
                        {editorLines.map((line) => (
                          <box
                            key={`${cell.id}-line-${line.lineNumber}`}
                            id={
                              active && line.isCursorLine
                                ? "cursor-line"
                                : `line-${cell.id}-${line.lineNumber}`
                            }
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
                                  ? (cell.kind === "markdown" ? "#252a38" : "#303225")
                                  : "transparent"
                            }
                          >
                            {renderActiveLine(
                              line.text,
                              tokenizedSource[line.lineNumber - 1],
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
                        ))}
                      </box>
                    </box>

                  {cell.kind === "code" && cell.outputs.length > 0 ? (
                    <box
                      id={`output-${cell.id}`}
                      flexDirection="column"
                      marginTop={1}
                      paddingX={1}
                      paddingY={1}
                      border
                      borderStyle="rounded"
                      borderColor={active ? theme.borderActive : theme.border}
                      backgroundColor={active ? theme.panelAlt : theme.background}
                      onMouseDown={(event: {
                        button: number;
                        stopPropagation: () => void;
                      }) => {
                        if (event.button !== 0) return;
                        event.stopPropagation();
                        activateCell(cell.id, "editor");
                      }}
                    >
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme.muted}>
                          {`Out: ${cell.outputs.map((output) => output.kind).join(", ")}`}
                        </text>
                        <text fg={active ? theme.accent : theme.muted}>
                          {"Shift+E expands"}
                        </text>
                      </box>
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
                              theme.muted,
                              theme.accent,
                              true,
                              notebookWidth - 4,
                            )}
                          </box>
                        ),
                      )}
                    </box>
                  ) : null}
                </box>
              );
            })}
            {/* Tail padding: match the viewport height so that even the very
                last line of the very last cell can be scrolled all the way to
                the top of the viewport. This also gives the mouse wheel
                somewhere to go past the natural content end. */}
            <box height={Math.max(bodyHeight - 2, 4)} flexShrink={0} />
          </box>
        </box>
      </scrollbox>

      <box
        height={statusBarHeight}
        paddingX={1}
        flexDirection="column"
        backgroundColor={theme.statusBarBg}
        border={["top"]}
        borderColor={theme.border}
      >
        <text fg={theme.statusBarText}>{statusSummary}</text>
        <text fg={theme.muted}>{statusShortcutsHint}</text>
        <text fg={theme.statusBarText}>
          {state.ui.mode === "command" ? `:${state.ui.commandBuffer}` : statusMessage}
        </text>
      </box>

      {state.ui.helpOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          zIndex={20}
          backgroundColor={theme.background}
          justifyContent="center"
          alignItems="center"
        >
          <box
            width={Math.min(width - 4, Math.max(88, notebookWidth))}
            height={Math.max(14, Math.min(bodyHeight, height - 6))}
            border
            borderStyle="rounded"
            borderColor={theme.borderActive}
            backgroundColor={theme.panel}
            flexDirection="column"
            paddingX={1}
            paddingY={1}
          >
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.accent}>Shortcuts</text>
              <text fg={theme.muted}>Esc or Shift+H closes</text>
            </box>
            <scrollbox
              ref={helpScrollRef}
              focused
              flexGrow={1}
              marginTop={1}
              style={{ rootOptions: { backgroundColor: theme.panel } }}
            >
              <box flexDirection="column">
                {HELP_LINES.map((line, index) => (
                  <text key={`help-${index}`} fg={
                    !line ? theme.muted
                      : !line.startsWith("  ") && line.trim().length > 0 ? theme.accent
                      : theme.text
                  }>
                    {line || " "}
                  </text>
                ))}
              </box>
            </scrollbox>
          </box>
        </box>
      ) : null}

      {state.ui.outputDialogCellId ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          zIndex={30}
          backgroundColor={theme.background}
          justifyContent="center"
          alignItems="center"
        >
          <box
            width={Math.min(notebookWidth + 8, Math.max(70, width - 6))}
            height={Math.max(14, Math.min(height - 4, bodyHeight + 2))}
            border
            borderStyle="rounded"
            borderColor={theme.borderActive}
            backgroundColor={theme.panel}
            flexDirection="column"
            paddingX={1}
            paddingY={1}
          >
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.accent}>{`${state.ui.outputDialogCellId} output`}</text>
              <text fg={theme.muted}>Esc, Enter, or q closes</text>
            </box>
            <scrollbox
              ref={outputDialogScrollRef}
              focused
              flexGrow={1}
              marginTop={1}
              style={{ rootOptions: { backgroundColor: theme.panel } }}
            >
              <box flexDirection="column" gap={1}>
                {(state.notebook.present.cells.find((cell) => cell.id === state.ui.outputDialogCellId)?.outputs ?? []).map((output, index) =>
                  output.kind === "image" ? (
                    <box key={`dialog-output-${index}`} flexDirection="column">
                      {renderImageOutput(output, theme)}
                    </box>
                  ) : (
                    <box
                      key={`dialog-output-${index}`}
                      flexDirection="column"
                      border
                      borderStyle="rounded"
                      borderColor={theme.border}
                      paddingX={1}
                      paddingY={1}
                    >
                      {renderTextOutput(
                        output,
                        `dialog-output-${index}`,
                        output.kind === "error"
                          ? theme.error
                          : output.kind === "result"
                            ? theme.success
                            : theme.text,
                        theme.muted,
                        theme.accent,
                        false,
                        Math.min(notebookWidth + 8, Math.max(70, width - 6)) - 8,
                      )}
                    </box>
                  ),
                )}
              </box>
            </scrollbox>
          </box>
        </box>
      ) : null}
    </box>
  );
}

export { App };

if (import.meta.main) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });
  createRoot(renderer).render(<App />);
}
