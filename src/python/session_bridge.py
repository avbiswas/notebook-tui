import ast
import base64
import contextlib
import io
import json
import os
import queue
import sys
import traceback
from dataclasses import dataclass
from math import ceil
from typing import Optional


def write_message(payload: dict) -> None:
    # Use sys.__stdout__ unconditionally so protocol messages bypass any
    # contextlib.redirect_stdout in effect during cell execution. Otherwise
    # an emit_output() during a redirected block would be captured by the
    # stdout wrapper and re-emitted as a stream output containing the JSON
    # event itself (e.g. literal expressions showing their {"event": ...}
    # wrapper instead of the value).
    sys.__stdout__.write(json.dumps(payload) + "\n")
    sys.__stdout__.flush()


def stderr_text(output: dict) -> str:
    traceback_lines = output.get("traceback") or []
    if traceback_lines:
      return "\n".join(traceback_lines)
    return output.get("evalue") or "Kernel execution failed."


@dataclass
class ExecutionReply:
    error: Optional[str]
    execution_count: int
    ok: bool


def emit_output(request_id: str, output: dict) -> None:
    if not request_id:
        return
    write_message({"event": "output", "id": request_id, "output": output})


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def build_image_preview(data: bytes, mime_type: str, alt: str) -> Optional[dict]:
    try:
        from PIL import Image
    except Exception:
        return None

    image = Image.open(io.BytesIO(data)).convert("RGB")
    width, height = image.size

    max_cols = 80
    max_rows = 30
    aspect = height / max(1, width)
    target_cols = max(1, min(max_cols, width))
    target_rows = max(1, min(max_rows, ceil(aspect * target_cols * 0.5)))
    resized = image.resize((target_cols, target_rows * 2), Image.LANCZOS)

    rows: list[list[dict]] = []
    for row_index in range(target_rows):
        spans: list[dict] = []
        current_fg = None
        current_bg = None
        current_text = ""
        upper_y = row_index * 2
        lower_y = min(upper_y + 1, resized.height - 1)
        for x in range(target_cols):
            upper = rgb_to_hex(resized.getpixel((x, upper_y)))
            lower = rgb_to_hex(resized.getpixel((x, lower_y)))
            if current_fg == upper and current_bg == lower:
                current_text += "▀"
                continue
            if current_text:
                spans.append({"text": current_text, "fg": current_fg, "bg": current_bg})
            current_fg = upper
            current_bg = lower
            current_text = "▀"
        if current_text:
            spans.append({"text": current_text, "fg": current_fg, "bg": current_bg})
        rows.append(spans)

    return {
        "kind": "image",
        "mimeType": mime_type,
        "data": base64.b64encode(data).decode("ascii"),
        "width": width,
        "height": height,
        "alt": alt,
        "preview": rows,
    }


def build_image_output(data_b64: str, mime_type: str, alt: str) -> Optional[dict]:
    try:
        image_bytes = base64.b64decode(data_b64)
    except Exception:
        return None
    return build_image_preview(image_bytes, mime_type, alt)


