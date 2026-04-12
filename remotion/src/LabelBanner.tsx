import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { monokai } from "./theme";

export const LabelBanner: React.FC<{
  text: string;
  startFrame: number;
  scale?: number;
}> = ({ text, startFrame, scale: s = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, delay: startFrame, config: { damping: 200 } });
  const opacity = interpolate(entrance, [0, 1], [0, 1]);
  const translateY = interpolate(entrance, [0, 1], [-20 * s, 0]);

  return (
    <div
      style={{
        position: "absolute",
        top: 42 * s,
        left: 24 * s,
        padding: `${8 * s}px ${14 * s}px`,
        borderRadius: 12 * s,
        background: "rgba(15, 15, 15, 0.9)",
        border: `${1 * s}px solid ${monokai.borderActive}`,
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          color: monokai.text,
          fontSize: 18 * s,
          fontWeight: 700,
        }}
      >
        {text}
      </div>
    </div>
  );
};
