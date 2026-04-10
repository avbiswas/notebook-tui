import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import {
  NotebookComposition,
  getNotebookDuration,
  type NotebookProps,
} from "./NotebookComposition";
import type { Timeline, AnimationMode } from "./types";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

const calculateMetadata: CalculateMetadataFunction<NotebookProps> = async ({
  props,
}) => {
  const duration = getNotebookDuration(props.timeline, FPS, props.animationMode);
  return { durationInFrames: Math.max(FPS, duration) };
};

// Default timeline for studio preview — will be overridden by CLI --props
const defaultTimeline: Timeline = {
  cells: [{ source: 'print("hello")', kind: "code" }],
  events: [
    { type: "clear", ts: 0 },
    { type: "focus", ts: 0, cellIndex: 0 },
    { type: "source", ts: 0, cellIndex: 0, source: 'print("hello")' },
    {
      type: "output",
      ts: 500,
      cellIndex: 0,
      output: { kind: "stream", text: "hello\n" },
    },
    {
      type: "complete",
      ts: 600,
      cellIndex: 0,
      executionCount: 1,
      error: null,
    },
    { type: "done", ts: 1000 },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="NotebookRender"
      component={NotebookComposition}
      durationInFrames={FPS * 10}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ timeline: defaultTimeline, animationMode: "char" } satisfies NotebookProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
