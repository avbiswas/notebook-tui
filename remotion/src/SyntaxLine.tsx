import React from "react";
import { monokai } from "./theme";

type Token = { text: string; color: string };

const KEYWORDS = new Set([
  "import", "from", "as", "def", "class", "return", "if", "elif", "else",
  "for", "while", "in", "not", "and", "or", "is", "with", "try", "except",
  "finally", "raise", "yield", "lambda", "pass", "break", "continue",
  "True", "False", "None", "print",
]);

const BUILTINS = new Set([
  "range", "len", "int", "str", "float", "list", "dict", "set", "tuple",
  "type", "isinstance", "enumerate", "zip", "map", "filter", "sorted",
  "open", "super", "property",
]);

function tokenizePython(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Comments
    if (line[i] === "#") {
      tokens.push({ text: line.slice(i), color: monokai.comment });
      break;
    }

    // Strings
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i]!;
      const triple = line.slice(i, i + 3) === quote.repeat(3);
      const end = triple ? quote.repeat(3) : quote;
      const start = i;
      i += end.length;
      while (i < line.length && line.slice(i, i + end.length) !== end) {
        if (line[i] === "\\") i++;
        i++;
      }
      i += end.length;
      tokens.push({ text: line.slice(start, i), color: monokai.string });
      continue;
    }

    // Numbers
    if (/\d/.test(line[i]!)) {
      const start = i;
      while (i < line.length && /[\d.e_xXabcdefABCDEF]/.test(line[i]!)) i++;
      tokens.push({ text: line.slice(start, i), color: monokai.number });
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(line[i]!)) {
      const start = i;
      while (i < line.length && /[A-Za-z0-9_]/.test(line[i]!)) i++;
      const word = line.slice(start, i);

      // Check if it's followed by ( → function call
      const nextNonSpace = line.slice(i).match(/^(\s*)\(/);

      if (KEYWORDS.has(word)) {
        tokens.push({ text: word, color: monokai.keyword });
      } else if (BUILTINS.has(word)) {
        tokens.push({ text: word, color: monokai.builtin });
      } else if (nextNonSpace) {
        tokens.push({ text: word, color: monokai.function });
      } else {
        tokens.push({ text: word, color: monokai.text });
      }
      continue;
    }

    // Decorators
    if (line[i] === "@") {
      const start = i;
      i++;
      while (i < line.length && /[A-Za-z0-9_.]/.test(line[i]!)) i++;
      tokens.push({ text: line.slice(start, i), color: monokai.function });
      continue;
    }

    // Operators and punctuation
    tokens.push({ text: line[i]!, color: monokai.text });
    i++;
  }

  return tokens;
}

export const SyntaxLine: React.FC<{ line: string }> = ({ line }) => {
  const tokens = tokenizePython(line);
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
