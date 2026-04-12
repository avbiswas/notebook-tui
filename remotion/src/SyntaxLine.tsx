import React, { useMemo } from "react";
import { tokenizeSource, type TokenizedLines } from "./shiki";

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
