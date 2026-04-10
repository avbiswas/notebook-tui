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
};

function buildFramePlan(
  events: TimelineEvent[],
  fps: number,
  animationMode: AnimationMode = "char",
) {
  const PAUSE_AFTER_FOCUS = 0.3;
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

function estimateCellHeight(cell: CellState, hasOutput: boolean, s: number): number {
  if (cell.kind === "markdown") {
    const lines = cell.source.split("\n").length;
    return lines * 26 * s + 24 * s;
  }
  const headerHeight = 32 * s;
  const padding = (28 + 12) * s;
  const lineHeight = 26 * s;
  const sourceLines = cell.source.split("\n").length;
  const sourceHeight = sourceLines * lineHeight;
  let outputHeight = 0;
  if (hasOutput) {
    for (const o of cell.outputs) {
      if (o.kind === "image") {
        outputHeight += 200 * s;
      } else {
        const text = "text" in o ? o.text : "";
        outputHeight += Math.max(24 * s, text.split("\n").length * 24 * s);
      }
    }
    outputHeight += 30 * s;
  }
  return headerHeight + sourceHeight + outputHeight + padding;
}

export const NotebookComposition: React.FC<NotebookProps> = ({ timeline, animationMode = "char" }) => {
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

  // -1 means "never focused yet"
  const focusFrames: number[] = new Array(timeline.cells.length).fill(-1);
  const outputFrames: (number | null)[] = new Array(timeline.cells.length).fill(null);

  let currentFocus = -1;
  // Track previous focus change for scroll animation
  let prevFocusFrame = 0;
  let prevFocusIndex = 0;

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
        prevFocusIndex = currentFocus;
      }
      prevFocusFrame = eventFrame;
      currentFocus = event.cellIndex;
      cellStates[currentFocus]!.focused = true;
      cellStates[currentFocus]!.running = true;
      focusFrames[event.cellIndex] = eventFrame;
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

  // --- Scrolling ---
  // Calculate scroll target for any cell index
  const getScrollForCell = (cellIndex: number) => {
    let y = 0;
    for (let i = 0; i < cellIndex; i++) {
      const hasOutput = outputFrames[i] !== null && frame >= outputFrames[i]!;
      y += estimateCellHeight(cellStates[i]!, hasOutput, s);
    }
    const viewportHeight = height - 40 * s;
    const scrollOffset = height > width ? 0.15 : 0.3;
    return Math.max(0, y - viewportHeight * scrollOffset);
  };

  let scrollY = 0;
  if (currentFocus >= 0) {
    const targetScroll = getScrollForCell(currentFocus);
    const prevScroll = getScrollForCell(prevFocusIndex);

    const scrollProgress = spring({
      frame,
      fps,
      delay: prevFocusFrame,
      config: { damping: 200 },
    });

    scrollY = interpolate(scrollProgress, [0, 1], [prevScroll, targetScroll]);
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
        fontSize: `${16 * s}px`,
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
            const cellOpacity = (isCurrent || isPast) ? 1 : 0.35;

            return (
              <div key={i} style={{ opacity: cellOpacity }}>
                {cell.kind === "markdown" ? (
                  <MarkdownCell
                    source={cell.source}
                    focused={cell.focused}
                    focusFrame={focusFrames[i]!}
                    index={i}
                    total={cellStates.length}
                    scale={s}
                  />
                ) : (
                  <Cell
                    cell={cell}
                    index={i}
                    total={cellStates.length}
                    focusFrame={focusFrames[i]!}
                    outputFrame={outputFrames[i]}
                    animationMode={animationMode}
                    scale={s}
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
