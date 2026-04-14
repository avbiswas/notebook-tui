import type { NtuiCommandMap } from "../../src/ntui-commands";
import type { CellState, Timeline } from "./types";

export type HighlightRange = {
  start: number;
  end: number;
};

export type PreviewTargetKind = "source" | "output";

export type PreviewTargetRef = {
  cellIndex: number;
  kind: PreviewTargetKind;
};

export type PreviewLayout = "center" | "columns" | "rows" | "grid" | "main_rail";

function parseLineNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function parseHighlightRanges(value: string | undefined): HighlightRange[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      if (!part) {
        return [];
      }
      const [rawStart, rawEnd] = part.split("-", 2);
      const start = parseLineNumber(rawStart ?? "");
      const end = parseLineNumber(rawEnd ?? rawStart ?? "");
      if (start === null || end === null) {
        return [];
      }
      return [{ start: Math.min(start, end), end: Math.max(start, end) }];
    });
}

export function lineInRanges(lineNumber: number, ranges: HighlightRange[]): boolean {
  return ranges.some((range) => lineNumber >= range.start && lineNumber <= range.end);
}

function getCellSymbolicId(cell: Timeline["cells"][number]): string | null {
  const id = cell.commands?.id?.trim();
  return id ? id : null;
}

function resolveCellIndexByBaseRef(
  timeline: Timeline,
  currentCellIndex: number,
  ref: string,
): number | null {
  if (ref === "@") {
    return currentCellIndex;
  }

  if (/^\d+$/.test(ref)) {
    const asIndex = Number.parseInt(ref, 10) - 1;
    return asIndex >= 0 && asIndex < timeline.cells.length ? asIndex : null;
  }

  for (let index = 0; index < timeline.cells.length; index += 1) {
    if (getCellSymbolicId(timeline.cells[index]!) === ref) {
      return index;
    }
  }

  return null;
}

export function resolvePreviewTargets(
  timeline: Timeline,
  currentCellIndex: number,
  commands: NtuiCommandMap | undefined,
): PreviewTargetRef[] {
  const preview = commands?.preview?.trim();
  const targets: PreviewTargetRef[] = [];

  const pushRef = (cellIndex: number | null, kind: PreviewTargetKind) => {
    if (cellIndex === null) {
      return;
    }
    if (targets.some((target) => target.cellIndex === cellIndex && target.kind === kind)) {
      return;
    }
    targets.push({ cellIndex, kind });
  };

  if (preview) {
    for (const rawToken of preview.split(",")) {
      const token = rawToken.trim();
      if (!token) {
        continue;
      }
      if (token === "@o") {
        pushRef(currentCellIndex, "output");
        continue;
      }
      if (token.endsWith("o")) {
        pushRef(resolveCellIndexByBaseRef(timeline, currentCellIndex, token.slice(0, -1)), "output");
        continue;
      }
      pushRef(resolveCellIndexByBaseRef(timeline, currentCellIndex, token), "source");
    }
  }

  if (targets.length === 0 && commands?.source === "preview") {
    pushRef(currentCellIndex, "source");
  }

  if (targets.length === 0 && commands?.output === "preview") {
    pushRef(currentCellIndex, "output");
  }

  return targets;
}

export function getPreviewLayout(commands: NtuiCommandMap | undefined, targetCount: number): PreviewLayout {
  const requested = commands?.preview_layout;
  if (requested === "center" || requested === "columns" || requested === "rows" || requested === "grid" || requested === "main_rail") {
    return requested;
  }
  if (targetCount <= 1) {
    return "center";
  }
  if (targetCount === 2) {
    return "columns";
  }
  return "grid";
}

export function getCellLabel(cell: Pick<CellState, "commands">): string | null {
  return cell.commands?.label ?? cell.commands?.chapter ?? null;
}

export type ArrowInfo = {
  line: number;
  highlightText?: string;
  text: string;
};

export function parseArrowDirective(value: string | undefined): ArrowInfo | null {
  if (!value) return null;

  // New syntax: LINE|HIGHLIGHT_TEXT:"Annotation"
  // e.g. "3|lr:"The learning rate"" → { line: 3, highlightText: "lr", text: "The learning rate" }
  // Old syntax: LINE:"Annotation"
  // e.g. "5:"Key line"" → { line: 5, highlightText: undefined, text: "Key line" }

  const pipeIndex = value.indexOf("|");
  let lineAndRest: string;
  let highlightText: string | undefined;

  if (pipeIndex > 0) {
    // New syntax: LINE|HIGHLIGHT:TEXT
    const linePart = value.slice(0, pipeIndex).trim();
    const rest = value.slice(pipeIndex + 1);
    lineAndRest = linePart;

    // Parse rest as HIGHLIGHT:TEXT
    const colonInRest = rest.indexOf(":");
    if (colonInRest <= 0) return null;
    highlightText = rest.slice(0, colonInRest).trim();
    const annotationText = rest.slice(colonInRest + 1).trim();
    if (!annotationText) return null;

    const line = parseInt(linePart, 10);
    if (!Number.isFinite(line) || line < 1) return null;
    if (!highlightText) return null;
    return { line, highlightText, text: annotationText };
  }

  // Old syntax: LINE:TEXT
  const colonIndex = value.indexOf(":");
  if (colonIndex <= 0) return null;
  const lineStr = value.slice(0, colonIndex).trim();
  const line = parseInt(lineStr, 10);
  if (!Number.isFinite(line) || line < 1) return null;
  const text = value.slice(colonIndex + 1).trim();
  if (!text) return null;
  return { line, text };
}
