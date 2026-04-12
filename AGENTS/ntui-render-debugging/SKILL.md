---
name: ntui-render-debugging
description: Debug `ntui` render behavior and presentation timing. Use when investigating preview timing, highlight sequencing, scroll behavior, inline-vs-overlay transitions, or render-mode regressions.
---

# ntui Render Debugging

Use this skill when `ntui render` looks wrong even though notebook execution is correct.

## Focus Areas

- Timeline capture vs renderer mismatch
- Per-cell command parsing and propagation
- Highlight timing and fade windows
- Preview lifecycle: inline, overlay, exit, restore
- Scroll and clipping during typing or streaming output

## Workflow

1. Confirm the notebook carries the expected `# ntui:` directives.
2. Check captured timeline data before assuming a renderer bug.
3. Isolate whether the bug is:
   parser, capture, layout, timing, or render component logic.
4. Reduce to a minimal notebook that reproduces the issue.
5. Fix timing and layout helpers before patching individual render branches.

## Useful Checks

- Run capture on the demo notebook and inspect `timeline.cells[*].commands`.
- Verify whether output is inline, previewed, or both.
- Check whether preview close timing overlaps with highlight outro.
- Confirm collapsed code cells do not accidentally hide output.

## Guardrails

- Prefer fixing shared timing helpers over adding more one-off conditions.
- Keep render-mode fixes separate from TUI navigation unless the bug spans both paths.
- Preserve direct-display behavior; do not change `print()` semantics when fixing render output.
