import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { monokai } from "./theme";

export const PreviewOverlay: React.FC<{
  visible: boolean;
  startFrame: number;
  endFrame?: number | null;
  exitDurationFrames?: number;
  scale?: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ visible, startFrame, endFrame = null, exitDurationFrames = 12, scale: s = 1, title, subtitle, children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const entrance = visible
    ? spring({ frame, fps, delay: startFrame, config: { damping: 200 } })
    : 0;
  const exiting = endFrame !== null && frame >= endFrame;
  const exitProgress = exiting
    ? spring({ frame, fps, delay: endFrame, durationInFrames: exitDurationFrames, config: { damping: 200 } })
    : 0;
  const backdropOpacity = interpolate(entrance, [0, 1], [0, 1]) * interpolate(exitProgress, [0, 1], [1, 0]);
  const cardOpacity = interpolate(entrance, [0, 1], [0, 1]) * interpolate(exitProgress, [0, 1], [1, 0]);
  const cardScaleIn = interpolate(entrance, [0, 1], [0.94, 1]);
  const cardScaleOut = interpolate(exitProgress, [0, 1], [1, 0.96]);
  const cardScale = cardScaleIn * cardScaleOut;
  const cardTranslateY =
    interpolate(entrance, [0, 1], [22 * s, 0]) + interpolate(exitProgress, [0, 1], [0, 18 * s]);

  if (!visible || cardOpacity <= 0.001) {
    return null;
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(8, 8, 8, 0.55)",
          backdropFilter: `blur(${14 * s}px)`,
          opacity: backdropOpacity,
        }}
      />

      <div
        style={{
          width: Math.min(width * 0.84, 1200 * s),
          maxHeight: height * 0.78,
          border: `${2 * s}px solid ${monokai.borderActive}`,
          borderRadius: 18 * s,
          background: "rgba(20, 20, 20, 0.96)",
          boxShadow: `0 26px 90px rgba(0, 0, 0, 0.5)`,
          padding: `${18 * s}px ${22 * s}px`,
          opacity: cardOpacity,
          transform: `translateY(${cardTranslateY}px) scale(${cardScale})`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16 * s,
            marginBottom: 14 * s,
          }}
        >
          <div>
            <div
              style={{
                color: monokai.borderActive,
                fontSize: 13 * s,
                textTransform: "uppercase",
                letterSpacing: 1.2 * s,
                marginBottom: 4 * s,
              }}
            >
              Preview
            </div>
            <div style={{ color: monokai.text, fontSize: 22 * s, fontWeight: 700 }}>
              {title}
            </div>
          </div>
          {subtitle ? (
            <div style={{ color: monokai.muted, fontSize: 14 * s }}>
              {subtitle}
            </div>
          ) : null}
        </div>

        <div
          style={{
            maxHeight: height * 0.65,
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};
