import React, { useMemo } from "react";
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

/**
 * Tokenize full cell source into per-line token arrays.
 * Must be called once per cell, not per line, so multi-line
 * constructs (triple-quoted strings, etc.) are handled correctly.
 */
export function tokenizeSource(source: string): TokenizedLines {
  const result = highlighter.codeToTokens(source, {
    lang: "python",
    theme: "monokai",
  });
  return result.tokens.map((lineTokens) =>
    lineTokens.map((t) => ({ text: t.content, color: t.color || "#f8f8f2" })),
  );
}

export function useTokenizedSource(source: string): TokenizedLines {
  return useMemo(() => tokenizeSource(source), [source]);
}

export const SyntaxLine: React.FC<{
  tokens: { text: string; color: string }[];
}> = ({ tokens }) => {
  return (
    <span>
      {tokens.map((token, i) => (
        <span key={i} style={{ color: token.color }}>
          {token.text}
        </span>
      ))}
    </span>
  );
};
