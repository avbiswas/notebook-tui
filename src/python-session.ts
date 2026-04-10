import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecuteResult, NotebookOutput } from "./types";

type SessionRequest = {
  id: string;
  command: "execute";
  code: string;
};

type SessionResponse = ExecuteResult & {
  id: string;
  ok: boolean;
};

type OutputEvent = {
  event: "output";
  id: string;
  output: NotebookOutput;
};

type HelloResponse = {
  event: "hello";
  backend: "bridge" | "ipykernel";
  detail?: string;
};

export type PythonResolution = {
  pythonPath: string;
  provider: "bridge" | "ipykernel";
};

async function isExecutable(path: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([path, "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export async function resolvePython(
  args: { pythonPath?: string; venvPath?: string },
  cwd: string,
): Promise<PythonResolution> {
  const candidates = [
    args.pythonPath,
    args.venvPath ? join(args.venvPath, "bin", "python") : undefined,
    join(cwd, ".venv", "bin", "python"),
    "python3",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return { pythonPath: candidate, provider: "bridge" };
    }
  }

  throw new Error(
    "No usable Python interpreter found. Pass --python /path/to/python or create ./.venv.",
  );
}

export class PythonSession {
  private process: ReturnType<typeof Bun.spawn>;

  private buffer = "";

  private readonly helloPromise: Promise<HelloResponse>;

  private resolveHello!: (hello: HelloResponse) => void;

  private rejectHello!: (error: Error) => void;

  private pending = new Map<
    string,
    {
      resolve: (result: SessionResponse) => void;
      reject: (error: Error) => void;
      onOutput?: (output: NotebookOutput) => void;
    }
  >();

  constructor(private readonly pythonPath: string) {
    const scriptPath = fileURLToPath(new URL("./python/session_bridge.py", import.meta.url));
    this.helloPromise = new Promise<HelloResponse>((resolve, reject) => {
      this.resolveHello = resolve;
      this.rejectHello = reject;
    });
    this.process = Bun.spawn([pythonPath, scriptPath, pythonPath, process.cwd()], {
      cwd: process.cwd(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.readStdout();
    this.readStderr();
  }

  get interpreterPath(): string {
    return this.pythonPath;
  }

  private async readStdout(): Promise<void> {
    if (!this.process.stdout || typeof this.process.stdout === "number") {
      this.rejectHello(new Error("Python session stdout is unavailable."));
      return;
    }

    const reader = this.process.stdout.getReader();
    const decoder = new TextDecoder();
    let seenHello = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      this.buffer += decoder.decode(value, { stream: true });
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const message = JSON.parse(line) as SessionResponse | HelloResponse | OutputEvent;
        if ("event" in message && message.event === "hello") {
          if (!seenHello) {
            seenHello = true;
            this.resolveHello(message as HelloResponse);
          }
          continue;
        }
        if ("event" in message && message.event === "output") {
          const pending = this.pending.get(message.id);
          if (pending?.onOutput) {
            pending.onOutput(message.output);
          }
          continue;
        }
        const response = message as SessionResponse;
        const pending = this.pending.get(response.id);
        if (!pending) {
          continue;
        }
        this.pending.delete(response.id);
        pending.resolve(response);
      }
    }
    if (!seenHello) {
      this.rejectHello(new Error("Python session did not report a backend."));
    }
  }

  private async readStderr() {
    if (!this.process.stderr || typeof this.process.stderr === "number") {
      return;
    }

    const text = await new Response(this.process.stderr).text();
    if (!text.trim()) {
      return;
    }

    this.rejectHello(new Error(text.trim()));
    for (const pending of this.pending.values()) {
      pending.reject(new Error(text.trim()));
    }
    this.pending.clear();
  }

  async execute(code: string, onOutput?: (output: NotebookOutput) => void): Promise<ExecuteResult> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload: SessionRequest = { id, command: "execute", code };
    const promise = new Promise<SessionResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onOutput });
    });
    if (!this.process.stdin || typeof this.process.stdin === "number") {
      throw new Error("Python session stdin is unavailable.");
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    const response = await promise;

    return {
      error: response.error,
      executionCount: response.executionCount,
    };
  }

  async backendInfo(): Promise<HelloResponse> {
    return this.helloPromise;
  }

  async stop() {
    if (this.process.stdin && typeof this.process.stdin !== "number") {
      this.process.stdin.write(
        `${JSON.stringify({ id: "shutdown", command: "shutdown" })}\n`,
      );
    }
    this.process.kill();
    await this.process.exited;
  }
}
