import {
  createNotebookCellRuntime,
  executionCompleteEvent,
  reduceNotebookCellRuntime,
  type NotebookCellEvent,
} from "./output-model";
import { stripNtuiCommands } from "./ntui-commands";
import type { PythonSession } from "./python-session";
import type { NotebookOutput } from "./types";

export type ExecutedNotebookCell = {
  executionCount: number;
  outputs: NotebookOutput[];
  error: string | null;
};

export async function executeNotebookCell(
  session: PythonSession,
  source: string,
  onEvent?: (event: NotebookCellEvent) => void,
): Promise<ExecutedNotebookCell> {
  let runtime = createNotebookCellRuntime();
  const result = await session.execute(stripNtuiCommands(source), (output) => {
    const event: NotebookCellEvent = { type: "output", output };
    runtime = reduceNotebookCellRuntime(runtime, event);
    onEvent?.(event);
  });
  const completeEvent = executionCompleteEvent(result);
  runtime = reduceNotebookCellRuntime(runtime, completeEvent);
  onEvent?.(completeEvent);
  return {
    executionCount: runtime.executionCount ?? result.executionCount,
    outputs: runtime.outputs,
    error: runtime.error,
  };
}
