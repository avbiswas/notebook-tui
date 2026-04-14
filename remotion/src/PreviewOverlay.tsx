import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { monokai } from "./theme";

const ANIM_INTRO_SECONDS = 0.5;
const ANIM_OUTRO_SECONDS = 0.5;

export const PreviewOverlay: React.FC<{
  visible: boolean;
  startFrame: number;
  endFrame?: number | null;
  exitDurationFrames?: number;
  scale?: number;
  title: string;
  subtitle?: string;
  callout?: string;
  children: React.ReactNode;
}> = ({ visible, startFrame, endFrame = null, exitDurationFrames = 15, scale: s = 1, title, subtitle, callout, children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const introFrames = Math.round(ANIM_INTRO_SECONDS * fps);
  const outroFrames = exitDurationFrames;

  // Compute progress: 0→1 during intro, hold at 1, 1→0 during outro
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

  const backdropOpacity = progress;
  const cardOpacity = progress;
  const cardScaleIn = interpolate(progress, [0, 1], [0.94, 1]);
  const cardTranslateY =
    interpolate(progress, [0, 1], [22 * s, 0]);

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
          transform: `translateY(${cardTranslateY}px) scale(${cardScaleIn})`,
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
        {callout ? (
          <div
            style={{
              marginTop: 14 * s,
              padding: `${10 * s}px ${12 * s}px`,
              borderRadius: 10 * s,
              background: "rgba(38, 38, 38, 0.95)",
              border: `${1 * s}px solid ${monokai.border}`,
              color: monokai.text,
              fontSize: 15 * s,
            }}
          >
            {callout}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};