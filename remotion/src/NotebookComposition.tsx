import React from "react";
import {
  applyNotebookOutput,
  getDisplayLines,
  getStructuredResultLines,
  type FormattedOutputLine,
} from "../../src/output-model";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { monokai } from "./theme";
import { Cell, CellOutput, PreviewSourcePanel, buildTypingSchedule } from "./Cell";
import { MarkdownCell } from "./MarkdownCell";
import { PreviewOverlay } from "./PreviewOverlay";
import { LabelBanner } from "./LabelBanner";
import type { Timeline, CellState, TimelineEvent, AnimationMode } from "./types";
import { getCellLabel, getPreviewLayout, resolvePreviewTargets, type PreviewTargetRef } from "./ntui";

export type NotebookProps = {
  timeline: Timeline;
  animationMode?: AnimationMode;
  fontSize?: number;
  maxOutputLines?: number;
  collapseCodeCellsOver?: number;
};

const SCROLL_SETTLE_SECONDS = 0.5;
const PREVIEW_DELAY_SECONDS = 0.7;
const PREVIEW_EXIT_SECONDS = 0.45;
const PREVIEW_MIN_VISIBLE_SECONDS = 2.0;
const HIGHLIGHT_INTRO_SECONDS = 0.45;
const HIGHLIGHT_OUTRO_SECONDS = 0.35;

function getCellAnimationMode(cell: Pick<CellState, "commands">, fallback: AnimationMode): AnimationMode {
  const inputMode = cell.commands?.input;
  if (inputMode === "present") {
    return "present";
  }
  if (inputMode === "fade") {
    return "block";
  }
  if (inputMode === "block" || inputMode === "line" || inputMode === "word" || inputMode === "char") {
    return inputMode;
  }
  return fallback;
}

function shouldPreviewOutput(cell: Pick<CellState, "commands">): boolean {
  return cell.commands?.output === "preview";
}

function hasHighlightCommands(cell: Pick<CellState, "commands">): boolean {
  return Boolean(cell.commands?.highlight || cell.commands?.highlight_focus);
}

function hasPreviewCommands(cell: Pick<CellState, "commands">): boolean {
  return Boolean(cell.commands?.preview || cell.commands?.source === "preview" || cell.commands?.output === "preview");
}

function getHighlightIntensity(
  frame: number,
  startFrame: number | null,
  endFrame: number | null,
  introFrames: number,
  outroFrames: number,
): number {
  if (startFrame === null) {
    return 0;
  }

  const introEnd = startFrame + introFrames;
  if (frame < startFrame) {
    return 0;
  }
  if (frame < introEnd) {
    return Math.max(0, Math.min(1, (frame - startFrame) / Math.max(1, introFrames)));
  }
  if (endFrame === null || frame < endFrame) {
    return 1;
  }
  if (frame < endFrame + outroFrames) {
    return Math.max(0, 1 - (frame - endFrame) / Math.max(1, outroFrames));
  }
  return 0;
}

function previewContainsCurrentOutput(targets: PreviewTargetRef[], cellIndex: number): boolean {
  return targets.some((target) => target.cellIndex === cellIndex && target.kind === "output");
}

