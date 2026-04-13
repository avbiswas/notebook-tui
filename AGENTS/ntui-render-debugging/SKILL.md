---
name: ntui-render-debugging
description: Troubleshoot and fix issues with notebook-tui (ntui) video rendering — wrong timing, broken highlights, missing previews, or animation glitches. Use when the user's rendered video doesn't look right, animations are off, or ntui directives aren't producing the expected result. Triggers on "ntui render broken", "ntui video wrong", "render looks wrong", "highlight not showing", "preview not working", "animation glitch", "ntui timing", "notebook-tui render", "ntui render issue", "jupyter notebook in terminal render".
---

# ntui Render Debugging

Help users fix problems with `ntui render` output — when the video doesn't match what they expect from their notebook and `# ntui:` directives.

## When to Use This Skill

- Rendered video has wrong timing (cells appear too fast/slow)
- Highlights don't show on the expected lines
- Previews don't appear, or appear at the wrong time
- Callouts or labels are missing
- Animation mode isn't applying correctly
- Output appears inline when it should be in a preview overlay, or vice versa

## Diagnostic Workflow

### 1. Check the directives

Verify the `# ntui:` comment lines at the top of the cell are syntactically correct:

```python
# ntui: label="Title" highlight=3-5 highlight_focus=4
```

Common mistakes:
- Missing `=` between key and value (e.g., `label "Title"` instead of `label="Title"`)
- Putting directives after code lines (they must be at the top of the cell, before any code)
- Using quotes incorrectly (use `"double quotes"` for values with spaces)
- Line numbers in `highlight` are 1-indexed and refer to visible source lines (excluding the `# ntui:` lines themselves)

### 2. Check the timeline

Run capture separately to inspect the intermediate data:

```bash
bun src/capture.ts notebook.ipynb -o timeline.json
```

Then inspect `timeline.json`:
- `cells[i].commands` — parsed directives for each cell
- `events` — the sequence of focus, source, output, complete events

If `commands` is empty for a cell that has directives, the parser didn't recognize them.

### 3. Common issues and fixes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Highlight on wrong lines | Line numbers include `# ntui:` lines | Line numbers are relative to visible source; recount excluding directive lines |
| Preview doesn't appear | Missing `preview=` or wrong cell reference | Check `preview=@,@o` syntax; use `id=` on target cells for symbolic refs |
| Label not showing | Typo in `label=` or missing quotes | Use `label="My Title"` with double quotes if value has spaces |
| `input=fade` has no effect | Directive on wrong line or typo | Ensure it's `input=fade` not `animation=fade` |
| Callout missing | `callout=` without a preview | Callouts only display during preview overlays; add `preview=@` or similar |
| Output shows inline AND in preview | Expected behavior | Output always renders inline; previews overlay on top when active |
| Cell skipped in video | No execution event | Ensure the cell was executed (check timeline events) |

### 4. Animation mode not applying

Per-cell override uses `input=`, not `animation=`:

```python
# ntui: input=block
```

Global override is a CLI flag:

```bash
ntui render notebook.ipynb --animation block
```

Valid values: `char`, `word`, `line`, `block`, `fade`, `present`

### 5. Preview layout issues

Available layouts: `center`, `columns`, `rows`, `grid`, `main_rail`

```python
# ntui: preview=@,@o preview_layout=columns
```

- `columns` — side by side (best for 2 targets)
- `grid` — 2x2 grid (best for 3-4 targets)
- `center` — single centered panel (default for 1 target)
- `main_rail` — main panel + sidebar

### 6. Cross-reference issues

References use cell index (1-based) or symbolic `id`:
- `@` = current cell's source
- `@o` = current cell's output
- `2` = cell 2's source
- `2o` = cell 2's output
- `parse` = cell with `id=parse` (source)
- `parseo` = cell with `id=parse` (output)

## Render CLI for Testing

```bash
ntui render notebook.ipynb                    # full render
ntui render notebook.ipynb --animation block  # fast preview (skip typing)
ntui render notebook.ipynb --force            # re-execute (ignore cache)
```

Use `--animation block` or `--animation present` for fast iteration when debugging layout/timing issues — skip the slow character typing to focus on the visual structure.
