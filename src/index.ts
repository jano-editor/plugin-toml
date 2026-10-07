import type { LanguagePlugin, PluginContext, HighlightToken } from "@jano-editor/plugin-types";

// TOML highlighting. A small tokenizer with state, so multi-line strings (""" and ''')
// are colored correctly.

const State = { Normal: 0, MultiBasic: 1, MultiLiteral: 2 } as const;
type State = (typeof State)[keyof typeof State];

interface Result {
  tokens: HighlightToken[];
  end: State;
}

// a key part: bare, "basic" or 'literal'
const KEY_PART = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
// a (dotted) key followed by "=", e.g. `name =`, `a.b."c" =`
const KEY = new RegExp(String.raw`^${KEY_PART}(?:\s*\.\s*${KEY_PART})*(?=\s*=)`);
// dates and times: 1979-05-27, 1979-05-27T07:32:00Z, 07:32:00.999, with offsets
const DATETIME = /^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)/;
const NUMBER = /^[+-]?(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|inf|nan|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)(?![\w.:-])/;

/** Tokenizes one line, starting in `state`. With collect=false only the end state is computed. */
function tokenize(line: string, state: State, collect = true): Result {
  const tokens: HighlightToken[] = [];
  const add = (start: number, end: number, type: string) => {
    if (collect && end > start) tokens.push({ start, end, type });
  };
  let i = 0;
  // a key may start at the beginning of a line and after "{" or "," in inline tables
  let expectKey = true;

  while (i < line.length) {
    if (state !== State.Normal) {
      const quote = state === State.MultiBasic ? '"""' : "'''";
      const close = findClose(line, i, quote, state === State.MultiBasic);
      const end = close === -1 ? line.length : close + 3;
      add(i, end, "string");
      i = end;
      if (close !== -1) state = State.Normal;
      continue;
    }

    const c = line[i];
    const rest = line.slice(i);

    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "#") {
      add(i, line.length, "comment");
      break;
    }

    // table header at the start of a line: [table] or [[array.of.tables]]
    if (c === "[" && line.slice(0, i).trim() === "") {
      const double = rest.startsWith("[[");
      const close = line.indexOf(double ? "]]" : "]", i);
      const end = close === -1 ? line.length : close + (double ? 2 : 1);
      add(i, end, "type");
      i = end;
      continue;
    }

    if (expectKey) {
      const key = KEY.exec(rest);
      if (key) {
        add(i, i + key[0].length, "property");
        i += key[0].length;
        expectKey = false;
        continue;
      }
    }

    if (rest.startsWith('"""') || rest.startsWith("'''")) {
      const quote = rest.slice(0, 3);
      const close = findClose(line, i + 3, quote, quote === '"""');
      if (close === -1) {
        add(i, line.length, "string");
        state = quote === '"""' ? State.MultiBasic : State.MultiLiteral;
        break;
      }
      add(i, close + 3, "string");
      i = close + 3;
      continue;
    }
    if (c === '"' || c === "'") {
      // basic strings know escapes, literal strings don't
      const close = findClose(line, i + 1, c, c === '"');
      const end = close === -1 ? line.length : close + 1;
      add(i, end, "string");
      i = end;
      continue;
    }

    const date = DATETIME.exec(rest);
    if (date) {
      add(i, i + date[0].length, "constant");
      i += date[0].length;
      continue;
    }
    const num = NUMBER.exec(rest);
    if (num) {
      add(i, i + num[0].length, "number");
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_][\w-]*/.exec(rest);
    if (word) {
      if (word[0] === "true" || word[0] === "false") add(i, i + word[0].length, "constant");
      i += word[0].length;
      continue;
    }

    if ("{}[],=.".includes(c)) {
      add(i, i + 1, c === "=" ? "operator" : "punctuation");
      if (c === "{" || c === ",") expectKey = true;
      i++;
      continue;
    }
    i++;
  }

  return { tokens, end: state };
}

/** Index of the closing quote at or after `from`, or -1. Escapes only count in basic strings. */
function findClose(line: string, from: number, quote: string, escapes: boolean): number {
  for (let i = from; i < line.length; i++) {
    if (escapes && line[i] === "\\") i++;
    else if (line.startsWith(quote, i)) return i;
  }
  return -1;
}

// ----- start state of a line -----

// like vim's "syntax sync minlines": look back this many lines for an open string
const SYNC_LINES = 500;

// the editor renders lines top to bottom in one go, so the end state of the previous
// line is reused. it is cleared after the frame, edits elsewhere can't leave it stale.
let memo: { lines: readonly string[]; index: number; text: string; end: State } | null = null;
let clearScheduled = false;

function startState(index: number, lines: readonly string[]): State {
  if (memo && memo.lines === lines && memo.index === index - 1 && memo.text === lines[index - 1]) {
    return memo.end;
  }
  let state: State = State.Normal;
  for (let i = Math.max(0, index - SYNC_LINES); i < index; i++) {
    state = tokenize(lines[i], state, false).end;
  }
  return state;
}

function highlightLine(line: string, index: number, lines: readonly string[]): HighlightToken[] {
  const { tokens, end } = tokenize(line, startState(index, lines));
  memo = { lines, index, text: line, end };
  if (!clearScheduled) {
    clearScheduled = true;
    queueMicrotask(() => {
      memo = null;
      clearScheduled = false;
    });
  }
  return tokens;
}

// ----- plugin -----

const plugin: LanguagePlugin = {
  name: "TOML",
  extensions: [".toml"],

  highlightLine,

  // keep the indent on Enter, one level deeper inside an open array or inline table
  onCursorAction(ctx: PluginContext) {
    if (!ctx.action || ctx.action.type !== "newline") return null;

    const curLine = ctx.action.cursor.position.line;
    const prevLine = curLine > 0 ? ctx.lines[curLine - 1] : "";
    let indent = /^\s*/.exec(prevLine)?.[0] ?? "";
    const code = prevLine.replace(/#.*$/, "").trimEnd();

    if (/[[{]$/.test(code)) {
      indent += ctx.settings.insertSpaces ? " ".repeat(ctx.settings.tabSize) : "\t";
    }
    if (indent.length === 0) return null;

    return {
      edits: [
        {
          range: { start: { line: curLine, col: 0 }, end: { line: curLine, col: 0 } },
          text: indent,
        },
      ],
      cursors: [{ position: { line: curLine, col: indent.length }, anchor: null }],
    };
  },
};

export default plugin;
export { tokenize, State };
