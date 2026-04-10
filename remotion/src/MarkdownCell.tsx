import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { marked } from "marked";
import { monokai } from "./theme";

marked.setOptions({ async: false });

function buildMarkdownStyles(s: number) {
  return `
  .md-cell h1 { font-size: ${26 * s}px; font-weight: 700; margin: 0 0 ${8 * s}px 0; color: ${monokai.text}; }
  .md-cell h2 { font-size: ${21 * s}px; font-weight: 700; margin: 0 0 ${6 * s}px 0; color: ${monokai.text}; }
  .md-cell h3 { font-size: ${17 * s}px; font-weight: 600; margin: 0 0 ${5 * s}px 0; color: ${monokai.text}; }
  .md-cell h4, .md-cell h5, .md-cell h6 { font-size: ${15 * s}px; font-weight: 600; margin: 0 0 ${4 * s}px 0; color: ${monokai.text}; }
  .md-cell p { margin: 0 0 ${8 * s}px 0; line-height: 1.5; }
  .md-cell p:last-child { margin-bottom: 0; }
  .md-cell ul, .md-cell ol { margin: 0 0 ${8 * s}px 0; padding-left: ${20 * s}px; }
  .md-cell li { margin-bottom: ${2 * s}px; line-height: 1.4; }
  .md-cell code {
    background: #1a1a1a;
    border: ${1 * s}px solid #333;
    border-radius: ${3 * s}px;
    padding: ${1 * s}px ${4 * s}px;
    font-family: "JetBrains Mono", monospace;
    font-size: ${13 * s}px;
    color: ${monokai.string};
  }
  .md-cell pre {
    background: #1a1a1a;
    border: ${1 * s}px solid #333;
    border-radius: ${4 * s}px;
    padding: ${8 * s}px ${10 * s}px;
    margin: 0 0 ${8 * s}px 0;
    overflow-x: auto;
  }
  .md-cell pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: ${13 * s}px;
    color: ${monokai.text};
  }
  .md-cell blockquote {
    border-left: ${2 * s}px solid #555;
    margin: 0 0 ${8 * s}px 0;
    padding: ${2 * s}px ${10 * s}px;
    color: ${monokai.muted};
  }
  .md-cell strong { font-weight: 700; }
  .md-cell em { font-style: italic; color: ${monokai.muted}; }
  .md-cell a { color: ${monokai.accent}; text-decoration: none; }
  .md-cell hr { border: none; border-top: ${1 * s}px solid #333; margin: ${8 * s}px 0; }
  .md-cell table { border-collapse: collapse; margin: 0 0 ${8 * s}px 0; }
  .md-cell th, .md-cell td { border: ${1 * s}px solid #333; padding: ${4 * s}px ${8 * s}px; text-align: left; }
  .md-cell th { background: #1a1a1a; font-weight: 600; }
  .md-cell img { max-width: 100%; border-radius: ${4 * s}px; }
`;
}

export const MarkdownCell: React.FC<{
  source: string;
  focused: boolean;
  focusFrame: number;
  index: number;
  total: number;
  scale?: number;
}> = ({ source, focused, focusFrame, index, total, scale: s = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hasFocused = focusFrame >= 0;

  const html = useMemo(() => {
    return marked.parse(source || "*empty*") as string;
  }, [source]);

  const markdownStyles = useMemo(() => buildMarkdownStyles(s), [s]);

  // Entrance animation: fade + slide up when focused
  const entrance = hasFocused
    ? spring({ frame, fps, delay: focusFrame, config: { damping: 200 } })
    : 0;
  const opacity = interpolate(entrance, [0, 1], [0, 1]);
  const translateY = interpolate(entrance, [0, 1], [12 * s, 0]);

  return (
    <div
      style={{
        border: `${1 * s}px solid ${focused ? "#666" : "#333"}`,
        borderRadius: 6 * s,
        background: "#000000",
        padding: `${6 * s}px ${12 * s}px`,
        marginBottom: 10 * s,
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: markdownStyles }} />
      <div
        className="md-cell"
        style={{
          color: monokai.text,
          fontSize: 14 * s,
          lineHeight: `${20 * s}px`,
          fontFamily: '"Inter", "Helvetica Neue", sans-serif',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};