function renderPreviewTargets(
  targets: PreviewTargetRef[],
  cellStates: CellState[],
  s: number,
  fontSize: number,
  commandCell: CellState,
  layout: ReturnType<typeof getPreviewLayout>,
  highlightIntensity: number,
) {
  const panels = targets.map((target, index) => {
    const cell = cellStates[target.cellIndex]!;
    const label = getCellLabel(cell);
    const title =
      label
        ? `${label}${target.kind === "source" ? " code" : " output"}`
        : target.kind === "source"
          ? "Code"
          : "Output";

    return (
      <div
        key={`${target.cellIndex}-${target.kind}-${index}`}
        style={{
          flex: layout === "columns" || layout === "main_rail" ? 1 : undefined,
          minWidth: layout === "center" ? "100%" : 0,
          padding: `${12 * s}px`,
          borderRadius: 12 * s,
          background: "rgba(28, 28, 28, 0.98)",
          border: `1px solid ${monokai.border}`,
        }}
      >
        <div style={{ color: monokai.muted, fontSize: 13 * s, marginBottom: 8 * s }}>
          {title}
        </div>
        {target.kind === "source" ? (
          <PreviewSourcePanel
            source={cell.source}
            scale={s}
            fontSize={fontSize}
            highlightRanges={commandCell.commands?.highlight}
            highlightFocusRanges={commandCell.commands?.highlight_focus}
            highlightIntensity={highlightIntensity}
          />
        ) : (
          <div style={{ paddingLeft: 8 * s, borderLeft: `${3 * s}px solid ${monokai.borderActive}` }}>
            {cell.outputs.map((output, outputIndex) => (
              <CellOutput
                key={outputIndex}
                output={output}
                scale={s}
                fontSize={fontSize}
                maxOutputLines={Number.MAX_SAFE_INTEGER}
              />
            ))}
          </div>
        )}
      </div>
    );
  });

  if (layout === "rows") {
    return <div style={{ display: "flex", flexDirection: "column", gap: 12 * s }}>{panels}</div>;
  }

  if (layout === "grid") {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: targets.length > 1 ? "1fr 1fr" : "1fr",
          gap: 12 * s,
        }}
      >
        {panels}
      </div>
    );
  }

  if (layout === "main_rail" && panels.length > 1) {
    const [main, ...rail] = panels;
    return (
      <div style={{ display: "flex", gap: 12 * s }}>
        <div style={{ flex: 1.6 }}>{main}</div>
        <div style={{ width: "32%", display: "flex", flexDirection: "column", gap: 12 * s }}>
          {rail}
        </div>
      </div>
    );
  }

  return <div style={{ display: "flex", flexDirection: "row", gap: 12 * s }}>{panels}</div>;
}

function buildFramePlan(
  cells: Timeline["cells"],
  events: TimelineEvent[],
  fps: number,
  animationMode: AnimationMode = "char",
) {
  const PAUSE_AFTER_FOCUS = 0.3 + SCROLL_SETTLE_SECONDS;
  const MIN_STREAM_GAP = 0.3;
  const PAUSE_AFTER_OUTPUT = 0.8;
  const INTRO_HOLD = 0.5;
  const OUTRO_HOLD = 2.0;
  const HIGHLIGHT_INTRO_FRAMES = Math.round(HIGHLIGHT_INTRO_SECONDS * fps);
  const HIGHLIGHT_OUTRO_FRAMES = Math.round(HIGHLIGHT_OUTRO_SECONDS * fps);
  const PREVIEW_MIN_VISIBLE_FRAMES = Math.round(PREVIEW_MIN_VISIBLE_SECONDS * fps);
  const PREVIEW_EXIT_FRAMES = Math.round(PREVIEW_EXIT_SECONDS * fps);

  // Track the last timestamp per cell to compute real time gaps
  const lastTsPerCell = new Map<number, number>();

  type FrameEvent = {
    event: TimelineEvent;
    frame: number;
  };

  const frameEvents: FrameEvent[] = [];
  let currentFrame = Math.round(INTRO_HOLD * fps);

  for (const event of events) {
    if (event.type === "output" || event.type === "complete") {
      const cellIndex = event.cellIndex;
      const prevTs = lastTsPerCell.get(cellIndex);
      if (prevTs !== undefined) {
        const realGap = (event.ts - prevTs) / 1000;
        currentFrame += Math.round(Math.max(MIN_STREAM_GAP, realGap) * fps);
      } else {
        // First output after source — use a minimum wait
        currentFrame += Math.round(MIN_STREAM_GAP * fps);
      }
      lastTsPerCell.set(cellIndex, event.ts);
    }

    frameEvents.push({ event, frame: currentFrame });

    if (event.type === "focus") {
      currentFrame += Math.round(PAUSE_AFTER_FOCUS * fps);
    } else if (event.type === "source") {
      const cellAnimationMode = getCellAnimationMode({ commands: cells[event.cellIndex]?.commands }, animationMode);
      const cellCommands = cells[event.cellIndex];
      // Record the source timestamp as the starting point for this cell's execution
      lastTsPerCell.set(event.cellIndex, event.ts);

      if (cellAnimationMode === "present") {
        currentFrame += Math.round(0.2 * fps);
      } else if (cellAnimationMode === "block") {
        currentFrame += Math.round(0.4 * fps);
      } else if (cellAnimationMode === "line") {
        const lines = event.source.split("\n").length;
        currentFrame += Math.round((lines * 0.15) * fps);
      } else if (cellAnimationMode === "word") {
        const words = event.source.split(/\s+/).length;
        currentFrame += Math.round((words / 8) * fps);
      } else {
        // Use the same typing schedule as the renderer for accurate duration
        const schedule = buildTypingSchedule(event.source, fps);
        const typingFrames = schedule.length > 0 ? schedule[schedule.length - 1]! + 1 : 0;
        currentFrame += typingFrames;
      }
      if (hasHighlightCommands({ commands: cellCommands?.commands })) {
        currentFrame += HIGHLIGHT_INTRO_FRAMES;
      }
    } else if (event.type === "complete") {
      currentFrame += Math.round(PAUSE_AFTER_OUTPUT * fps);
      const cellCommands = cells[event.cellIndex];
      if (hasPreviewCommands({ commands: cellCommands?.commands })) {
        currentFrame += PREVIEW_MIN_VISIBLE_FRAMES + PREVIEW_EXIT_FRAMES;
      }
      if (hasHighlightCommands({ commands: cellCommands?.commands })) {
        currentFrame += HIGHLIGHT_OUTRO_FRAMES;
      }
    }
  }

  currentFrame += Math.round(OUTRO_HOLD * fps);
  return { frameEvents, totalFrames: currentFrame };
}

