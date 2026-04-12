import type { ExecuteResult, NotebookOutput } from "./types";

export type NotebookCellEvent =
  | { type: "output"; output: NotebookOutput }
  | { type: "complete"; executionCount: number; error: string | null };

export type NotebookCellRuntime = {
  outputs: NotebookOutput[];
  executionCount: number | null;
  error: string | null;
};

export type FormattedOutputSegment = {
  text: string;
  kind: "plain" | "key" | "value" | "punctuation";
};

export type FormattedOutputLine = FormattedOutputSegment[];

type ParsedValue =
  | { type: "string"; value: string }
  | { type: "number"; value: string }
  | { type: "boolean"; value: string }
  | { type: "null"; value: string }
  | { type: "identifier"; value: string }
  | { type: "dict"; entries: Array<{ key: ParsedValue; value: ParsedValue }> }
  | { type: "list"; items: ParsedValue[] };

type ParsedScalar = Exclude<ParsedValue, { type: "dict" } | { type: "list" }>;

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

function pushText(
  line: FormattedOutputLine,
  kind: FormattedOutputSegment["kind"],
  text: string,
): void {
  if (text.length === 0) {
    return;
  }
  const last = line.at(-1);
  if (last && last.kind === kind) {
    last.text += text;
    return;
  }
  line.push({ text, kind });
}

function formatScalarValue(value: ParsedScalar, truncateValues: boolean): string {
  let text = value.value;
  if (truncateValues) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length > 10) {
      text = `${words.slice(0, 10).join(" ")} ...`;
    }
  }
  return text;
}

function renderParsedValueInline(
  value: ParsedValue,
  truncateValues: boolean,
): FormattedOutputLine | null {
  if (value.type === "dict" || value.type === "list") {
    return null;
  }
  return [{ text: formatScalarValue(value, truncateValues), kind: "value" }];
}

function formatKey(value: ParsedValue): string {
  if (value.type === "dict" || value.type === "list") {
    return value.type === "dict" ? "{...}" : "[...]";
  }
  return formatScalarValue(value, false);
}

function renderParsedValueMultiline(
  value: ParsedValue,
  indent: number,
  truncateValues: boolean,
): FormattedOutputLine[] {
  if (value.type === "dict") {
    const lines: FormattedOutputLine[] = [[{ text: `${" ".repeat(indent)}{`, kind: "punctuation" }]];
    for (const [index, entry] of value.entries.entries()) {
      const keyText = formatKey(entry.key);
      const inlineValue = renderParsedValueInline(entry.value, truncateValues);
      const prefix: FormattedOutputLine = [];
      pushText(prefix, "plain", `${" ".repeat(indent + 2)}`);
      pushText(prefix, "key", keyText);
      pushText(prefix, "punctuation", ": ");
      if (inlineValue) {
        for (const segment of inlineValue) {
          pushText(prefix, segment.kind, segment.text);
        }
        if (index < value.entries.length - 1) {
          pushText(prefix, "punctuation", ",");
        }
        lines.push(prefix);
        continue;
      }

      if (entry.value.type === "dict") {
        pushText(prefix, "punctuation", "{");
      } else {
        pushText(prefix, "punctuation", "[");
      }
      lines.push(prefix);

      const nestedLines = renderParsedValueMultiline(entry.value, indent + 4, truncateValues);
      for (const nestedLine of nestedLines.slice(1, -1)) {
        lines.push(nestedLine);
      }

      const closing: FormattedOutputLine = [];
      pushText(closing, "plain", `${" ".repeat(indent + 2)}`);
      pushText(closing, "punctuation", entry.value.type === "dict" ? "}" : "]");
      if (index < value.entries.length - 1) {
        pushText(closing, "punctuation", ",");
      }
      lines.push(closing);
    }
    lines.push([{ text: `${" ".repeat(indent)}}`, kind: "punctuation" }]);
    return lines;
  }

  if (value.type !== "list") {
    return [[{ text: formatScalarValue(value, truncateValues), kind: "value" }]];
  }

  const lines: FormattedOutputLine[] = [[{ text: `${" ".repeat(indent)}[`, kind: "punctuation" }]];
  for (const [index, item] of value.items.entries()) {
    const inlineValue = renderParsedValueInline(item, truncateValues);
    if (inlineValue) {
      const line: FormattedOutputLine = [];
      pushText(line, "plain", `${" ".repeat(indent + 2)}`);
      for (const segment of inlineValue) {
        pushText(line, segment.kind, segment.text);
      }
      if (index < value.items.length - 1) {
        pushText(line, "punctuation", ",");
      }
      lines.push(line);
      continue;
    }

    const nestedLines = renderParsedValueMultiline(item, indent + 2, truncateValues);
    nestedLines[nestedLines.length - 1] = [
      ...nestedLines[nestedLines.length - 1]!,
      ...(index < value.items.length - 1 ? [{ text: ",", kind: "punctuation" as const }] : []),
    ];
    lines.push(...nestedLines);
  }
  lines.push([{ text: `${" ".repeat(indent)}]`, kind: "punctuation" }]);
  return lines;
}

