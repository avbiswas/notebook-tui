# notebook-tui

Terminal-native Jupyter notebook editor and video renderer. Edit notebooks in a vim-style TUI, then render animated walkthroughs to MP4.

Built with Bun, OpenTUI, and Remotion.

## Install

```bash
bun install
bun link
```

This makes `ntui` available globally.

## Usage

### Edit a notebook

```bash
ntui notebook.ipynb
ntui notebook.ipynb --venv .venv
ntui notebook.ipynb --python /path/to/python3
```

### Render to video

```bash
ntui render notebook.ipynb
ntui render notebook.ipynb --animation line --quality 4k --aspect vertical
ntui render notebook.ipynb -o out/video.mp4 --venv .venv
```

### Template-based rendering

```bash
ntui init                    # creates render.yaml
vim render.yaml              # edit settings
ntui render                  # reads ./render.yaml
```

### Help

```bash
ntui --help
```

## Python Resolution

By default, ntui looks for `.venv/bin/python` in the current directory. Override with `--venv` or `--python`.

Resolution order:
1. `--python` flag
2. `--venv` flag
3. `./.venv/bin/python`
4. `python3`

## Execution Backends

The app starts a Python helper process and negotiates one of two backends:

- **ipykernel**: used when the interpreter has `ipykernel` and `jupyter_client`
- **bridge**: stdio fallback when those packages are unavailable

Stdout streams in real-time during execution in both backends.

## Keybindings

### Navigation

| Key | Action |
|-----|--------|
| `j` / `k` | Move between cells |
| `h` / `l` | Move cursor left/right |
| `w` / `b` / `e` | Word motions |
| `gg` | First line of cell |
| `G` | Last line of cell |
| `^` / `0` / `$` | First non-whitespace / line start / line end |
| `f` / `F` / `t` / `T` | Character find motions |
| `;` / `,` | Repeat last find |

### Editing

| Key | Action |
|-----|--------|
| `i` / `a` | Insert / append mode |
| `I` / `A` | Insert at first non-ws / append at EOL |
| `o` / `O` | Insert cell below / above |
| `dd` / `cc` / `yy` | Delete / change / yank line |
| `dw` / `cw` / `yw` | Word operators |
| `D` / `C` / `S` | Delete to end / change to end / replace line |
| `J` | Join with next line |
| `p` / `P` | Paste after / before |
| `u` / `Ctrl-R` | Undo / redo |

### Execution

| Key | Action |
|-----|--------|
| `Shift+Enter` / `r` | Run focused cell |
| `Shift+M` | Toggle cell type (code/markdown) |

### Visual Mode

| Key | Action |
|-----|--------|
| `v` | Visual text selection |
| `V` | Visual line selection |
| `Space vv` | Visual cell selection |
| `y` / `d` | Yank / delete selection |

### Commands

| Command | Action |
|---------|--------|
| `:w` | Save notebook |
| `:q` | Quit |
| `:wq` | Save and quit |
| `:r` | Run all cells |
| `:clear` / `:c` | Clear all outputs |

## Render Options

### Animation Modes

| Mode | Description |
|------|-------------|
| `char` | Character-by-character with natural typing rhythm (default) |
| `word` | Word by word |
| `line` | Line by line |
| `block` | Entire cell appears at once on focus |
| `present` | All code visible from the start |

### Resolution Presets

|  | horizontal | vertical | square |
|--|-----------|----------|--------|
| **sd** | 854x480 | 480x854 | 640x640 |
| **hd** | 1920x1080 | 1080x1920 | 1080x1080 |
| **4k** | 3840x2160 | 2160x3840 | 2160x2160 |

Override with `--width` and `--height` for custom resolutions.

### Render CLI Flags

```
-o, --output <path>       Output path (default: out/video.mp4)
--animation <mode>        char | word | line | block | present
--quality <preset>        sd | hd | 4k (default: hd)
--aspect <ratio>          horizontal | vertical | square (default: horizontal)
--fps <n>                 Frames per second (default: 30)
--width <n>               Custom width (overrides presets)
--height <n>              Custom height (overrides presets)
--force, -f               Re-execute notebook (ignore cache)
--python <path>           Python interpreter
--venv <path>             Virtual environment path
```

## Features

- Vim-style modal editing with insert, normal, visual, and command modes
- Markdown cell support (toggle with `Shift+M`, rendered inline)
- Streaming stdout (output appears line-by-line as it executes)
- Matplotlib plot capture with inline image previews
- `.ipynb` load/save with full round-trip fidelity
- Undo/redo for all notebook mutations
- Video rendering with natural typing animation, blinking cursor, and execution spinners
- File-based caching (skips re-execution for unchanged notebooks)
- YAML template system for render configuration
- Resolution-independent scaling across all presets