/** Height of a collapsed cell: single row with padding + border + margin */
function collapsedCellHeight(s: number, fontSize: number): number {
  const lineHeight = Math.round(fontSize * 1.625) * s;
  // padding 8 top + 8 bottom, border 2*2, marginBottom 10
  return lineHeight + (16 + 4 + 10) * s;
}

function maxCharsPerLine(widthPx: number, fontSizePx: number): number {
  const monospaceCharWidth = fontSizePx * 0.62;
  return Math.max(8, Math.floor(widthPx / Math.max(1, monospaceCharWidth)));
}

function countWrappedLines(text: string, maxChars: number): number {
  const lines = text.split("\n");
  let total = 0;

  for (const line of lines) {
    if (line.length === 0) {
      total += 1;
      continue;
    }
    total += Math.max(1, Math.ceil(line.length / maxChars));
  }

  return total;
}

function wrapPlainLines(text: string, maxChars: number): string[] {
  const rawLines = text.split("\n");
  const wrapped: string[] = [];

  for (const line of rawLines) {
    if (line.length === 0) {
      wrapped.push("");
      continue;
    }

    let remaining = line;
    while (remaining.length > 0) {
      wrapped.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
  }

  return wrapped;
}

function getWrappedOutputLines(
  output: CellState["outputs"][number],
  maxChars: number,
): Array<string | FormattedOutputLine> {
  if (output.kind === "image") {
    return [];
  }

  if (output.kind === "result") {
    const structured = getStructuredResultLines(output.text, false);
    if (structured) {
      return structured.map((segments) => segments.map((segment) => segment.text).join(""));
    }
  }

  return wrapPlainLines(getDisplayLines(output.text).join("\n"), maxChars);
}

function visibleSourceLineCount(
  source: string,
  animationMode: AnimationMode,
  fps: number,
  frame: number,
  typeStart: number,
): number {
  const lines = source.split("\n");

  if (animationMode === "present" || animationMode === "block") {
    return frame >= typeStart ? lines.length : 1;
  }
  if (animationMode === "line") {
    const linesPerSecond = 6.67;
    const framesElapsed = Math.max(0, frame - typeStart);
    return Math.min(lines.length, Math.floor((framesElapsed / fps) * linesPerSecond) + 1);
  }
  if (animationMode === "word") {
    const wordsPerSecond = 8;
    const framesElapsed = Math.max(0, frame - typeStart);
    const revealedWordCount = Math.floor((framesElapsed / fps) * wordsPerSecond);
    const words = source.match(/\S+/g) || [];
    const totalWords = words.length;
    if (revealedWordCount >= totalWords) {
      return lines.length;
    }
    let revealedChars = 0;
    const wordMatches = [...source.matchAll(/\S+/g)];
    if (revealedWordCount > 0 && wordMatches[revealedWordCount - 1]) {
      const lastWord = wordMatches[revealedWordCount - 1]!;
      revealedChars = lastWord.index! + lastWord[0].length;
    }
    return lines.filter(
      (_, i) => i === 0 || revealedChars > lines.slice(0, i).join("\n").length + 1,
    ).length;
  }

  const schedule = buildTypingSchedule(source, fps);
  const framesElapsed = Math.max(0, frame - typeStart);
  let lo = 0;
  let hi = schedule.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (schedule[mid]! <= framesElapsed) lo = mid + 1;
    else hi = mid;
  }
  const revealedChars = Math.min(source.length, lo);
  return lines.filter(
    (_, i) => i === 0 || revealedChars > lines.slice(0, i).join("\n").length + 1,
  ).length;
}

