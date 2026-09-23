/**
 * formula.js
 * A small, dependency-free spreadsheet-like formula engine for Kanban cards.
 *
 * Two ways a card's text can reference other cards:
 *   1. Inline interpolation anywhere in plain text:   Hello {{card-title-or-id}}!
 *   2. Formula mode - text starting with "=":          =CONCAT("Hi ", {{name}}, "!")
 *
 * Formula language supports:
 *   - String literals "..." / '...'
 *   - Numbers
 *   - Operators:  +  -  *  /  &  (concat)   ==  !=  <  >  <=  >=
 *   - Parentheses
 *   - {{ref}} inline card reference tokens (resolved as strings, numeric if parseable)
 *   - Functions: CARD(id), REF(id), CONCAT(...), JOIN(sep, ...items), UPPER(s), LOWER(s),
 *                TRIM(s), LEN(s), IF(cond, a, b), SUM(...nums), AVG(...nums),
 *                ROUND(n, d), TODAY(), NOW(), CARDS_IN(columnId|columnTitle),
 *                COUNT_IN(columnId|columnTitle)
 *
 * Circular references are detected and reported as "#REF!-CIRCULAR".
 */

const MAX_REF_DEPTH = 40;

export class FormulaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Card resolution helpers                                             */
/* ------------------------------------------------------------------ */

function normalize(str) {
  return String(str ?? "").trim().toLowerCase();
}

/** Finds a card by exact id first, then by case-insensitive title match. */
function findCard(board, ref) {
  if (!ref) return null;
  const byId = board.cards.find((c) => c.id === ref);
  if (byId) return byId;
  const norm = normalize(ref);
  return board.cards.find((c) => normalize(c.title) === norm) || null;
}

function findColumn(board, ref) {
  if (!ref) return null;
  const byId = board.columns.find((c) => c.id === ref);
  if (byId) return byId;
  const norm = normalize(ref);
  return board.columns.find((c) => normalize(c.title) === norm) || null;
}

/* ------------------------------------------------------------------ */
/* Public entry point: evaluate a card's raw content -> display string */
/* ------------------------------------------------------------------ */

export function evaluateCardContent(board, card, opts = {}) {
  const stack = opts.stack || [];
  if (stack.includes(card.id)) {
    return `#REF!-CIRCULAR(${[...stack, card.id].join(" \u2192 ")})`;
  }
  const nextStack = [...stack, card.id];
  if (nextStack.length > MAX_REF_DEPTH) {
    return "#REF!-TOO_DEEP";
  }

  const raw = card.content ?? "";
  try {
    if (raw.trim().startsWith("=")) {
      const result = evaluateFormula(raw.trim().slice(1), board, nextStack);
      return stringifyResult(result);
    }
    return resolveInline(raw, board, nextStack);
  } catch (err) {
    if (err instanceof FormulaError) return `#ERROR!-${err.code}`;
    return `#ERROR!-${(err && err.message) || "UNKNOWN"}`;
  }
}

function stringifyResult(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(stringifyResult).join(", ");
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  }
  return String(v);
}

/** Replace every {{ref}} occurrence in plain text with the resolved card value. */
export function resolveInline(text, board, stack) {
  return String(text ?? "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, ref) => {
    const target = findCard(board, ref.trim());
    if (!target) return `#REF!-NOTFOUND(${ref.trim()})`;
    return evaluateCardContent(board, target, { stack });
  });
}

/* ------------------------------------------------------------------ */
/* Tokenizer                                                            */
/* ------------------------------------------------------------------ */

const TOKEN_RE =
  /\s*({{\s*[^{}]+?\s*}}|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<=|>=|==|!=|&&|\|\||[()&+\-*/,<>])\s*/y;

