import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import python from "shiki/langs/python.mjs";
import monokai from "shiki/themes/monokai.mjs";

const highlighter = createHighlighterCoreSync({
  themes: [monokai],
  langs: [python],
  engine: createJavaScriptRegexEngine(),
});

export type TokenizedLines = { text: string; color: string }[][];

export function tokenizeSource(source: string): TokenizedLines {
  const result = highlighter.codeToTokens(source, {
    lang: "python",
    theme: "monokai",
  });
  return result.tokens.map((lineTokens) =>
    lineTokens.map((token) => ({ text: token.content, color: token.color || "#f8f8f2" })),
  );
}