def collect_matplotlib_outputs(global_state: dict) -> list[dict]:
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return []

    try:
        figure_numbers = list(pyplot.get_fignums())
    except Exception:
        return []

    outputs: list[dict] = []
    for figure_number in figure_numbers:
        try:
            figure = pyplot.figure(figure_number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
            image_output = build_image_preview(
                buffer.getvalue(),
                "image/png",
                f"matplotlib figure {figure_number}",
            )
            if image_output is not None:
                outputs.append(image_output)
        except Exception:
            continue

    try:
        pyplot.close("all")
    except Exception:
        pass

    return outputs


class StreamingOutput:
    """Stream wrapper that forwards raw chunks as notebook output events."""

    def __init__(self, request_id: str, real_stdout, kind: str) -> None:
        self.request_id = request_id
        self.real_stdout = real_stdout
        self.kind = kind
        self.buffer = io.StringIO()

    def write(self, text: str) -> int:
        self.buffer.write(text)
        if text and self.request_id:
            self.real_stdout.write(
                json.dumps(
                    {
                        "event": "output",
                        "id": self.request_id,
                        "output": {"kind": self.kind, "text": text},
                    }
                )
                + "\n"
            )
            self.real_stdout.flush()
        return len(text)

    def flush(self) -> None:
        return

    def getvalue(self) -> str:
        return self.buffer.getvalue()


class BridgeBackend:
    def __init__(self) -> None:
        os.environ.setdefault("MPLBACKEND", "Agg")
        self.global_state = {"__name__": "__main__"}
        self.execution_count = 0

    def execute(self, code: str, request_id: str = "") -> ExecutionReply:
        real_stdout = sys.__stdout__
        stdout_stream = StreamingOutput(request_id, real_stdout, "stream")
        stderr_stream = StreamingOutput(request_id, real_stdout, "error")

        try:
            parsed = ast.parse(code, mode="exec")
            body = parsed.body
            with contextlib.redirect_stdout(stdout_stream), contextlib.redirect_stderr(
                stderr_stream
            ):
                if body and isinstance(body[-1], ast.Expr):
                    exec_module = ast.Module(body=body[:-1], type_ignores=[])
                    expr = ast.Expression(body[-1].value)
                    if body[:-1]:
                        exec(compile(exec_module, "<notebook-cell>", "exec"), self.global_state)
                    value = eval(compile(expr, "<notebook-cell>", "eval"), self.global_state)
                    if value is not None:
                        emit_output(request_id, {"kind": "result", "text": repr(value)})
                else:
                    exec(compile(parsed, "<notebook-cell>", "exec"), self.global_state)
            stdout_stream.flush()
            rich_outputs = collect_matplotlib_outputs(self.global_state)
            if rich_outputs:
                for output in rich_outputs:
                    emit_output(request_id, output)
            self.execution_count += 1
            return ExecutionReply(
                error=None,
                execution_count=self.execution_count,
                ok=True,
            )
        except Exception:
            stdout_stream.flush()
            rich_outputs = collect_matplotlib_outputs(self.global_state)
            for output in rich_outputs:
                emit_output(request_id, output)
            error_text = traceback.format_exc()
            emit_output(request_id, {"kind": "error", "text": error_text})
            self.execution_count += 1
            return ExecutionReply(
                error=error_text,
                execution_count=self.execution_count,
                ok=False,
            )

    def stop(self) -> None:
        return


class IPyKernelBackend:
    def __init__(self, python_path: str, cwd: str) -> None:
        from jupyter_client import KernelManager

        self.kernel_manager = KernelManager(
            kernel_cmd=[python_path, "-m", "ipykernel_launcher", "-f", "{connection_file}"]
        )
        self.kernel_manager.start_kernel(cwd=cwd)
        self.client = self.kernel_manager.blocking_client()
        self.client.start_channels()
        self.client.wait_for_ready(timeout=30)
        self._setup_inline_matplotlib()

    def _setup_inline_matplotlib(self) -> None:
        setup_code = "%matplotlib inline"
        msg_id = self.client.execute(setup_code, store_history=False, allow_stdin=False)
        while True:
            try:
                message = self.client.get_iopub_msg(timeout=10)
            except queue.Empty:
                break
            if (
                message.get("parent_header", {}).get("msg_id") == msg_id
                and message.get("msg_type") == "status"
                and message.get("content", {}).get("execution_state") == "idle"
            ):
                break

    def execute(self, code: str, request_id: str = "") -> ExecutionReply:
        msg_id = self.client.execute(code, store_history=True, allow_stdin=False)
        error_text = None
        execution_count = 0

        while True:
            try:
                message = self.client.get_iopub_msg(timeout=30)
            except queue.Empty:
                error_text = "Timed out while waiting for the kernel."
                break

            parent = message.get("parent_header", {})
            if parent.get("msg_id") != msg_id:
                continue

            message_type = message.get("msg_type")
            content = message.get("content", {})

            if message_type == "status" and content.get("execution_state") == "idle":
                break

            if message_type == "stream":
                text = content.get("text", "")
                if content.get("name") == "stderr":
                    emit_output(request_id, {"kind": "error", "text": text})
                else:
                    emit_output(request_id, {"kind": "stream", "text": text})
            elif message_type == "execute_result":
                execution_count = content.get("execution_count") or execution_count
                data = content.get("data", {})
                image_captured = False
                if isinstance(data.get("image/png"), str):
                    image_output = build_image_output(
                        data["image/png"],
                        "image/png",
                        data.get("text/plain") or "image/png output",
                    )
                    if image_output is not None:
                        emit_output(request_id, image_output)
                        image_captured = True
                if not image_captured:
                    result_text = (
                        data.get("text/plain")
                        or data.get("text/markdown")
                        or data.get("application/json")
                    )
                    if result_text is not None:
                        emit_output(request_id, {"kind": "result", "text": result_text})
            elif message_type == "display_data":
                data = content.get("data", {})
                image_captured = False
                if isinstance(data.get("image/png"), str):
                    image_output = build_image_output(
                        data["image/png"],
                        "image/png",
                        data.get("text/plain") or "image/png output",
                    )
                    if image_output is not None:
                        emit_output(request_id, image_output)
                        image_captured = True
                elif isinstance(data.get("image/jpeg"), str):
                    image_output = build_image_output(
                        data["image/jpeg"],
                        "image/jpeg",
                        data.get("text/plain") or "image/jpeg output",
                    )
                    if image_output is not None:
                        emit_output(request_id, image_output)
                        image_captured = True
                if not image_captured:
                    result_text = (
                        data.get("text/plain")
                        or data.get("text/markdown")
                    )
                    if result_text is not None:
                        emit_output(request_id, {"kind": "result", "text": result_text})
            elif message_type == "error":
                execution_count = content.get("execution_count") or execution_count
                error_text = stderr_text(content)
                emit_output(request_id, {"kind": "error", "text": error_text})

        return ExecutionReply(
            error=error_text,
            execution_count=execution_count,
            ok=error_text is None,
        )

    def stop(self) -> None:
        try:
            self.client.stop_channels()
        finally:
            self.kernel_manager.shutdown_kernel(now=True)


def build_backend(python_path: str, cwd: str):
    try:
        import ipykernel  # noqa: F401
        import jupyter_client  # noqa: F401

        backend = IPyKernelBackend(python_path, cwd)
        write_message({"event": "hello", "backend": "ipykernel"})
        return backend
    except Exception as error:
        write_message(
            {
                "event": "hello",
                "backend": "bridge",
                "detail": f"Falling back to bridge backend: {error}",
            }
        )
        return BridgeBackend()


def main() -> None:
    python_path = sys.argv[1] if len(sys.argv) > 1 else sys.executable
    cwd = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    backend = build_backend(python_path, cwd)

    try:
        for raw_line in sys.stdin:
            raw_line = raw_line.strip()
            if not raw_line:
                continue

            payload = json.loads(raw_line)
            command = payload.get("command", "execute")

            if command == "shutdown":
                break

            if command != "execute":
                write_message(
                    {
                        "id": payload.get("id"),
                        "ok": False,
                        "error": f"Unsupported command: {command}",
                        "executionCount": 0,
                    }
                )
                continue

            reply = backend.execute(payload["code"], request_id=payload["id"])
            write_message(
                {
                    "id": payload["id"],
                    "ok": reply.ok,
                    "error": reply.error,
                    "executionCount": reply.execution_count,
                }
            )
    finally:
        backend.stop()


if __name__ == "__main__":
    main()
