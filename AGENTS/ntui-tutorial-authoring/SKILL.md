---
name: ntui-tutorial-authoring
description: Create polished tutorial notebooks for animated video rendering with notebook-tui (ntui). Use when the user wants to author Jupyter notebooks in the terminal, add ntui directives for highlights/labels/callouts/previews, or produce animated code walkthrough videos. Triggers on "ntui", "notebook-tui", "notebook tui", "jupyter notebook in terminal", "render notebook", "code walkthrough video", "animated notebook", "tutorial notebook", "ntui render", "ntui directives".
---

# ntui Tutorial Authoring

Help users create Jupyter notebooks designed for animated video rendering with `ntui`.

## What is ntui

notebook-tui (`ntui`) is a terminal-native Jupyter notebook editor with vim-style keybindings. Users edit `.ipynb` files in the terminal and can render them as animated MP4 walkthrough videos with typing animations, highlights, and overlays.

## When to Use This Skill

- User wants to create a notebook meant for video rendering
- User asks about `# ntui:` directives
- User wants to add labels, highlights, callouts, or previews to notebook cells
- User is planning a code tutorial or walkthrough video
- User mentions "ntui", "notebook-tui", "jupyter notebook in terminal"

## ntui Rendering Directives

Add `# ntui: key=value` comment lines at the top of a code cell. These are hidden in the rendered video.

### Available Directives

| Directive | Example | Purpose |
|-----------|---------|---------|
| `label` | `label="Parsing"` | Title shown in the video overlay |
| `id` | `id=parse` | Symbolic cell id for cross-references |
| `highlight` | `highlight=3-5` | Highlight source lines (1-indexed, comma-separated ranges) |
| `highlight_focus` | `highlight_focus=4` | Emphasize specific lines within the highlight |
| `callout` | `callout="Key insight"` | Banner text displayed during preview |
| `source=preview` | | Show this cell's source in a preview overlay |
| `output=preview` | | Show this cell's output in a preview overlay |
| `preview` | `preview=@,@o,2o` | Preview specific targets (`@` = this cell, `2` = cell 2, `o` suffix = output) |
| `preview_layout` | `preview_layout=columns` | Layout: `center`, `columns`, `rows`, `grid`, `main_rail` |
| `input` | `input=fade` | Animation style: `char`, `word`, `line`, `block`, `fade`, `present` |
| `arrow` | `arrow=3\|lr:"The learning rate"` | Arrow annotation: highlights `lr` on line 3, shows callout text. Use `\|` to specify text to highlight within the line |
| `skip` | `skip=true` | Execute cell but hide from video (useful for boilerplate) |

### Animation Modes (per-cell `input=`)

- `char` — character-by-character typing (default)
- `word` — word-by-word typing
- `line` — line-by-line reveal
- `block` — entire source appears instantly
- `fade` — instant reveal with fade-in effect
- `present` — all code visible from the start, minimal delay

## Authoring Guidelines

1. **Start from the teaching goal.** Each cell should demonstrate one concept.
2. **Keep notebooks small.** Fewer cells render faster and are easier to follow.
3. **Use labels for chapter headings.** `label="Step 1: Setup"` appears as an overlay title.
4. **Highlight sparingly.** Draw attention to the 1-3 lines that matter most.
5. **Use callouts for key insights.** Short text like `callout="This returns a generator"`.
6. **Prefer short outputs.** Long outputs slow the video; truncate or filter when possible.
7. **Use `input=fade` for boilerplate.** Skip typing animation on import blocks or setup code.
8. **Preview code+output together.** `preview=@,@o preview_layout=columns` shows source alongside result.

## Example Patterns

### Simple labeled cell with highlight

```python
# ntui: label="Data Loading"
# ntui: highlight=3-4 highlight_focus=4
import pandas as pd

df = pd.read_csv("data.csv")
df.head()
```

### Side-by-side code and output preview

```python
# ntui: preview=@,@o preview_layout=columns
# ntui: callout="Compare input and output"
result = transform(data)
print(result)
```

### Cross-referencing cells

```python
# ntui: id=parse
# ntui: label="Parser"
def parse(text):
    return ast.parse(text)
```

```python
# ntui: preview=parse,parseo,@o preview_layout=grid
# ntui: callout="Parser output vs our output"
output = parse(sample_code)
```

### Skip typing for boilerplate

```python
# ntui: input=fade
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
```

### Arrow annotation explaining a parameter

```python
# ntui: label="Training Config" arrow=3:"The learning rate controls step size"
model = Model(
    lr=0.001,
    epochs=100,
)
```

### Hide boilerplate cells from video

```python
# ntui: skip=true
import os
import sys
sys.path.insert(0, os.getcwd())
```

## Rendering Commands

```bash
ntui render notebook.ipynb                          # default: char animation, HD, horizontal
ntui render notebook.ipynb --animation line          # line-by-line globally
ntui render notebook.ipynb --quality 4k --aspect vertical  # vertical 4K (e.g. for mobile/social)
ntui render notebook.ipynb -o walkthrough.mp4        # custom output path
```

## Tips

- Run `ntui notebook.ipynb` to edit and test the notebook interactively first
- Press `Space ?` or `Shift+H` in the TUI for the full keybinding reference
- Use `:w` to save, `R` to run a cell, `Shift+M` to toggle code/markdown
- The `# ntui:` lines are only used during `ntui render` — they are ignored during normal editing
