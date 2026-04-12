import React from "react";
import { applyNotebookOutput } from "../../src/output-model";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { monokai } from "./theme";
import { Cell, buildTypingSchedule } from "./Cell";
import { MarkdownCell } from "./MarkdownCell";
import type { Timeline, CellState, TimelineEvent, AnimationMode } from "./types";

export type NotebookProps = {
  timeline: Timeline;
  animationMode?: AnimationMode;
  fontSize?: number;
};

const SCROLL_SETTLE_SECONDS = 0.5;

function buildFramePlan(
  events: TimelineEvent[],
  fps: number,
  animationMode: AnimationMode = "char",
) {
  const PAUSE_AFTER_FOCUS = 0.3 + SCROLL_SETTLE_SECONDS;
  const MIN_STREAM_GAP = 0.3;
  const PAUSE_AFTER_OUTPUT = 0.8;
  const INTRO_HOLD = 0.5;
  const OUTRO_HOLD = 2.0;

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
      // Record the source timestamp as the starting point for this cell's execution
      lastTsPerCell.set(event.cellIndex, event.ts);

      if (animationMode === "present") {
        currentFrame += Math.round(0.2 * fps);
      } else if (animationMode === "block") {
        currentFrame += Math.round(0.4 * fps);
      } else if (animationMode === "line") {
        const lines = event.source.split("\n").length;
        currentFrame += Math.round((lines * 0.15) * fps);
      } else if (animationMode === "word") {
        const words = event.source.split(/\s+/).length;
        currentFrame += Math.round((words / 8) * fps);
      } else {
        // Use the same typing schedule as the renderer for accurate duration
        const schedule = buildTypingSchedule(event.source, fps);
        const typingFrames = schedule.length > 0 ? schedule[schedule.length - 1]! + 1 : 0;
        currentFrame += typingFrames;
      }
    } else if (event.type === "complete") {
      currentFrame += Math.round(PAUSE_AFTER_OUTPUT * fps);
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

function estimateCellHeight(
  cell: CellState, hasOutput: boolean, collapsed: boolean, s: number, fontSize: number,
): number {
  if (collapsed) return collapsedCellHeight(s, fontSize);

  const sourceLineHeight = Math.round(fontSize * 1.625) * s;
  const outputLineHeight = Math.round(fontSize * 1.5) * s;

  if (cell.kind === "markdown") {
    const lines = cell.source.split("\n").length;
    return lines * sourceLineHeight + 24 * s;
  }

  const headerHeight = Math.round((fontSize - 1) * 1.4) * s + 8 * s;
  const padding = (24 + 4 + 10) * s;
  const sourceLines = cell.source.split("\n").length;
  const sourceHeight = sourceLines * sourceLineHeight;

  let outputHeight = 0;
  if (hasOutput) {
    for (const o of cell.outputs) {
      if (o.kind === "image") {
        outputHeight += 200 * s;
      } else {
        const text = "text" in o ? o.text : "";
        const lines = text.split("\n").length;
        outputHeight += Math.max(outputLineHeight, lines * outputLineHeight);
      }
    }
    outputHeight += Math.round((fontSize - 4) * 1.4) * s + (4 + 8) * s;
  }
  return headerHeight + sourceHeight + outputHeight + padding;
}

export const NotebookComposition: React.FC<NotebookProps> = ({ timeline, animationMode = "char", fontSize = 16 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const { frameEvents } = buildFramePlan(timeline.events, fps, animationMode);

  const cellStates: CellState[] = timeline.cells.map((c) => ({
    source: c.source,
    kind: c.kind ?? "code",
    executionCount: null,
    outputs: [],
    focused: false,
    running: false,
  }));

  const scrollSettleFrames = Math.round(SCROLL_SETTLE_SECONDS * fps);

  // -1 means "never focused yet"
  // focusFrames = when the scroll starts (cell becomes focused)
  // typingFrames = when typing animation begins (after scroll settles)
  const focusFrames: number[] = new Array(timeline.cells.length).fill(-1);
  const typingFrames: number[] = new Array(timeline.cells.length).fill(-1);
  const outputFrames: (number | null)[] = new Array(timeline.cells.length).fill(null);

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
      if (outputFrames[event.cellIndex] === null) {
        outputFrames[event.cellIndex] = eventFrame;
      }
    }
  }

  // Scale all sizes proportionally to width (designed at 1920)
  const s = width / 1920;

  // Collapse past cells: a cell collapses once a later cell receives focus
  const collapsedCells: boolean[] = new Array(timeline.cells.length).fill(false);
  if (currentFocus >= 0) {
    for (let i = 0; i < currentFocus; i++) {
      if (focusFrames[i]! >= 0 && cellStates[i]!.source.split("\n").length > 5) collapsedCells[i] = true;
    }
  }

  // --- Lazy scrolling ---
  // Only scroll when the focused cell's bottom would overflow the viewport.
  // When it does, snap the cell's top to the top of the viewport.
  const viewportHeight = height - 40 * s;

  const getCellTop = (cellIndex: number) => {
    let y = 0;
    for (let i = 0; i < cellIndex; i++) {
      const hasOutput = outputFrames[i] !== null && frame >= outputFrames[i]!;
      y += estimateCellHeight(cellStates[i]!, hasOutput, collapsedCells[i]!, s, fontSize);
    }
    return y;
  };

  // Replay all focus events to compute the lazy scroll position at each step.
  // This way each scroll decision is based on the accumulated scroll state.
  let lazyScroll = 0;
  let lazyScrollPrev = 0;
  let lastFocusFrame = 0;
  {
    const focusEvents = frameEvents.filter((fe) => fe.event.type === "focus" && fe.frame <= frame);
    for (const fe of focusEvents) {
      const focusEvt = fe.event as { type: "focus"; cellIndex: number };
      lazyScrollPrev = lazyScroll;
      lastFocusFrame = fe.frame;

      const cellTop = getCellTop(focusEvt.cellIndex);
      const hasOut = outputFrames[focusEvt.cellIndex] !== null && frame >= outputFrames[focusEvt.cellIndex]!;
      const cellBottom = cellTop + estimateCellHeight(cellStates[focusEvt.cellIndex]!, hasOut, false, s, fontSize);

      if (cellBottom > lazyScroll + viewportHeight) {
        // Cell overflows bottom — put cell top at 25% from viewport top
        lazyScroll = Math.max(0, cellTop - viewportHeight * 0.25);
      } else if (cellTop < lazyScroll) {
        // Cell is above viewport — bring it into view at 25%
        lazyScroll = Math.max(0, cellTop - viewportHeight * 0.25);
      }
    }
  }

  let scrollY = 0;
  if (currentFocus >= 0) {
    const scrollProgress = spring({
      frame,
      fps,
      delay: lastFocusFrame,
      config: { damping: 200 },
    });

    scrollY = interpolate(scrollProgress, [0, 1], [lazyScrollPrev, lazyScroll]);
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
            width: Math.round(width * (height > width ? 0.9 : 0.625)),
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
                    outputFrame={outputFrames[i]}
                    animationMode={animationMode}
                    scale={s}
                    fontSize={fontSize}
                    collapsed={isCollapsed}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

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
  const { totalFrames } = buildFramePlan(timeline.events, fps, animationMode);
  return totalFrames;
}