function estimateOutputHeight(
  outputs: CellState["outputs"],
  s: number,
  fontSize: number,
  contentWidth: number,
  maxOutputLines: number,
): number {
  if (outputs.length === 0) {
    return 0;
  }

  const outputLineHeight = Math.round(fontSize * 1.5) * s;
  const outputChars = maxCharsPerLine(contentWidth, fontSize * s);
  let outputHeight = 0;

  for (const o of outputs) {
    if (o.kind === "image") {
      outputHeight += 200 * s;
      continue;
    }
    const wrapped = getWrappedOutputLines(o, outputChars);
    const visibleWrapped = Math.min(wrapped.length, maxOutputLines);
    outputHeight += Math.max(outputLineHeight, visibleWrapped * outputLineHeight);
    if (wrapped.length > visibleWrapped) {
      outputHeight += outputLineHeight;
    }
  }

  outputHeight += Math.round((fontSize - 4) * 1.4) * s + (4 + 8) * s;
  return outputHeight;
}

function estimateCellHeight(
  cell: CellState,
  collapsed: boolean,
  s: number,
  fontSize: number,
  sourceWrappedLines: number,
  outputHeight: number,
): number {
  if (collapsed) {
    return collapsedCellHeight(s, fontSize) + outputHeight;
  }

  const sourceLineHeight = Math.round(fontSize * 1.625) * s;

  if (cell.kind === "markdown") {
    return sourceWrappedLines * sourceLineHeight + 24 * s;
  }

  const headerHeight = Math.round((fontSize - 1) * 1.4) * s + 8 * s;
  const padding = (24 + 4 + 10) * s;
  const sourceHeight = sourceWrappedLines * sourceLineHeight;
  return headerHeight + sourceHeight + outputHeight + padding;
}

