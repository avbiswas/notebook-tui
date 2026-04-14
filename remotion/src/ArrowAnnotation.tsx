import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { monokai } from "./theme";

const ARROW_INTRO_SECONDS = 0.5;
const ARROW_OUTRO_SECONDS = 0.5;

export const ArrowAnnotation: React.FC<{
  text: string;
  targetY: number;
  connectorX: number;
  startFrame: number;
  holdFrames: number;
  endFrame?: number | null;
  scale?: number;
  fontSize?: number;
}> = ({ text, targetY, connectorX, startFrame, holdFrames, endFrame = null, scale: s = 1, fontSize = 16 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const introFrames = Math.round(ARROW_INTRO_SECONDS * fps);
  const outroFrames = Math.round(ARROW_OUTRO_SECONDS * fps);

  // Intro: 0→1 over introFrames, Hold at 1, Outro: 1→0 over outroFrames
  let progress: number;
  if (frame < startFrame) {
    progress = 0;
  } else if (frame < startFrame + introFrames) {
    progress = (frame - startFrame) / introFrames;
  } else if (endFrame !== null && frame >= endFrame) {
    progress = Math.max(0, 1 - (frame - endFrame) / outroFrames);
  } else {
    progress = 1;
  }

  const opacity = progress;
  const translateX = interpolate(progress, [0, 1], [24 * s, 0]);
  const cardScale = interpolate(progress, [0, 1], [0.95, 1]);

  if (opacity <= 0.001) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: targetY,
        left: connectorX,
        display: "flex",
        alignItems: "center",
        opacity,
        transform: `translateX(${translateX}px) translateY(-50%)`,
        pointerEvents: "none",
      }}
    >
      {/* Horizontal connector line */}
      <div
        style={{
          width: 40 * s,
          height: 3 * s,
          background: monokai.borderActive,
          flexShrink: 0,
          borderRadius: 1.5 * s,
        }}
      />
      {/* Dot at the connection point */}
      <div
        style={{
          width: 9 * s,
          height: 9 * s,
          borderRadius: "50%",
          background: monokai.borderActive,
          flexShrink: 0,
          boxShadow: `0 0 ${6 * s}px ${monokai.borderActive}80`,
        }}
      />
      {/* Callout card */}
      <div
        style={{
          marginLeft: 12 * s,
          padding: `${12 * s}px ${18 * s}px`,
          borderRadius: 12 * s,
          background: "rgba(18, 18, 18, 0.95)",
          border: `${2 * s}px solid ${monokai.borderActive}`,
          color: monokai.text,
          fontSize: (fontSize + 2) * s,
          lineHeight: `${Math.round((fontSize + 2) * 1.35) * s}px`,
          maxWidth: 360 * s,
          transform: `scale(${cardScale})`,
          boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 ${12 * s}px ${monokai.borderActive}30`,
        }}
      >
        {text}
      </div>
    </div>
  );
};