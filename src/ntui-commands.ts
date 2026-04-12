export type NtuiCommandMap = Record<string, string>;

export type ParsedNtuiCommands = {
  commands: NtuiCommandMap;
  commandLines: string[];
  hiddenDirectiveCount: number;
  bodySource: string;
};

function tokenizeCommandPayload(payload: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < payload.length; index += 1) {
    const ch = payload[index]!;

    if (quote) {
      if (ch === "\\") {
        const next = payload[index + 1];
        if (next) {
          current += next;
          index += 1;
          continue;
        }
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseCommandPayload(payload: string): NtuiCommandMap {
  const commands: NtuiCommandMap = {};

  for (const token of tokenizeCommandPayload(payload)) {
    const eqIndex = token.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = token.slice(0, eqIndex).trim();
    const value = token.slice(eqIndex + 1).trim();
    if (!key || !value) {
      continue;
    }
    commands[key] = value;
  }

  return commands;
}

export function parseNtuiCommands(source: string): ParsedNtuiCommands {
  const lines = source.split("\n");
  const commandLines: string[] = [];
  const visibleLines: string[] = [];
  const commands: NtuiCommandMap = {};
  let scanningPreamble = true;

  for (const line of lines) {
    const trimmed = line.trim();

    if (scanningPreamble) {
      const match = line.match(/^\s*#\s*ntui:\s*(.*)$/);
      if (match) {
        commandLines.push(line);
        Object.assign(commands, parseCommandPayload(match[1] ?? ""));
        continue;
      }

      if (trimmed === "" || /^\s*#/.test(line)) {
        visibleLines.push(line);
        continue;
      }

      scanningPreamble = false;
    }

    visibleLines.push(line);
  }

  return {
    commands,
    commandLines,
    hiddenDirectiveCount: commandLines.length,
    bodySource: visibleLines.join("\n"),
  };
}

export function stripNtuiCommands(source: string): string {
  return parseNtuiCommands(source).bodySource;
}
