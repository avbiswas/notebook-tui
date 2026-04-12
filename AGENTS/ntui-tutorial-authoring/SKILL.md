---
name: ntui-tutorial-authoring
description: Create and refine `ntui` tutorial notebooks and render plans. Use when authoring `# ntui:` directives, preview layouts, labels, highlights, callouts, or compact demo notebooks for rendered walkthroughs.
---

# ntui Tutorial Authoring

Use this skill when working on tutorial-style notebooks meant for `ntui render`.

## Focus

- Keep demo notebooks small and fast to render.
- Prefer `# ntui:` directives that are easy to read and compose.
- Use labels, highlights, callouts, and previews to teach one idea at a time.
- Favor short source and short outputs unless a longer output is the point of the demo.

## Workflow

1. Start from the teaching goal.
2. Reduce the notebook to the smallest set of cells that demonstrates that goal.
3. Add `# ntui:` directives only for the effect being tested.
4. Verify the sequence reads well in render order:
   source, emphasis, output, preview, restore, next cell.

## Good Patterns

```python
# ntui: label="Parse"
# ntui: highlight=3-4 highlight_focus=4
```

```python
# ntui: preview=@,@o preview_layout=columns
# ntui: callout="Compare code and result"
```

```python
# ntui: id=parse
# ntui: preview=parse,parseo,@o preview_layout=grid
```

## Guardrails

- Do not add long explanatory prose to notebooks when a `label` or `callout` is enough.
- Do not use multi-cell demos when one or two cells can show the effect.
- If a preview is used, make sure the inline state still makes sense before and after the preview.
