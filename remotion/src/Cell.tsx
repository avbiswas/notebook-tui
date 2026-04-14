import React, { useMemo } from "react";
import { getDisplayLines, getStructuredResultLines, type FormattedOutputLine } from "../../src/output-model";
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { monokai } from "./theme";
import { SyntaxLine, useTokenizedSource } from "./SyntaxLine";
import type { CellState, AnimationMode } from "./types";
import { lineInRanges, parseHighlightRanges } from "./ntui";

/**
 * Build a schedule of "at which frame does character N appear" using
 * variable typing speed. Deterministic per source string.
 * Returns an array where schedule[i] = frame offset when char i is revealed.
 */
export function buildTypingSchedule(source: string, fps: number): number[] {
  const BASE_CPS = 45; // base characters per second
  const schedule: number[] = [];
  let time = 0; // accumulated time in seconds

  // Simple seeded PRNG for deterministic pauses
  let seed = 0;
  for (let i = 0; i < Math.min(source.length, 100); i++) {
    seed = (seed * 31 + source.charCodeAt(i)) | 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 0) / 4294967296);
  };

  for (let i = 0; i < source.length; i++) {
    schedule.push(Math.round(time * fps));
    const ch = source[i]!;

    // Base typing delay
    let delay = 1 / BASE_CPS;

    if (ch === "\n") {
      // Pause at end of line: 0.08–0.25s
      delay = 0.08 + rand() * 0.17;
    } else if (ch === " " || ch === "\t") {
      // Small pause at whitespace
      delay = (1 / BASE_CPS) + rand() * 0.04;
    } else if (ch === "(" || ch === ")" || ch === ":" || ch === "=" || ch === ",") {
      // Slight pause at punctuation
      delay = (1 / BASE_CPS) + rand() * 0.03;
    } else {
      // Normal char with slight jitter
      delay = (1 / BASE_CPS) * (0.7 + rand() * 0.6);
    }

    time += delay;
  }

  return schedule;
}