function skipWhitespace(input: string, cursor: number): number {
  let next = cursor;
  while (next < input.length && /\s/.test(input[next]!)) {
    next += 1;
  }
  return next;
}

function parseQuotedString(
  input: string,
  cursor: number,
): { value: ParsedValue; cursor: number } | null {
  const quote = input[cursor];
  if (quote !== "'" && quote !== "\"") {
    return null;
  }
  let index = cursor + 1;
  let value = "";
  while (index < input.length) {
    const ch = input[index]!;
    if (ch === "\\") {
      const next = input[index + 1];
      if (!next) {
        return null;
      }
      value += next;
      index += 2;
      continue;
    }
    if (ch === quote) {
      return { value: { type: "string", value }, cursor: index + 1 };
    }
    value += ch;
    index += 1;
  }
  return null;
}

function parseIdentifier(
  input: string,
  cursor: number,
): { value: ParsedValue; cursor: number } | null {
  const match = input.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_\-]*/);
  if (!match) {
    return null;
  }
  const token = match[0];
  if (token === "True" || token === "False") {
    return { value: { type: "boolean", value: token.toLowerCase() }, cursor: cursor + token.length };
  }
  if (token === "None") {
    return { value: { type: "null", value: "null" }, cursor: cursor + token.length };
  }
  return { value: { type: "identifier", value: token }, cursor: cursor + token.length };
}

function parseNumber(
  input: string,
  cursor: number,
): { value: ParsedValue; cursor: number } | null {
  const match = input.slice(cursor).match(/^-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|inf|nan)/);
  if (!match) {
    return null;
  }
  return { value: { type: "number", value: match[0] }, cursor: cursor + match[0].length };
}

function parseValue(
  input: string,
  cursor: number,
): { value: ParsedValue; cursor: number } | null {
  const next = skipWhitespace(input, cursor);
  const ch = input[next];
  if (!ch) {
    return null;
  }
  if (ch === "'" || ch === "\"") {
    return parseQuotedString(input, next);
  }
  if (ch === "{") {
    return parseDict(input, next);
  }
  if (ch === "[") {
    return parseList(input, next);
  }
  return parseNumber(input, next) ?? parseIdentifier(input, next);
}

function parseDict(
  input: string,
  cursor: number,
): { value: ParsedValue; cursor: number } | null {
  if (input[cursor] !== "{") {
    return null;
  }
  let index = cursor + 1;
  const entries: Array<{ key: ParsedValue; value: ParsedValue }> = [];

  while (index < input.length) {
    index = skipWhitespace(input, index);
    if (input[index] === "}") {
      return { value: { type: "dict", entries }, cursor: index + 1 };
    }
    const key = parseValue(input, index);
    if (!key) {
      return null;
    }
    index = skipWhitespace(input, key.cursor);
    if (input[index] !== ":") {
      return null;
    }
    const parsedValue = parseValue(input, index + 1);
    if (!parsedValue) {
      return null;
    }
    entries.push({ key: key.value, value: parsedValue.value });
    index = skipWhitespace(input, parsedValue.cursor);
    if (input[index] === ",") {
      index += 1;
      continue;
    }
    if (input[index] === "}") {
      return { value: { type: "dict", entries }, cursor: index + 1 };
    }
    return null;
  }

  return null;
}

function parseList(
  input: string,
  cursor: number,
): { value: ParsedValue; cursor: number } | null {
  if (input[cursor] !== "[") {
    return null;
  }
  let index = cursor + 1;
  const items: ParsedValue[] = [];

  while (index < input.length) {
    index = skipWhitespace(input, index);
    if (input[index] === "]") {
      return { value: { type: "list", items }, cursor: index + 1 };
    }
    const parsedValue = parseValue(input, index);
    if (!parsedValue) {
      return null;
    }
    items.push(parsedValue.value);
    index = skipWhitespace(input, parsedValue.cursor);
    if (input[index] === ",") {
      index += 1;
      continue;
    }
    if (input[index] === "]") {
      return { value: { type: "list", items }, cursor: index + 1 };
    }
    return null;
  }

  return null;
}

function isStructuredRoot(value: ParsedValue): boolean {
  if (value.type === "dict") {
    return true;
  }
  return value.type === "list" && value.items.length > 0 && value.items.every((item) => item.type === "dict");
}

export function getStructuredResultLines(
  text: string,
  truncateValues: boolean,
): FormattedOutputLine[] | null {
  const displayText = getDisplayText(text).trim();
  if (displayText.length === 0) {
    return null;
  }

  const parsed = parseValue(displayText, 0);
  if (!parsed) {
    return null;
  }
  const end = skipWhitespace(displayText, parsed.cursor);
  if (end !== displayText.length || !isStructuredRoot(parsed.value)) {
    return null;
  }

  return renderParsedValueMultiline(parsed.value, 0, truncateValues);
}
