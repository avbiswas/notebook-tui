import type { ExecuteResult, NotebookOutput } from "./types";

export type NotebookCellEvent =
  | { type: "output"; output: NotebookOutput }
  | { type: "complete"; executionCount: number; error: string | null };

export type NotebookCellRuntime = {
  outputs: NotebookOutput[];
  executionCount: number | null;
  error: string | null;
};

function findLineStart(chars: string[], cursor: number): number {
  for (let index = Math.min(cursor - 1, chars.length - 1); index >= 0; index -= 1) {
    if (chars[index] === "\n") {
      return index + 1;
    }
  }
  return 0;
}

function clearLineFromCursor(chars: string[], cursor: number): string[] {
  let end = cursor;
  while (end < chars.length && chars[end] !== "\n") {
    end += 1;
  }
  chars.splice(cursor, end - cursor);
  return chars;
}

export function getDisplayText(raw: string): string {
  const chars: string[] = [];
  let cursor = 0;
  let lineWasRewritten = false;

  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index]!;

    if (ch === "\x1b") {
      const match = raw.slice(index).match(/^\x1b\[[0-9;?]*([ -/]*)([@-~])/);
      if (match) {
        const command = match[2];
        if (command === "K") {
          clearLineFromCursor(chars, cursor);
        }
        index += match[0].length - 1;
      }
      continue;
    }
    if (ch === "\r") {
      cursor = findLineStart(chars, cursor);
      lineWasRewritten = true;
      continue;
    }
    if (ch === "\b") {
      if (cursor > 0) {
        chars.splice(cursor - 1, 1);
        cursor -= 1;
      }
      continue;
    }
    if (ch === "\u0007") {
      continue;
    }
    if (ch === "\n") {
      if (lineWasRewritten) {
        clearLineFromCursor(chars, cursor);
      }
      chars.splice(cursor, 0, "\n");
      cursor += 1;
      lineWasRewritten = false;
      continue;
    }

    if (ch === "\x0b" || ch === "\x0c") {
      continue;
    }

    // Common tqdm clear-line sequence after ANSI stripping leaves plain text;
    // preserve current cursor position and replace characters in-place.
    if (cursor < chars.length && chars[cursor] !== "\n") {
      chars[cursor] = ch;
    } else {
      chars.splice(cursor, 0, ch);
    }
    cursor += 1;
  }

  if (lineWasRewritten) {
    clearLineFromCursor(chars, cursor);
  }

  return chars.join("");
}

export function appendOutputText(
  outputs: NotebookOutput[],
  output: Extract<NotebookOutput, { kind: "stream" | "error" | "result" }>,
): NotebookOutput[] {
  const last = outputs.at(-1);
  if (last?.kind === output.kind && (output.kind === "stream" || output.kind === "error")) {
    return [
      ...outputs.slice(0, -1),
      {
        ...last,
        text: last.text + output.text,
      },
    ];
  }

  return [...outputs, output];
}

export function applyNotebookOutput(
  outputs: NotebookOutput[],
  output: NotebookOutput,
): NotebookOutput[] {
  if (output.kind === "stream" || output.kind === "error" || output.kind === "result") {
    return appendOutputText(outputs, output);
  }
  return [...outputs, output];
}

export function reduceNotebookCellRuntime(
  runtime: NotebookCellRuntime,
  event: NotebookCellEvent,
): NotebookCellRuntime {
  if (event.type === "output") {
    return {
      ...runtime,
      outputs: applyNotebookOutput(runtime.outputs, event.output),
    };
  }

  return {
    ...runtime,
    executionCount: event.executionCount,
    error: event.error,
  };
}

export function createNotebookCellRuntime(): NotebookCellRuntime {
  return {
    outputs: [],
    executionCount: null,
    error: null,
  };
}

export function executionCompleteEvent(result: ExecuteResult): NotebookCellEvent {
  return {
    type: "complete",
    executionCount: result.executionCount,
    error: result.error,
  };
}

export function getDisplayLines(text: string): string[] {
  const displayText = getDisplayText(text);

  if (displayText.length === 0) {
    return [""];
  }

  const lines = displayText.split("\n");

  // `print()` commonly leaves a single trailing newline. Keep the raw text in state,
  // but avoid rendering an extra empty terminal row for that final line break.
  if (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }

  return lines.length > 0 ? lines : [""];
}