export const CellOutput: React.FC<{
  output: CellState["outputs"][number];
  scale: number;
  fontSize: number;
  maxOutputLines: number;
}> = ({ output, scale: s, fontSize, maxOutputLines }) => {
  const { width, height } = useVideoConfig();
  if (output.kind === "image" && output.data) {
    return (
      <div
        style={{
          marginTop: 6 * s,
          padding: `${8 * s}px ${10 * s}px`,
          border: `${1 * s}px solid ${monokai.border}`,
          borderRadius: 6 * s,
          background: monokai.panelAlt,
        }}
      >
        <div style={{ color: monokai.muted, fontSize: (fontSize - 3) * s, marginBottom: 4 * s }}>
          {output.mimeType}
          {output.width > 0 ? ` (${output.width}x${output.height})` : ""}
        </div>
        <img
          src={`data:${output.mimeType};base64,${output.data}`}
          style={{
            maxWidth: "100%",
            borderRadius: 4 * s,
          }}
        />
      </div>
    );
  }

  if (output.kind === "image" && output.preview) {
    return (
      <div
        style={{
          marginTop: 6 * s,
          padding: `${8 * s}px ${10 * s}px`,
          border: `${1 * s}px solid ${monokai.border}`,
          borderRadius: 6 * s,
          background: monokai.panelAlt,
        }}
      >
        {output.preview.map((row, ri) => (
          <div key={ri} style={{ lineHeight: `${10 * s}px`, height: 10 * s }}>
            {row.map((span, si) => (
              <span
                key={si}
                style={{
                  color: span.fg,
                  backgroundColor: span.bg,
                  fontSize: 10 * s,
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {span.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (output.kind === "image") return null;

  const color =
    output.kind === "error"
      ? monokai.error
      : output.kind === "result"
        ? monokai.success
        : monokai.text;
  const lines: Array<string | FormattedOutputLine> =
    output.kind === "result"
      ? (getStructuredResultLines(output.text, false) ?? getDisplayLines(output.text))
      : getDisplayLines(output.text);
  const notebookWidth = Math.round(width * (height > width ? 0.9 : 0.625));
  const outputWidth = Math.max(120, notebookWidth - (16 * 2 + 12 + 12) * s);
  const outputChars = Math.max(8, Math.floor(outputWidth / Math.max(1, fontSize * s * 0.62)));
  const wrappedLines: Array<string | FormattedOutputLine> = [];
  for (const line of lines) {
    if (typeof line !== "string") {
      wrappedLines.push(line);
      continue;
    }
    if (line.length === 0) {
      wrappedLines.push("");
      continue;
    }
    for (const chunk of line.match(new RegExp(`.{1,${outputChars}}`, "g")) ?? [""]) {
      wrappedLines.push(chunk);
    }
  }
  const visibleLines = wrappedLines.slice(0, maxOutputLines);
  const hiddenLineCount = Math.max(0, wrappedLines.length - visibleLines.length);

  return (
    <div
      style={{
        color,
        fontSize: fontSize * s,
        lineHeight: `${Math.round(fontSize * 1.5) * s}px`,
        wordWrap: "break-word",
        overflowWrap: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >
      {visibleLines.map((line, index) => (
        <div key={index} style={{ minHeight: 24 * s }}>
          {typeof line === "string"
            ? (line.length > 0 ? line : "\u00a0")
            : line.map((segment, segmentIndex) => (
              <span
                key={`${index}-${segmentIndex}`}
                style={{
                  color:
                    segment.kind === "key"
                      ? monokai.accent
                      : segment.kind === "punctuation"
                        ? monokai.muted
                        : color,
                }}
              >
                {segment.text.length > 0 ? segment.text : "\u00a0"}
              </span>
            ))}
        </div>
      ))}
      {hiddenLineCount > 0 ? (
        <div style={{ minHeight: 24 * s, color: monokai.muted }}>
          {`... ${hiddenLineCount} more line${hiddenLineCount === 1 ? "" : "s"}`}
        </div>
      ) : null}
    </div>
  );
};

export const PreviewSourcePanel: React.FC<{
  source: string;
  scale: number;
  fontSize: number;
  highlightRanges?: string;
  highlightFocusRanges?: string;
  highlightIntensity?: number;
}> = ({ source, scale: s, fontSize, highlightRanges, highlightFocusRanges, highlightIntensity = 1 }) => {
  const tokenizedLines = useTokenizedSource(source);
  const lines = source.split("\n");
  const highlighted = parseHighlightRanges(highlightRanges);
  const focused = parseHighlightRanges(highlightFocusRanges);
  const dimOthers = focused.length > 0;

  return (
    <div style={{ display: "flex", gap: 12 * s }}>
      <div
        style={{
          color: monokai.muted,
          textAlign: "right",
          minWidth: 30 * s,
          fontSize: fontSize * s,
          lineHeight: `${Math.round(fontSize * 1.6) * s}px`,
        }}
      >
        {lines.map((_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <div
        style={{
          flex: 1,
          fontSize: fontSize * s,
          lineHeight: `${Math.round(fontSize * 1.6) * s}px`,
        }}
      >
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const isHighlighted = lineInRanges(lineNumber, highlighted) || lineInRanges(lineNumber, focused);
          const isFocused = lineInRanges(lineNumber, focused);
          return (
            <div
              key={index}
              style={{
                padding: `0 ${6 * s}px`,
                marginBottom: 2 * s,
                borderRadius: 6 * s,
                background: isHighlighted ? `rgba(102, 217, 239, ${0.12 * highlightIntensity})` : "transparent",
                opacity: dimOthers && !isFocused ? 1 - 0.68 * highlightIntensity : 1,
                borderLeft: isFocused ? `${3 * s}px solid rgba(166, 226, 46, ${highlightIntensity})` : `${3 * s}px solid transparent`,
              }}
            >
              <SyntaxLine tokens={tokenizedLines[index] ?? [{ text: line, color: monokai.text }]} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Renders a syntax-highlighted line with a highlighted text span (for arrow annotations).
 * Splits tokens at the span boundaries and wraps the matching segment with a background.
 */
const ArrowHighlightLine: React.FC<{
  tokens: { text: string; color: string }[];
  spanStart: number;
  spanEnd: number;
  intensity: number;
  scale: number;
}> = ({ tokens, spanStart, spanEnd, intensity, scale: s }) => {
  // Walk through tokens, splitting at spanStart/spanEnd boundaries
  const segments: { text: string; color: string; highlighted: boolean }[] = [];
  let charOffset = 0;

  for (const tok of tokens) {
    const tokEnd = charOffset + tok.text.length;
    if (tokEnd <= spanStart || charOffset >= spanEnd) {
      // Token is entirely outside the highlight span
      segments.push({ text: tok.text, color: tok.color, highlighted: false });
    } else {
      // Token overlaps with the highlight span — split into up to 3 parts
      const beforeLen = Math.max(0, spanStart - charOffset);
      const afterLen = Math.max(0, tokEnd - spanEnd);
      const highlightLen = tok.text.length - beforeLen - afterLen;

      if (beforeLen > 0) {
        segments.push({ text: tok.text.slice(0, beforeLen), color: tok.color, highlighted: false });
      }
      if (highlightLen > 0) {
        segments.push({ text: tok.text.slice(beforeLen, beforeLen + highlightLen), color: tok.color, highlighted: true });
      }
      if (afterLen > 0) {
        segments.push({ text: tok.text.slice(tok.text.length - afterLen), color: tok.color, highlighted: false });
      }
    }
    charOffset = tokEnd;
  }

  return (
    <>
      {segments.map((seg, idx) => (
        <span
          key={idx}
          style={{
            color: seg.color,
            background: seg.highlighted
              ? `rgba(166, 226, 46, ${0.28 * intensity})`
              : undefined,
            borderRadius: seg.highlighted ? 3 * s : undefined,
            padding: seg.highlighted ? `${0.5 * s}px ${2 * s}px` : undefined,
            margin: seg.highlighted ? `0 ${-1 * s}px` : undefined,
          }}
        >
          {seg.text}
        </span>
      ))}
    </>
  );
};

export const Cell: React.FC<{
  cell: CellState;
  index: number;
  total: number;
  focusFrame: number;
  typingFrame?: number;
  outputFrame: number | null;
  animationMode?: AnimationMode;
  sourceFade?: boolean;
  inlineOutputVisible?: boolean;
  highlightRanges?: string;
  highlightFocusRanges?: string;
  highlightIntensity?: number;
  arrowHighlight?: { line: number; text: string };
  arrowIntensity?: number;
  scale?: number;
  fontSize?: number;
  collapsed?: boolean;
  maxOutputLines?: number;
}> = ({ cell, index, total, focusFrame, typingFrame, outputFrame, animationMode = "char", sourceFade = false, inlineOutputVisible = true, highlightRanges, highlightFocusRanges, highlightIntensity = 1, arrowHighlight, arrowIntensity = 0, scale: s = 1, fontSize = 16, collapsed = false, maxOutputLines = 10 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hasFocused = focusFrame >= 0;
  // Typing starts after scroll settles (typingFrame), not when focus begins (focusFrame)
  const typeStart = typingFrame ?? focusFrame;
  const lines = cell.source.split("\n");
  const totalChars = cell.source.length;
  const tokenizedLines = useTokenizedSource(cell.source);
  const highlighted = parseHighlightRanges(highlightRanges);
  const focusedHighlights = parseHighlightRanges(highlightFocusRanges);
  const dimOthers = focusedHighlights.length > 0;

  // Build typing schedule once (deterministic, memoized by source)
  const typingSchedule = useMemo(
    () => buildTypingSchedule(cell.source, fps),
    [cell.source, fps],
  );

  // Helper: given a character count, split source into revealed lines
  const splitAtChar = (revealedChars: number) => {
    let charCount = 0;
    const revealed = lines.map((line) => {
      const lineStart = charCount;
      charCount += line.length + 1;
      const visibleEnd = Math.max(0, revealedChars - lineStart);
      return line.slice(0, Math.min(line.length, visibleEnd));
    });
    const visible = revealed.filter(
      (_, i) => i === 0 || revealedChars > lines.slice(0, i).join("\n").length + 1,
    ).length;
    return { revealed, visible };
  };

  // Compute visible source based on animation mode
  let revealedLines: string[];
  let visibleLineCount: number;
  let showCursor = false;

  if (!hasFocused) {
    revealedLines = [""];
    visibleLineCount = 1;
  } else if (animationMode === "present" || animationMode === "block") {
    const visible = animationMode === "present" || frame >= typeStart;
    revealedLines = visible ? lines : [""];
    visibleLineCount = visible ? lines.length : 1;
  } else if (animationMode === "line") {
    const linesPerSecond = 6.67;
    const framesElapsed = Math.max(0, frame - typeStart);
    const revealedCount = Math.min(lines.length, Math.floor((framesElapsed / fps) * linesPerSecond) + 1);
    revealedLines = lines.map((line, i) => (i < revealedCount ? line : ""));
    visibleLineCount = revealedCount;
    showCursor = revealedCount < lines.length;
  } else if (animationMode === "word") {
    const wordsPerSecond = 8;
    const framesElapsed = Math.max(0, frame - typeStart);
    const revealedWordCount = Math.floor((framesElapsed / fps) * wordsPerSecond);

    const words = cell.source.match(/\S+/g) || [];
    const totalWords = words.length;

    if (revealedWordCount >= totalWords) {
      revealedLines = lines;
      visibleLineCount = lines.length;
    } else {
      let revealedChars = 0;
      const wordMatches = [...cell.source.matchAll(/\S+/g)];
      if (revealedWordCount > 0 && wordMatches[revealedWordCount - 1]) {
        const lastWord = wordMatches[revealedWordCount - 1]!;
        revealedChars = lastWord.index! + lastWord[0].length;
      }
      const split = splitAtChar(revealedChars);
      revealedLines = split.revealed;
      visibleLineCount = split.visible;
      showCursor = true;
    }
  } else {
    // char by char with natural typing rhythm
    const framesElapsed = Math.max(0, frame - typeStart);
    // Binary search the schedule to find how many chars are revealed at this frame
    let lo = 0, hi = typingSchedule.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (typingSchedule[mid]! <= framesElapsed) lo = mid + 1;
      else hi = mid;
    }
    const revealedChars = Math.min(totalChars, lo);

    const split = splitAtChar(revealedChars);
    revealedLines = split.revealed;
    visibleLineCount = split.visible;
    showCursor = revealedChars < totalChars;
  }

  // Blinking cursor (530ms period — matches typical terminal cursor)
  const cursorVisible = showCursor && (Math.floor(frame / (fps * 0.53)) % 2 === 0);

  // Running indicator with spinner
  const isTypingDone = !showCursor && hasFocused;
  const showRunning = cell.running && isTypingDone;
  const spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinnerIdx = showRunning ? Math.floor((frame * 12) / fps) % spinnerChars.length : 0;
  const spinnerChar = spinnerChars[spinnerIdx];

  // Output entrance: single spring for all outputs at once
  const outputVisible = inlineOutputVisible && cell.outputs.length > 0 && outputFrame !== null && frame >= outputFrame;
  const outputEntrance = outputVisible
    ? spring({ frame, fps, delay: outputFrame!, config: { damping: 200 } })
    : 0;
  const outputOpacity = interpolate(outputEntrance, [0, 1], [0, 1]);
  const outputTranslateY = interpolate(outputEntrance, [0, 1], [8, 0]);
  const sourceFadeProgress =
    sourceFade && hasFocused
      ? spring({ frame, fps, delay: typeStart, config: { damping: 200 } })
      : 1;
  const sourceOpacity = sourceFade ? interpolate(sourceFadeProgress, [0, 1], [0, 1]) : 1;
  const sourceTranslateY = sourceFade ? interpolate(sourceFadeProgress, [0, 1], [10, 0]) : 0;

  // --- Collapsed view: compact single-line summary ---
  if (collapsed) {
    const firstLine = lines[0] || "";
    const lineCount = lines.length;
    const collapsedTokens = (tokenizedLines[0] || []);
    const outputVisible = inlineOutputVisible && cell.outputs.length > 0 && outputFrame !== null && frame >= outputFrame;
    const outputEntrance = outputVisible
      ? spring({ frame, fps, delay: outputFrame!, config: { damping: 200 } })
      : 0;
    const outputOpacity = interpolate(outputEntrance, [0, 1], [0, 1]);
    const outputTranslateY = interpolate(outputEntrance, [0, 1], [8, 0]);

    return (
      <div style={{ marginBottom: 10 * s, opacity: 0.85 }}>
        <div
          style={{
            border: `${2 * s}px solid ${monokai.border}`,
            borderRadius: 8 * s,
            background: monokai.panel,
            padding: `${8 * s}px ${16 * s}px`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 * s }}>
            <span style={{ color: monokai.muted, fontSize: (fontSize - 1) * s, flexShrink: 0 }}>
              In [{cell.executionCount ?? " "}]:
            </span>
            <span
              style={{
                flex: 1,
                fontSize: (fontSize + 1) * s,
                lineHeight: `${Math.round(fontSize * 1.625) * s}px`,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <SyntaxLine tokens={collapsedTokens} />
            </span>
            {lineCount > 1 && (
              <span style={{ color: monokai.muted, fontSize: (fontSize - 2) * s, flexShrink: 0 }}>
                +{lineCount - 1} lines
              </span>
            )}
          </div>
        </div>

        {outputVisible ? (
          <div
            style={{
              marginTop: 8 * s,
              marginLeft: 18 * s,
              paddingLeft: 12 * s,
              borderLeft: `${2 * s}px solid ${monokai.border}`,
              opacity: outputOpacity,
              transform: `translateY(${outputTranslateY}px)`,
            }}
          >
            <div style={{ color: monokai.muted, fontSize: (fontSize - 4) * s, marginBottom: 4 * s }}>
              Out [{cell.executionCount ?? " "}]:
            </div>
            {cell.outputs.map((output, i) => (
              <CellOutput key={i} output={output} scale={s} fontSize={fontSize} maxOutputLines={maxOutputLines} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      style={{
        border: `${2 * s}px solid ${showRunning ? monokai.warning : cell.focused ? monokai.borderActive : monokai.border}`,
        borderRadius: 8 * s,
        background: cell.focused ? monokai.panelAlt : monokai.panel,
        boxShadow: showRunning ? `0 0 ${12 * s}px ${monokai.warning}40` : "none",
        padding: `${12 * s}px ${16 * s}px`,
        marginBottom: 10 * s,
        transition: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8 * s,
        }}
      >
        <span style={{ color: showRunning ? monokai.warning : cell.focused ? monokai.accent : monokai.muted, fontSize: (fontSize - 1) * s }}>
          In [{showRunning ? spinnerChar : (cell.executionCount ?? " ")}]:
        </span>
        <span style={{ color: monokai.muted, fontSize: (fontSize - 1) * s }}>
          cell-{index + 1} [{index + 1}/{total}]
        </span>
      </div>

      {/* Source with line numbers */}
      <div
        style={{
          display: "flex",
          gap: 12 * s,
          opacity: sourceOpacity,
          transform: `translateY(${sourceTranslateY}px)`,
        }}
      >
        <div
          style={{
            color: monokai.muted,
            textAlign: "right",
            minWidth: 24 * s,
            userSelect: "none",
            fontSize: (fontSize + 1) * s,
            lineHeight: `${Math.round(fontSize * 1.625) * s}px`,
          }}
        >
          {revealedLines.slice(0, visibleLineCount).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div style={{ flex: 1, fontSize: (fontSize + 1) * s, lineHeight: `${Math.round(fontSize * 1.625) * s}px`, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {revealedLines.slice(0, visibleLineCount).map((line, i) => {
            // Clip tokenized tokens to match the revealed character count for this line
            const fullTokens = tokenizedLines[i] || [];
            let remaining = line.length;
            const clippedTokens: { text: string; color: string }[] = [];
            for (const tok of fullTokens) {
              if (remaining <= 0) break;
              if (tok.text.length <= remaining) {
                clippedTokens.push(tok);
                remaining -= tok.text.length;
              } else {
                clippedTokens.push({ text: tok.text.slice(0, remaining), color: tok.color });
                remaining = 0;
              }
            }

            // Compute arrow text-span highlight for this line
            const arrowLineMatch = arrowHighlight && i + 1 === arrowHighlight.line && arrowIntensity > 0;
            const arrowSpanStart = arrowLineMatch && arrowHighlight ? line.indexOf(arrowHighlight.text) : -1;
            const arrowSpanEnd = arrowSpanStart >= 0 ? arrowSpanStart + arrowHighlight!.text.length : -1;

            return (
            <div key={i}>
              <div
                style={{
                  padding: `0 ${6 * s}px`,
                  marginBottom: 2 * s,
                  borderRadius: 6 * s,
                  background:
                    lineInRanges(i + 1, highlighted) || lineInRanges(i + 1, focusedHighlights)
                      ? `rgba(102, 217, 239, ${0.12 * highlightIntensity})`
                      : "transparent",
                  opacity: dimOthers && !lineInRanges(i + 1, focusedHighlights) ? 1 - 0.68 * highlightIntensity : 1,
                  borderLeft:
                    lineInRanges(i + 1, focusedHighlights)
                      ? `${3 * s}px solid rgba(166, 226, 46, ${highlightIntensity})`
                      : `${3 * s}px solid transparent`,
                  borderBottom: arrowSpanStart >= 0
                    ? `${2 * s}px solid rgba(166, 226, 46, ${arrowIntensity})`
                    : undefined,
                }}
              >
                {arrowSpanStart >= 0 ? (
                  <ArrowHighlightLine
                    tokens={clippedTokens}
                    spanStart={arrowSpanStart}
                    spanEnd={arrowSpanEnd}
                    intensity={arrowIntensity}
                    scale={s}
                  />
                ) : (
                  <SyntaxLine tokens={clippedTokens} />
                )}
              </div>
              {cursorVisible && i === visibleLineCount - 1 && (
                <span
                  style={{
                    background: monokai.borderActive,
                    color: "#000",
                    width: 10 * s,
                    height: `${(fontSize + 1) * s}px`,
                    display: "inline-block",
                    verticalAlign: "baseline",
                    marginLeft: 1 * s,
                  }}
                >
                  {"\u00A0"}
                </span>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Outputs — all at once with a single entrance animation */}
      {outputVisible && (
        <div
          style={{
            marginTop: 8 * s,
            paddingLeft: 12 * s,
            borderLeft: `${2 * s}px solid ${monokai.border}`,
            opacity: outputOpacity,
            transform: `translateY(${outputTranslateY}px)`,
          }}
        >
          <div style={{ color: monokai.muted, fontSize: (fontSize - 4) * s, marginBottom: 4 * s }}>
            Out [{cell.executionCount ?? " "}]:
          </div>
          {cell.outputs.map((output, i) => (
            <CellOutput key={i} output={output} scale={s} fontSize={fontSize} maxOutputLines={maxOutputLines} />
          ))}
        </div>
      )}
    </div>
  );
};