function tokenize(src) {
  const tokens = [];
  let idx = 0;
  TOKEN_RE.lastIndex = 0;
  while (idx < src.length) {
    TOKEN_RE.lastIndex = idx;
    const m = TOKEN_RE.exec(src);
    if (!m || m[0].length === 0) {
      if (/\s/.test(src[idx])) {
        idx++;
        continue;
      }
      throw new FormulaError("SYNTAX", `Unexpected character '${src[idx]}' at ${idx}`);
    }
    tokens.push(m[1]);
    idx += m[0].length;
  }
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Recursive-descent parser + evaluator (Pratt-ish for binary ops)     */
/* ------------------------------------------------------------------ */

class Parser {
  constructor(tokens, board, stack) {
    this.tokens = tokens;
    this.pos = 0;
    this.board = board;
    this.stack = stack;
  }
  peek() {
    return this.tokens[this.pos];
  }
  next() {
    return this.tokens[this.pos++];
  }
  expect(tok) {
    if (this.peek() !== tok) {
      throw new FormulaError("SYNTAX", `Expected '${tok}' but got '${this.peek()}'`);
    }
    return this.next();
  }

  parseExpression() {
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseConcat();
    while (["==", "!=", "<", ">", "<=", ">="].includes(this.peek())) {
      const op = this.next();
      const right = this.parseConcat();
      left = applyComparison(op, left, right);
    }
    return left;
  }

  parseConcat() {
    let left = this.parseAdditive();
    while (this.peek() === "&") {
      this.next();
      const right = this.parseAdditive();
      left = toStr(left) + toStr(right);
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.next();
      const right = this.parseMultiplicative();
      left = op === "+" ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.next();
      const right = this.parseUnary();
      if (op === "/") {
        if (toNum(right) === 0) throw new FormulaError("DIV0", "Division by zero");
        left = toNum(left) / toNum(right);
      } else {
        left = toNum(left) * toNum(right);
      }
    }
    return left;
  }

  parseUnary() {
    if (this.peek() === "-") {
      this.next();
      return -toNum(this.parseUnary());
    }
    if (this.peek() === "+") {
      this.next();
      return toNum(this.parseUnary());
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();
    if (tok === undefined) throw new FormulaError("SYNTAX", "Unexpected end of formula");

    if (tok === "(") {
      this.next();
      const val = this.parseExpression();
      this.expect(")");
      return val;
    }

    // string literal
    if (/^".*"$/.test(tok) || /^'.*'$/.test(tok)) {
      this.next();
      return tok.slice(1, -1).replace(/\\(.)/g, "$1");
    }

    // number literal
    if (/^\d+(\.\d+)?$/.test(tok)) {
      this.next();
      return parseFloat(tok);
    }

    // inline {{ref}} literal
    if (/^\{\{/.test(tok)) {
      this.next();
      const ref = tok.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
      const target = findCard(this.board, ref);
      if (!target) return `#REF!-NOTFOUND(${ref})`;
      const val = evaluateCardContent(this.board, target, { stack: this.stack });
      return maybeNumeric(val);
    }

    // identifier: function call, or bare TRUE/FALSE
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
      this.next();
      if (this.peek() === "(") {
        return this.parseCall(tok);
      }
      if (tok.toUpperCase() === "TRUE") return true;
      if (tok.toUpperCase() === "FALSE") return false;
      // Bare word: treat as a card title lookup for convenience, else literal string
      const target = findCard(this.board, tok);
      if (target) return maybeNumeric(evaluateCardContent(this.board, target, { stack: this.stack }));
      return tok;
    }

    throw new FormulaError("SYNTAX", `Unexpected token '${tok}'`);
  }

  parseArgs() {
    const args = [];
    if (this.peek() !== ")") {
      args.push(this.parseExpression());
      while (this.peek() === ",") {
        this.next();
        args.push(this.parseExpression());
      }
    }
    this.expect(")");
    return args;
  }

  parseCall(name) {
    this.expect("(");
    const args = this.parseArgs();
    return callFunction(name.toUpperCase(), args, this.board, this.stack);
  }
}

function applyComparison(op, a, b) {
  const na = maybeNumeric(a);
  const nb = maybeNumeric(b);
  const bothNum = typeof na === "number" && typeof nb === "number";
  const x = bothNum ? na : toStr(a);
  const y = bothNum ? nb : toStr(b);
  switch (op) {
    case "==":
      return x === y;
    case "!=":
      return x !== y;
    case "<":
      return x < y;
    case ">":
      return x > y;
    case "<=":
      return x <= y;
    case ">=":
      return x >= y;
    default:
      throw new FormulaError("SYNTAX", `Unknown operator ${op}`);
  }
}

function toNum(v) {
  const n = maybeNumeric(v);
  if (typeof n === "number" && !Number.isNaN(n)) return n;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new FormulaError("VALUE", `Expected a number, got '${v}'`);
}

function toStr(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(toStr).join(", ");
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function maybeNumeric(v) {
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* Built-in functions                                                   */
/* ------------------------------------------------------------------ */

function callFunction(name, args, board, stack) {
  switch (name) {
    case "CARD":
    case "REF": {
      const ref = toStr(args[0]);
      const target = findCard(board, ref);
      if (!target) return `#REF!-NOTFOUND(${ref})`;
      return maybeNumeric(evaluateCardContent(board, target, { stack }));
    }
    case "CONCAT":
      return args.map(toStr).join("");
    case "JOIN": {
      const sep = toStr(args[0]);
      return args.slice(1).flat(Infinity).map(toStr).join(sep);
    }
    case "UPPER":
      return toStr(args[0]).toUpperCase();
    case "LOWER":
      return toStr(args[0]).toLowerCase();
    case "TRIM":
      return toStr(args[0]).trim();
    case "LEN":
      return toStr(args[0]).length;
    case "IF":
      return args[0] ? args[1] : args[2];
    case "NOT":
      return !args[0];
    case "AND":
      return args.every(Boolean);
    case "OR":
      return args.some(Boolean);
    case "SUM":
      return args.flat(Infinity).reduce((acc, v) => acc + toNum(v), 0);
    case "AVG": {
      const flat = args.flat(Infinity);
      if (!flat.length) return 0;
      return flat.reduce((acc, v) => acc + toNum(v), 0) / flat.length;
    }
    case "MIN":
      return Math.min(...args.flat(Infinity).map(toNum));
    case "MAX":
      return Math.max(...args.flat(Infinity).map(toNum));
    case "ROUND": {
      const d = args[1] !== undefined ? toNum(args[1]) : 0;
      const factor = Math.pow(10, d);
      return Math.round(toNum(args[0]) * factor) / factor;
    }
    case "TODAY":
      return new Date().toISOString().slice(0, 10);
    case "NOW":
      return new Date().toISOString();
    case "CARDS_IN": {
      const col = findColumn(board, toStr(args[0]));
      if (!col) return `#REF!-NOCOLUMN(${toStr(args[0])})`;
      return board.cards
        .filter((c) => c.columnId === col.id)
        .map((c) => maybeNumeric(evaluateCardContent(board, c, { stack })));
    }
    case "COUNT_IN": {
      const col = findColumn(board, toStr(args[0]));
      if (!col) return `#REF!-NOCOLUMN(${toStr(args[0])})`;
      return board.cards.filter((c) => c.columnId === col.id).length;
    }
    default:
      throw new FormulaError("NAME", `Unknown function ${name}`);
  }
}

/* ------------------------------------------------------------------ */

export function evaluateFormula(src, board, stack) {
  const tokens = tokenize(src);
  const parser = new Parser(tokens, board, stack);
  const result = parser.parseExpression();
  if (parser.pos < tokens.length) {
    throw new FormulaError("SYNTAX", `Unexpected trailing token '${parser.peek()}'`);
  }
  return result;
}

/** Extract the list of card ids/titles a given raw content string depends on (for graph/debug UI). */
export function extractReferences(content) {
  const refs = new Set();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(content || ""))) refs.add(m[1].trim());
  const callRe = /\b(?:CARD|REF)\(\s*["']?([^"')]+?)["']?\s*\)/gi;
  while ((m = callRe.exec(content || ""))) refs.add(m[1].trim());
  return [...refs];
}
