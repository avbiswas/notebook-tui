import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { monokai } from "./theme";

const ANIM_INTRO_SECONDS = 0.5;
const ANIM_OUTRO_SECONDS = 0.5;

export const LabelBanner: React.FC<{
  text: string;
  startFrame: number;
  endFrame?: number | null;
  scale?: number;
}> = ({ text, startFrame, endFrame = null, scale: s = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const introFrames = Math.round(ANIM_INTRO_SECONDS * fps);
  const outroFrames = Math.round(ANIM_OUTRO_SECONDS * fps);

  let progress: number;
  if (frame < startFrame) {
    progress = 0;
  } else if (frame < startFrame + introFrames) {
    progress = (frame - startFrame) / Math.max(1, introFrames);
  } else if (endFrame !== null && frame >= endFrame) {
    progress = Math.max(0, 1 - (frame - endFrame) / Math.max(1, outroFrames));
  } else {
    progress = 1;
  }

  const opacity = progress;
  const translateY = interpolate(progress, [0, 1], [-20 * s, 0]);

  return (
    <div
      style={{
        position: "absolute",
        top: 42 * s,
        left: 24 * s,
        padding: `${12 * s}px ${20 * s}px`,
        borderRadius: 14 * s,
        background: "rgba(15, 15, 15, 0.92)",
        border: `${1.5 * s}px solid ${monokai.borderActive}`,
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.3)",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          color: monokai.text,
          fontSize: 26 * s,
          fontWeight: 700,
          letterSpacing: 0.3 * s,
        }}
      >
        {text}
      </div>
    </div>
  );
};