export const NotebookComposition: React.FC<NotebookProps> = ({
  timeline,
  animationMode = "char",
  fontSize = 16,
  maxOutputLines = 10,
  collapseCodeCellsOver = 5,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const { frameEvents } = buildFramePlan(timeline.cells, timeline.events, fps, animationMode);

  const cellStates: CellState[] = timeline.cells.map((c) => ({
    source: c.source,
    kind: c.kind ?? "code",
    commands: c.commands,
    executionCount: null,
    outputs: [],
    focused: false,
    running: false,
  }));

  const scrollSettleFrames = Math.round(SCROLL_SETTLE_SECONDS * fps);
  const previewDelayFrames = Math.round(PREVIEW_DELAY_SECONDS * fps);
  const previewExitFrames = Math.round(PREVIEW_EXIT_SECONDS * fps);
  const previewMinVisibleFrames = Math.round(PREVIEW_MIN_VISIBLE_SECONDS * fps);
  const highlightIntroFrames = Math.round(HIGHLIGHT_INTRO_SECONDS * fps);
  const highlightOutroFrames = Math.round(HIGHLIGHT_OUTRO_SECONDS * fps);

  // -1 means "never focused yet"
  // focusFrames = when the scroll starts (cell becomes focused)
  // typingFrames = when typing animation begins (after scroll settles)
  const focusFrames: number[] = new Array(timeline.cells.length).fill(-1);
  const typingFrames: number[] = new Array(timeline.cells.length).fill(-1);
  const outputFrames: (number | null)[] = new Array(timeline.cells.length).fill(null);
  const completeFrames: (number | null)[] = new Array(timeline.cells.length).fill(null);

  let currentFocus = -1;

  for (const { event, frame: eventFrame } of frameEvents) {
    if (eventFrame > frame) break;

    if (event.type === "clear") {
      for (const cs of cellStates) {
        cs.outputs = [];
        cs.executionCount = null;
      }
    } else if (event.type === "focus") {
      if (currentFocus >= 0) {
        cellStates[currentFocus]!.focused = false;
        cellStates[currentFocus]!.running = false;
      }
      currentFocus = event.cellIndex;
      cellStates[currentFocus]!.focused = true;
      cellStates[currentFocus]!.running = true;
      focusFrames[event.cellIndex] = eventFrame;
      typingFrames[event.cellIndex] = eventFrame + scrollSettleFrames;
    } else if (event.type === "output") {
      const cs = cellStates[event.cellIndex]!;
      cs.outputs = applyNotebookOutput(cs.outputs, event.output);
      if (outputFrames[event.cellIndex] === null) {
        outputFrames[event.cellIndex] = eventFrame;
      }
    } else if (event.type === "complete") {
      const cs = cellStates[event.cellIndex]!;
      cs.executionCount = event.executionCount;
      cs.running = false;
      completeFrames[event.cellIndex] = eventFrame;
      if (outputFrames[event.cellIndex] === null) {
        outputFrames[event.cellIndex] = eventFrame;
      }
    }
  }

  const focusSequence = frameEvents
    .filter((entry): entry is { event: Extract<TimelineEvent, { type: "focus" }>; frame: number } => entry.event.type === "focus")
    .map((entry) => ({ cellIndex: entry.event.cellIndex, frame: entry.frame }));
  const nextFocusFrames: Array<number | null> = new Array(timeline.cells.length).fill(null);
  for (let i = 0; i < focusSequence.length; i += 1) {
    const current = focusSequence[i]!;
    const next = focusSequence[i + 1];
    nextFocusFrames[current.cellIndex] = next?.frame ?? null;
  }

  // Scale all sizes proportionally to width (designed at 1920)
  const s = width / 1920;

  // Collapse past cells: a cell collapses once a later cell receives focus
  const collapsedCells: boolean[] = new Array(timeline.cells.length).fill(false);
  if (currentFocus >= 0) {
    for (let i = 0; i < currentFocus; i++) {
      if (focusFrames[i]! >= 0 && cellStates[i]!.source.split("\n").length > collapseCodeCellsOver) collapsedCells[i] = true;
    }
  }

  const viewportHeight = height - 40 * s;
  const notebookWidth = Math.round(width * (height > width ? 0.9 : 0.625));
  const sourceWidth = Math.max(120, notebookWidth - (16 * 2 + 24 + 12) * s);
  const outputWidth = Math.max(120, notebookWidth - (16 * 2 + 12 + 12) * s);
  const sourceChars = maxCharsPerLine(sourceWidth, (fontSize + 1) * s);

  const cellHeights = cellStates.map((cell, i) => {
    const isCurrent = i === currentFocus;
    const hasFocused = focusFrames[i]! >= 0;
    const typeStart = typingFrames[i] ?? focusFrames[i] ?? 0;
    const visibleLines =
      cell.kind === "markdown"
        ? countWrappedLines(cell.source || "*empty*", sourceChars)
        : !hasFocused
          ? 1
          : countWrappedLines(
            cell.source.split("\n").slice(
              0,
              visibleSourceLineCount(cell.source, getCellAnimationMode(cell, animationMode), fps, frame, typeStart),
            ).join("\n"),
            sourceChars,
          );
    const previewTargets = resolvePreviewTargets(timeline, i, cell.commands);
    const previewedOutput = previewContainsCurrentOutput(previewTargets, i) || shouldPreviewOutput(cell);
    const previewStart = outputFrames[i] === null ? null : outputFrames[i]! + previewDelayFrames;
    const previewEnd = nextFocusFrames[i];
    const previewVisibleUntil = previewStart === null ? null : previewStart + previewMinVisibleFrames;
    const highlightEnd = previewEnd === null ? null : previewEnd - highlightOutroFrames;
    const previewCloseStart =
      previewEnd === null
        ? null
        : Math.max(previewEnd - previewExitFrames - highlightOutroFrames, previewVisibleUntil ?? 0);
    const previewWindowActive =
      previewTargets.length > 0 &&
      previewStart !== null &&
      frame >= previewStart &&
      (previewCloseStart == null || frame < previewCloseStart + previewExitFrames);
    const cellMaxOutputLines = previewedOutput ? Number.MAX_SAFE_INTEGER : maxOutputLines;
    const outputHeight =
      previewWindowActive
        ? 0
        : (outputFrames[i] !== null && frame >= outputFrames[i]!) || cell.outputs.length > 0
          ? estimateOutputHeight(cell.outputs, s, fontSize, outputWidth, cellMaxOutputLines)
        : 0;

    return estimateCellHeight(
      cell,
      collapsedCells[i]!,
      s,
      fontSize,
      collapsedCells[i]! && !isCurrent ? 1 : visibleLines,
      outputHeight,
    );
  });

  const getCellTop = (cellIndex: number) => {
    let y = 0;
    for (let i = 0; i < cellIndex; i++) {
      y += cellHeights[i]!;
    }
    return y;
  };

  let scrollY = 0;
  if (currentFocus >= 0) {
    const cellTop = getCellTop(currentFocus);
    const cellBottom = cellTop + cellHeights[currentFocus]!;
    const topMargin = viewportHeight * 0.15;
    const bottomMargin = viewportHeight * 0.18;

    if (cellBottom > viewportHeight - bottomMargin) {
      scrollY = Math.max(0, cellBottom - (viewportHeight - bottomMargin));
    }
    if (cellTop < scrollY + topMargin) {
      scrollY = Math.max(0, cellTop - topMargin);
    }
  }

  // Status bar
  let statusText = "Normal mode";
  const lastEvent = frameEvents.filter((e) => e.frame <= frame).at(-1);
  if (lastEvent?.event.type === "focus" || lastEvent?.event.type === "source" || lastEvent?.event.type === "output") {
    const cellIndex = "cellIndex" in lastEvent.event ? lastEvent.event.cellIndex : 0;
    statusText = `Running cell-${cellIndex + 1}...`;
  } else if (lastEvent?.event.type === "complete") {
    statusText = `Executed cell-${lastEvent.event.cellIndex + 1}.`;
  } else if (lastEvent?.event.type === "done") {
    statusText = "All cells executed.";
  }

  const statusBarHeight = Math.round(40 * s);
  let previewCellIndex: number | null = null;
  for (let i = 0; i < cellStates.length; i += 1) {
    const previewStart = outputFrames[i] === null ? null : outputFrames[i]! + previewDelayFrames;
    const previewEnd = nextFocusFrames[i];
    const previewVisibleUntil = previewStart === null ? null : previewStart + previewMinVisibleFrames;
    const previewCloseStart =
      previewEnd === null
        ? null
        : Math.max(previewEnd - previewExitFrames - highlightOutroFrames, previewVisibleUntil ?? 0);
    if (
      resolvePreviewTargets(timeline, i, cellStates[i]!.commands).length > 0 &&
      previewStart !== null &&
      frame >= previewStart &&
      (previewCloseStart == null || frame < previewCloseStart + previewExitFrames)
    ) {
      previewCellIndex = i;
    }
  }
  const previewCell = previewCellIndex === null ? null : cellStates[previewCellIndex]!;
  const previewStartFrame =
    previewCellIndex !== null && outputFrames[previewCellIndex] !== null
      ? outputFrames[previewCellIndex]! + previewDelayFrames
      : 0;
  const previewEndFrame =
    previewCellIndex !== null
      ? (() => {
          const previewStart = outputFrames[previewCellIndex] === null ? null : outputFrames[previewCellIndex]! + previewDelayFrames;
          const previewVisibleUntil = previewStart === null ? null : previewStart + previewMinVisibleFrames;
          const nextFocus = nextFocusFrames[previewCellIndex];
          if (nextFocus == null) {
            return null;
          }
          return Math.max(nextFocus - previewExitFrames - highlightOutroFrames, previewVisibleUntil ?? nextFocus);
        })()
      : null;
  const previewTargets =
    previewCellIndex !== null
      ? resolvePreviewTargets(timeline, previewCellIndex, previewCell?.commands)
      : [];
  const previewLayout = getPreviewLayout(previewCell?.commands, previewTargets.length);
  const labelCell = currentFocus >= 0 ? cellStates[currentFocus] : null;
  const labelText = labelCell ? getCellLabel(labelCell) : null;

  const highlightIntensityByCell = cellStates.map((cell, i) => {
    if (!hasHighlightCommands(cell)) {
      return 0;
    }
    const firstRevealFrame = outputFrames[i] ?? completeFrames[i];
    const startFrame = firstRevealFrame === null ? null : firstRevealFrame - highlightIntroFrames;
    const endFrame = nextFocusFrames[i] === null ? null : nextFocusFrames[i]! - highlightOutroFrames;
    return getHighlightIntensity(frame, startFrame, endFrame, highlightIntroFrames, highlightOutroFrames);
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: monokai.bg,
        fontFamily: '"JetBrains Mono", monospace',
        color: monokai.text,
        overflow: "hidden",
        fontSize: `${fontSize * s}px`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: statusBarHeight,
          overflow: "hidden",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: notebookWidth,
            paddingTop: Math.round(24 * s),
            paddingBottom: Math.round(24 * s),
            transform: `translateY(${-scrollY}px)`,
          }}
        >
          {cellStates.map((cell, i) => {
            const hasFocused = focusFrames[i]! >= 0;
            const isCurrent = i === currentFocus;
            const isPast = currentFocus >= 0 && i < currentFocus && hasFocused;
            const isCollapsed = collapsedCells[i]!;
            const cellOpacity = (isCurrent || isPast) ? 1 : 0.35;

            return (
              <div key={i} style={{ opacity: cellOpacity }}>
                {cell.kind === "markdown" ? (
                  <MarkdownCell
                    source={cell.source}
                    focused={cell.focused}
                    focusFrame={focusFrames[i]!}
                    typingFrame={typingFrames[i]!}
                    index={i}
                    total={cellStates.length}
                    scale={s}
                    fontSize={fontSize}
                  />
                ) : (
                  <Cell
                    cell={cell}
                    index={i}
                    total={cellStates.length}
                    focusFrame={focusFrames[i]!}
                    typingFrame={typingFrames[i]!}
                    outputFrame={outputFrames[i] ?? null}
                    animationMode={getCellAnimationMode(cell, animationMode)}
                    sourceFade={cell.commands?.input === "fade"}
                    inlineOutputVisible={
                      !previewContainsCurrentOutput(resolvePreviewTargets(timeline, i, cell.commands), i) ||
                      outputFrames[i] === null ||
                      frame < outputFrames[i]! + previewDelayFrames ||
                      (() => {
                        const previewStart = outputFrames[i] === null ? null : outputFrames[i]! + previewDelayFrames;
                        const previewVisibleUntil = previewStart === null ? null : previewStart + previewMinVisibleFrames;
                        const previewCloseStart =
                          nextFocusFrames[i] === null
                            ? null
                            : Math.max(nextFocusFrames[i]! - previewExitFrames - highlightOutroFrames, previewVisibleUntil ?? 0);
                        const previewRestoreAt =
                          previewCloseStart === null
                            ? null
                            : previewCloseStart + previewExitFrames;
                        return previewRestoreAt !== null && frame >= previewRestoreAt;
                      })()
                    }
                    highlightRanges={cell.commands?.highlight}
                    highlightFocusRanges={cell.commands?.highlight_focus}
                    highlightIntensity={highlightIntensityByCell[i]!}
                    scale={s}
                    fontSize={fontSize}
                    collapsed={isCollapsed}
                    maxOutputLines={cell.commands?.output === "preview" ? Number.MAX_SAFE_INTEGER : maxOutputLines}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {labelText && currentFocus >= 0 ? (
        <LabelBanner text={labelText} startFrame={focusFrames[currentFocus] ?? 0} scale={s} />
      ) : null}

      {previewCell ? (
        <PreviewOverlay
          visible={true}
          startFrame={previewStartFrame}
          endFrame={previewEndFrame}
          exitDurationFrames={previewExitFrames}
          scale={s}
          title={getCellLabel(previewCell) || "Preview"}
          callout={previewCell.commands?.callout}
        >
          {renderPreviewTargets(
            previewTargets,
            cellStates,
            s * 1.02,
            fontSize + 1,
            previewCell,
            previewLayout,
            highlightIntensityByCell[previewCellIndex!] ?? 1,
          )}
        </PreviewOverlay>
      ) : null}

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: statusBarHeight,
          background: monokai.statusBg,
          borderTop: `1px solid ${monokai.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${16 * s}px`,
          fontSize: 15 * s,
        }}
      >
        <span style={{ color: monokai.text }}>{statusText}</span>
        <span style={{ color: monokai.muted }}>notebook-tui</span>
      </div>
    </AbsoluteFill>
  );
};

export function getNotebookDuration(timeline: Timeline, fps: number, animationMode: AnimationMode = "char"): number {
  const { totalFrames } = buildFramePlan(timeline.cells, timeline.events, fps, animationMode);
  return totalFrames;
}
