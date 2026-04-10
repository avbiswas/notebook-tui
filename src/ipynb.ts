import { createCell } from "./notebook-state";
import { appendOutputText } from "./output-model";
import type { NotebookDocument, NotebookOutput } from "./types";

type IpynbOutput =
  | {
      output_type: "stream";
      name?: "stdout" | "stderr";
      text?: string | string[];
    }
  | {
      output_type: "execute_result";
      execution_count?: number | null;
      data?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  | {
      output_type: "display_data";
      data?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  | {
      output_type: "error";
      ename?: string;
      evalue?: string;
      traceback?: string[];
    };

type IpynbCell = {
  cell_type: "code" | "markdown" | string;
  metadata?: Record<string, unknown>;
  source?: string | string[];
  execution_count?: number | null;
  outputs?: IpynbOutput[];
};

type IpynbNotebook = {
  nbformat: number;
  nbformat_minor: number;
  metadata?: Record<string, unknown>;
  cells: IpynbCell[];
};

function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join("");
  }
  return value ?? "";
}

function normalizeOutput(output: IpynbOutput): NotebookOutput[] {
  switch (output.output_type) {
    case "stream":
      return appendOutputText([], {
        kind: output.name === "stderr" ? "error" : "stream",
        text: asString(output.text),
      });
    case "execute_result":
    case "display_data": {
      const data = output.data ?? {};
      const png = typeof data["image/png"] === "string" ? data["image/png"] : null;
      if (png) {
        return [
          {
            kind: "image",
            mimeType: "image/png",
            data: png,
            width: 0,
            height: 0,
            alt:
              (typeof data["text/plain"] === "string" && data["text/plain"]) ||
              "image/png output",
            preview: null,
          },
        ];
      }
      const jpeg = typeof data["image/jpeg"] === "string" ? data["image/jpeg"] : null;
      if (jpeg) {
        return [
          {
            kind: "image",
            mimeType: "image/jpeg",
            data: jpeg,
            width: 0,
            height: 0,
            alt:
              (typeof data["text/plain"] === "string" && data["text/plain"]) ||
              "image/jpeg output",
            preview: null,
          },
        ];
      }
      const text =
        (typeof data["text/plain"] === "string" && data["text/plain"]) ||
        (typeof data["text/markdown"] === "string" && data["text/markdown"]) ||
        "";
      return text ? [{ kind: "result", text }] : [];
    }
    case "error": {
      const traceback = output.traceback?.join("\n");
      const text = traceback || output.evalue || output.ename || "Execution error";
      return [{ kind: "error", text }];
    }
    default:
      return [];
  }
}

function serializeOutput(output: NotebookOutput, executionCount: number | null): IpynbOutput {
  switch (output.kind) {
    case "stream":
      return {
        output_type: "stream",
        name: "stdout",
        text: output.text,
      };
    case "result":
      return {
        output_type: "execute_result",
        execution_count: executionCount,
        data: { "text/plain": output.text },
        metadata: {},
      };
    case "error":
      return {
        output_type: "error",
        ename: "Error",
        evalue: output.text.split("\n")[0] ?? "Error",
        traceback: output.text.split("\n"),
      };
    case "image":
      return {
        output_type: "display_data",
        data: {
          [output.mimeType]: output.data,
          "text/plain": output.alt,
        },
        metadata: {},
      };
  }
}

export function deserializeIpynb(text: string): NotebookDocument {
  const notebook = JSON.parse(text) as IpynbNotebook;
  const parsedCells = notebook.cells
    .filter((cell) => cell.cell_type === "code" || cell.cell_type === "markdown")
    .map((cell, index) => {
      const kind = cell.cell_type === "markdown" ? "markdown" : "code";
      const outputs = kind === "code"
        ? (cell.outputs ?? []).flatMap((output) => normalizeOutput(output))
        : [];
      return {
        ...createCell(`cell-${index + 1}`, asString(cell.source), kind as "code" | "markdown"),
        executionCount: kind === "code" ? (cell.execution_count ?? null) : null,
        outputs,
      };
    });

  const cells =
    parsedCells.length > 0
      ? parsedCells
      : [createCell("cell-1", "")];

  const executionCounter = Math.max(
    0,
    ...cells.map((cell) => cell.executionCount ?? 0),
  );

  return {
    cells,
    clipboard: null,
    nextCellId: cells.length + 1,
    executionCounter,
  };
}

export function serializeIpynb(document: NotebookDocument): string {
  const notebook: IpynbNotebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        file_extension: ".py",
        mimetype: "text/x-python",
        pygments_lexer: "ipython3",
      },
    },
    cells: document.cells.map((cell) => ({
      cell_type: cell.kind,
      metadata: {},
      source: cell.source,
      ...(cell.kind === "code"
        ? {
            execution_count: cell.executionCount,
            outputs: cell.outputs.map((output) => serializeOutput(output, cell.executionCount)),
          }
        : {}),
    })),
  };

  return JSON.stringify(notebook, null, 2);
}
