(() => {
  "use strict";

  const $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element: ${id}`);
    return el;
  };

  const els = {
    tabButtons: Array.from(document.querySelectorAll(".seg__btn[data-tab]")),
    panels: {
      obf: $("panel-obf"),
      restore: $("panel-restore"),
    },

    obfInput: $("obf-input"),
    obfOutput: $("obf-output"),
    obfKey: $("obf-key"),

    restoreKey: $("restore-key"),
    restoreOutput: $("restore-output"),

    toast: $("toast"),
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("is-on");
    void els.toast.offsetHeight;
    els.toast.classList.add("is-on");
  }

  function bytesToBase64Url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomKey() {
    const buf = new Uint8Array(12);
    if (window.crypto?.getRandomValues) {
      crypto.getRandomValues(buf);
    } else {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    return bytesToBase64Url(buf);
  }

  const VAULT_PREFIX = "luau_vault_v1:";

  function vaultPut(key, original) {
    const record = {
      original,
      createdAt: Date.now(),
    };
    localStorage.setItem(VAULT_PREFIX + key, JSON.stringify(record));
  }

  function vaultGet(key) {
    const raw = localStorage.getItem(VAULT_PREFIX + key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.original !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  const KEYWORDS = new Set([
    "and",
    "break",
    "do",
    "else",
    "elseif",
    "end",
    "false",
    "for",
    "function",
    "if",
    "in",
    "local",
    "nil",
    "not",
    "or",
    "repeat",
    "return",
    "then",
    "true",
    "until",
    "while",

    // Luau extras
    "continue",
    "type",
    "export",
  ]);

  function isWhitespace(ch) {
    return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\v" || ch === "\f";
  }

  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }

  function isIdentStart(ch) {
    return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
  }

  function isIdentPart(ch) {
    return isIdentStart(ch) || isDigit(ch);
  }

  function longBracketLevel(src, at) {
    if (src[at] !== "[") return -1;
    let i = at + 1;
    while (i < src.length && src[i] === "=") i++;
    if (src[i] !== "[") return -1;
    return i - (at + 1);
  }

  function readLongBracket(src, at) {
    const level = longBracketLevel(src, at);
    if (level < 0) return null;

    const openLen = 2 + level;
    let i = at + openLen;

    while (i < src.length) {
      if (src[i] === "]") {
        let j = i + 1;
        let ok = true;
        for (let k = 0; k < level; k++) {
          if (src[j + k] !== "=") {
            ok = false;
            break;
          }
        }
        if (ok && src[j + level] === "]") {
          const end = j + level + 1;
          return { value: src.slice(at, end + 1), end: end + 1 };
        }
      }
      i++;
    }

    return { value: src.slice(at), end: src.length };
  }

  function tokenizeLuau(src) {
    const tokens = [];
    const multi = [
      "...",
      "..=",
      "..",
      "//=",
      "//",
      "<<=",
      ">>=",
      "<<",
      ">>",
      "==",
      "~=",
      "<=",
      ">=",
      "::",
      "->",
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "^=",
      "&=",
      "|=",
    ];

    let i = 0;
    while (i < src.length) {
      const ch = src[i];

      if (isWhitespace(ch)) {
        const start = i;
        while (i < src.length && isWhitespace(src[i])) i++;
        const value = src.slice(start, i);
        tokens.push({ type: "ws", value, hasNewline: value.includes("\n") });
        continue;
      }

      if (ch === "-" && src[i + 1] === "-") {
        const start = i;
        // Long comment?
        if (src[i + 2] === "[") {
          const lb = readLongBracket(src, i + 2);
          if (lb) {
            const value = src.slice(start, lb.end);
            tokens.push({ type: "comment", value, directive: value.startsWith("--!") });
            i = lb.end;
            continue;
          }
        }

        // Line comment
        i += 2;
        while (i < src.length && src[i] !== "\n") i++;
        const value = src.slice(start, i);
        tokens.push({ type: "comment", value, directive: value.startsWith("--!") });
        continue;
      }

      if (ch === "\"" || ch === "'") {
        const quote = ch;
        const start = i;
        i++;
        while (i < src.length) {
          const c = src[i];
          if (c === "\\") {
            i += 2;
            continue;
          }
          i++;
          if (c === quote) break;
        }
        tokens.push({ type: "string", value: src.slice(start, i) });
        continue;
      }

      if (ch === "`") {
        const start = i;
        i++;
        while (i < src.length) {
          const c = src[i];
          if (c === "\\") {
            i += 2;
            continue;
          }
          i++;
          if (c === "`") break;
        }
        tokens.push({ type: "btstring", value: src.slice(start, i) });
        continue;
      }

      if (ch === "[") {
        const lb = readLongBracket(src, i);
        if (lb) {
          tokens.push({ type: "string", value: lb.value });
          i = lb.end;
          continue;
        }
      }

      if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]))) {
        const start = i;
        if (ch === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
          i += 2;
          while (i < src.length && /[0-9a-fA-F]/.test(src[i])) i++;
          if (src[i] === ".") {
            i++;
            while (i < src.length && /[0-9a-fA-F]/.test(src[i])) i++;
          }
          if (src[i] === "p" || src[i] === "P") {
            i++;
            if (src[i] === "+" || src[i] === "-") i++;
            while (i < src.length && isDigit(src[i])) i++;
          }
        } else {
          while (i < src.length && isDigit(src[i])) i++;
          if (src[i] === ".") {
            i++;
            while (i < src.length && isDigit(src[i])) i++;
          }
          if (src[i] === "e" || src[i] === "E") {
            i++;
            if (src[i] === "+" || src[i] === "-") i++;
            while (i < src.length && isDigit(src[i])) i++;
          }
        }
        tokens.push({ type: "number", value: src.slice(start, i) });
        continue;
      }

      if (isIdentStart(ch)) {
        const start = i;
        i++;
        while (i < src.length && isIdentPart(src[i])) i++;
        const word = src.slice(start, i);
        tokens.push({ type: KEYWORDS.has(word) ? "keyword" : "ident", value: word });
        continue;
      }

      let matched = false;
      for (const sym of multi) {
        if (src.startsWith(sym, i)) {
          tokens.push({ type: "symbol", value: sym });
          i += sym.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      tokens.push({ type: "symbol", value: ch });
      i++;
    }

    return tokens;
  }

  function obfuscateLuau(src, opts) {
    const tokens = tokenizeLuau(src);
    const warnings = [];

    const hasBacktick = tokens.some((t) => t.type === "btstring");
    let renameLocals = !!opts?.renameLocals;
    if (hasBacktick && renameLocals) {
      renameLocals = false;
      warnings.push("Detected Luau backtick strings; local renaming disabled to avoid breaking interpolation.");
    }

    const usedNames = new Set();
    for (const t of tokens) {
      if (t.type === "ident") usedNames.add(t.value);
    }

    let nameCounter = 0;
    function nextObfName() {
      while (true) {
        const name = `__luauobf_${nameCounter++}`;
        if (!KEYWORDS.has(name) && !usedNames.has(name)) {
          usedNames.add(name);
          return name;
        }
      }
    }

    const scopeStack = [{ active: new Map(), pending: new Map() }];
    const blockStack = [];

    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;

    let prevOutKind = null;
    let prevOutText = "";

    function outKindFor(tokType, tokText) {
      if (tokType === "ident" || tokType === "keyword" || tokType === "number") return "word";
      if (tokType === "string" || tokType === "btstring") return "word";
      if (tokText === "-") return "minus";
      return "sym";
    }

    function needsSpace(prevKind, prevText, nextKind, nextText) {
      if (!prevKind) return false;
      if (prevKind === "word" && nextKind === "word") return true;
      if (prevText === "-" && nextText === "-") return true;
      return false;
    }

    const out = [];

    function emitRaw(text, kind, rawTextForSpace) {
      const nextKind = kind;
      const nextText = rawTextForSpace ?? text;
      if (needsSpace(prevOutKind, prevOutText, nextKind, nextText)) out.push(" ");
      out.push(text);
      prevOutKind = nextKind;
      prevOutText = nextText;
    }

    function emitNewline() {
      out.push("\n");
      prevOutKind = null;
      prevOutText = "";
    }

    function skipTrivia(i) {
      while (i < tokens.length && (tokens[i].type === "ws" || tokens[i].type === "comment")) i++;
      return i;
    }

    function peekNonTrivia(i) {
      const j = skipTrivia(i);
      return j < tokens.length ? { tok: tokens[j], index: j } : null;
    }

    function resolveName(name) {
      // Current scope ignores pending (so initializers keep outer bindings).
      const currentIdx = scopeStack.length - 1;
      for (let i = currentIdx; i >= 0; i--) {
        const scope = scopeStack[i];
        if (scope.active.has(name)) return scope.active.get(name);
        if (i !== currentIdx && scope.pending.has(name)) return scope.pending.get(name);
      }
      return null;
    }

    function declarePending(name) {
      const scope = scopeStack[scopeStack.length - 1];
      const obf = nextObfName();
      scope.pending.set(name, obf);
      return obf;
    }

    function declareActive(name) {
      const scope = scopeStack[scopeStack.length - 1];
      const obf = nextObfName();
      scope.active.set(name, obf);
      return obf;
    }

    function activatePending(names) {
      const scope = scopeStack[scopeStack.length - 1];
      for (const n of names) {
        const obf = scope.pending.get(n);
        if (!obf) continue;
        scope.pending.delete(n);
        scope.active.set(n, obf);
      }
    }

    function pushBlock(kind) {
      blockStack.push(kind);
      scopeStack.push({ active: new Map(), pending: new Map() });
    }

    function popBlock() {
      const kind = blockStack.pop();
      scopeStack.pop();
      return kind;
    }

    function isBinaryOpToken(tok) {
      if (tok.type === "keyword") return tok.value === "and" || tok.value === "or";
      if (tok.type !== "symbol") return false;
      return (
        tok.value === "+" ||
        tok.value === "-" ||
        tok.value === "*" ||
        tok.value === "/" ||
        tok.value === "//" ||
        tok.value === "%" ||
        tok.value === "^" ||
        tok.value === ".." ||
        tok.value === "<" ||
        tok.value === ">" ||
        tok.value === "<=" ||
        tok.value === ">=" ||
        tok.value === "==" ||
        tok.value === "~="
      );
    }

    function isPostfixStart(tok) {
      if (tok.type === "string" || tok.type === "btstring") return true;
      if (tok.type !== "symbol") return false;
      return tok.value === "." || tok.value === ":" || tok.value === "(" || tok.value === "[" || tok.value === "{" || tok.value === "::";
    }

    function shouldSkipRenameForIdent(i) {
      if (!renameLocals) return true;

      const tok = tokens[i];
      if (tok.type !== "ident") return true;

      // After '.' or ':' this is a field/method name.
      for (let j = i - 1; j >= 0; j--) {
        const t = tokens[j];
        if (t.type === "ws" || t.type === "comment") continue;
        if (t.type === "symbol" && (t.value === "." || t.value === ":" || t.value === "::")) return true;
        break;
      }

      // Table constructor key: { foo = 1 }
      if (braceDepth > 0) {
        let prev = null;
        for (let j = i - 1; j >= 0; j--) {
          const t = tokens[j];
          if (t.type === "ws" || t.type === "comment") continue;
          prev = t;
          break;
        }

        const next = peekNonTrivia(i + 1);
        const prevOk = prev && prev.type === "symbol" && (prev.value === "{" || prev.value === "," || prev.value === ";");
        if (prevOk && next && next.tok.type === "symbol" && next.tok.value === "=") return true;
      }

      return false;
    }

    function emitToken(i) {
      const tok = tokens[i];

      if (tok.type === "ws" || tok.type === "comment") {
        return i + 1;
      }

      if (tok.type === "symbol") {
        if (tok.value === "{") braceDepth++;
        else if (tok.value === "}") braceDepth = Math.max(0, braceDepth - 1);
        else if (tok.value === "(") parenDepth++;
        else if (tok.value === ")") parenDepth = Math.max(0, parenDepth - 1);
        else if (tok.value === "[") bracketDepth++;
        else if (tok.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      }

      if (tok.type === "ident") {
        let text = tok.value;
        if (!shouldSkipRenameForIdent(i)) {
          const mapped = resolveName(tok.value);
          if (mapped) text = mapped;
        }
        emitRaw(text, outKindFor(tok.type, tok.value), tok.value);
        return i + 1;
      }

      emitRaw(tok.value, outKindFor(tok.type, tok.value), tok.value);
      return i + 1;
    }

    function consumeTypeAnnotation(i) {
      // Called when current token is ':' (single colon) inside a local/param decl.
      // We copy type tokens without renaming until we reach ',' or ')' or '=' at depth 0.
      let angle = 0;
      let paren = 0;
      let brace = 0;
      let bracket = 0;

      while (i < tokens.length) {
        const t = tokens[i];
        if (t.type === "ws" || t.type === "comment") {
          i++;
          continue;
        }

        if (t.type === "symbol") {
          if (t.value === "<") angle++;
          else if (t.value === ">") angle = Math.max(0, angle - 1);
          else if (t.value === "(") paren++;
          else if (t.value === ")") {
            if (angle === 0 && brace === 0 && bracket === 0 && paren === 0) break;
            paren = Math.max(0, paren - 1);
          } else if (t.value === "{") brace++;
          else if (t.value === "}") brace = Math.max(0, brace - 1);
          else if (t.value === "[") bracket++;
          else if (t.value === "]") bracket = Math.max(0, bracket - 1);

          if (angle === 0 && paren === 0 && brace === 0 && bracket === 0 && (t.value === "," || t.value === "=")) {
            break;
          }
        }

        emitRaw(t.value, outKindFor(t.type, t.value), t.value);
        i++;
      }

      return i;
    }

    function processFunction(i, localFunctionName) {
      // tokens[i] is 'function'
      i = emitToken(i); // 'function'

      i = skipTrivia(i);
      const next = tokens[i];

      // Named function statement: function name(.name|:name)* ( ... )
      if (next && next.type === "ident") {
        const nameTok = next;
        const obf = localFunctionName ? declareActive(nameTok.value) : resolveName(nameTok.value);
        const firstName = localFunctionName ? obf : obf || nameTok.value;

        emitRaw(firstName, "word", nameTok.value);
        i++;

        // field chain
        while (true) {
          i = skipTrivia(i);
          const op = tokens[i];
          if (!op || op.type !== "symbol" || (op.value !== "." && op.value !== ":")) break;
          emitRaw(op.value, "sym", op.value);
          i++;

          i = skipTrivia(i);
          const field = tokens[i];
          if (!field || field.type !== "ident") break;
          // Field/method name: do not rename
          emitRaw(field.value, "word", field.value);
          i++;
        }
      }

      // Push function scope/block and parse params
      pushBlock("function");

      i = skipTrivia(i);
      const open = tokens[i];
      if (!open || open.type !== "symbol" || open.value !== "(") {
        // Invalid, but keep going.
        return i;
      }
      emitRaw("(", "sym", "(");
      parenDepth++;
      i++;

      // Params
      while (i < tokens.length) {
        i = skipTrivia(i);
        const t = tokens[i];
        if (!t) break;
        if (t.type === "symbol" && t.value === ")") {
          emitRaw(")", "sym", ")");
          parenDepth = Math.max(0, parenDepth - 1);
          i++;
          break;
        }

        if (t.type === "symbol" && t.value === ",") {
          emitRaw(",", "sym", ",");
          i++;
          continue;
        }

        if (t.type === "symbol" && t.value === "...") {
          emitRaw("...", "word", "...");
          i++;
          continue;
        }

        if (t.type === "ident") {
          const obfParam = renameLocals ? declareActive(t.value) : t.value;
          emitRaw(obfParam, "word", t.value);
          i++;

          i = skipTrivia(i);
          const maybeColon = tokens[i];
          if (maybeColon && maybeColon.type === "symbol" && maybeColon.value === ":") {
            emitRaw(":", "sym", ":");
            i++;
            i = consumeTypeAnnotation(i);
          }
          continue;
        }

        // Fallback: emit token
        i = emitToken(i);
      }

      return i;
    }

    function consumeExpressionList(i) {
      const startBlockDepth = blockStack.length;
      const baseBrace = braceDepth;
      const baseParen = parenDepth;
      const baseBracket = bracketDepth;

      let expectValue = true;

      while (i < tokens.length) {
        i = skipTrivia(i);
        if (i >= tokens.length) break;

        const deeper =
          blockStack.length > startBlockDepth ||
          braceDepth !== baseBrace ||
          parenDepth !== baseParen ||
          bracketDepth !== baseBracket;

        const t = tokens[i];

        if (!deeper && t.type === "symbol" && t.value === "," && expectValue === false) {
          emitRaw(",", "sym", ",");
          i++;
          expectValue = true;
          continue;
        }

        // Special handlers that can appear while consuming initializers
        if (t.type === "keyword") {
          if (t.value === "function") {
            i = processFunction(i, false);
            // Function expression value completes at its matching 'end' (handled later).
            expectValue = true;
            continue;
          }
          if (t.value === "local") {
            i = processLocalStatement(i);
            expectValue = true;
            continue;
          }
          if (t.value === "for") {
            i = processForStatement(i);
            expectValue = true;
            continue;
          }
          if (t.value === "repeat") {
            emitRaw("repeat", "word", "repeat");
            pushBlock("repeat");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "until") {
            i = processUntil(i);
            expectValue = true;
            continue;
          }
          if (t.value === "then") {
            emitRaw("then", "word", "then");
            pushBlock("ifseg");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "else") {
            // close previous if segment
            if (blockStack[blockStack.length - 1] === "ifseg") popBlock();
            emitRaw("else", "word", "else");
            pushBlock("ifseg");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "elseif") {
            if (blockStack[blockStack.length - 1] === "ifseg") popBlock();
            emitRaw("elseif", "word", "elseif");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "do") {
            emitRaw("do", "word", "do");
            pushBlock("do");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "end") {
            emitRaw("end", "word", "end");
            const popped = blockStack.length ? popBlock() : null;
            i++;
            if (popped === "function") expectValue = false;
            continue;
          }
        }

        // Unary operators
        if (expectValue && t.type === "symbol" && (t.value === "-" || t.value === "#")) {
          i = emitToken(i);
          expectValue = true;
          continue;
        }
        if (expectValue && t.type === "keyword" && t.value === "not") {
          i = emitToken(i);
          expectValue = true;
          continue;
        }

        // Binary operators / postfix
        if (!expectValue && (isBinaryOpToken(t) || isPostfixStart(t))) {
          i = emitToken(i);
          expectValue = true;
          continue;
        }

        // Value-ish tokens
        i = emitToken(i);

        if (
            t.type === "ident" ||
            t.type === "number" ||
            t.type === "string" ||
            t.type === "btstring" ||
            (t.type === "keyword" && (t.value === "nil" || t.value === "true" || t.value === "false")) ||
            (t.type === "symbol" && t.value === "...") ||
            (t.type === "symbol" && t.value === ")") ||
            (t.type === "symbol" && t.value === "]") ||
            (t.type === "symbol" && t.value === "}")
          ) {
            expectValue = false;
          } else if (t.type === "symbol" && (t.value === "(" || t.value === "{" || t.value === "[")) {
            expectValue = true;
          }

        if (!deeper) {
          // End of expression list?
          if (
            blockStack.length === startBlockDepth &&
            braceDepth === baseBrace &&
            parenDepth === baseParen &&
            bracketDepth === baseBracket &&
            expectValue === false
          ) {
            const next = peekNonTrivia(i);
            if (!next) break;
            if (next.tok.type === "symbol" && next.tok.value === ",") {
              // handled in next iteration
            } else if (isBinaryOpToken(next.tok) || isPostfixStart(next.tok)) {
              // expression continues
            } else {
              break;
            }
          }
        }
      }

      return i;
    }

    function processLocalStatement(i) {
      // 'local'
      i = emitToken(i);
      i = skipTrivia(i);

      const next = tokens[i];
      if (next && next.type === "keyword" && next.value === "function") {
        i = processFunction(i, true);
        return i;
      }

      const declared = [];

      while (i < tokens.length) {
        i = skipTrivia(i);
        const t = tokens[i];
        if (!t || t.type !== "ident") break;

        const obf = renameLocals ? declarePending(t.value) : t.value;
        declared.push(t.value);
        emitRaw(obf, "word", t.value);
        i++;

        i = skipTrivia(i);
        const maybeColon = tokens[i];
        if (maybeColon && maybeColon.type === "symbol" && maybeColon.value === ":") {
          emitRaw(":", "sym", ":");
          i++;
          i = consumeTypeAnnotation(i);
        }

        i = skipTrivia(i);
        const comma = tokens[i];
        if (comma && comma.type === "symbol" && comma.value === ",") {
          emitRaw(",", "sym", ",");
          i++;
          continue;
        }
        break;
      }

      i = skipTrivia(i);
      const eq = tokens[i];
      if (eq && eq.type === "symbol" && eq.value === "=") {
        emitRaw("=", "sym", "=");
        i++;
        i = consumeExpressionList(i);
      }

      if (renameLocals && declared.length) activatePending(declared);
      return i;
    }

    function processForStatement(i) {
      // 'for'
      i = emitToken(i);
      i = skipTrivia(i);

      const forVars = new Map();
      while (i < tokens.length) {
        i = skipTrivia(i);
        const t = tokens[i];
        if (!t || t.type !== "ident") break;

        const obf = renameLocals ? nextObfName() : t.value;
        forVars.set(t.value, obf);
        emitRaw(obf, "word", t.value);
        i++;

        i = skipTrivia(i);
        const comma = tokens[i];
        if (comma && comma.type === "symbol" && comma.value === ",") {
          emitRaw(",", "sym", ",");
          i++;
          continue;
        }
        break;
      }

      // Copy header tokens until 'do'
      while (i < tokens.length) {
        i = skipTrivia(i);
        const t = tokens[i];
        if (!t) break;
        if (t.type === "keyword" && t.value === "do") {
          emitRaw("do", "word", "do");
          pushBlock("do");
          // Declare loop variables in body scope
          const scope = scopeStack[scopeStack.length - 1];
          for (const [orig, obf] of forVars) scope.active.set(orig, obf);
          i++;
          break;
        }

        if (t.type === "keyword" && t.value === "function") {
          i = processFunction(i, false);
          continue;
        }

        i = emitToken(i);
      }

      return i;
    }

    function consumeSingleExpression(i) {
      const startBlockDepth = blockStack.length;
      const baseBrace = braceDepth;
      const baseParen = parenDepth;
      const baseBracket = bracketDepth;

      let expectValue = true;

      while (i < tokens.length) {
        i = skipTrivia(i);
        if (i >= tokens.length) break;

        const deeper =
          blockStack.length > startBlockDepth ||
          braceDepth !== baseBrace ||
          parenDepth !== baseParen ||
          bracketDepth !== baseBracket;

        const t = tokens[i];

        if (t.type === "keyword") {
          if (t.value === "function") {
            i = processFunction(i, false);
            expectValue = true;
            continue;
          }
          if (t.value === "local") {
            i = processLocalStatement(i);
            expectValue = true;
            continue;
          }
          if (t.value === "for") {
            i = processForStatement(i);
            expectValue = true;
            continue;
          }
          if (t.value === "repeat") {
            emitRaw("repeat", "word", "repeat");
            pushBlock("repeat");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "until") {
            i = processUntil(i);
            expectValue = true;
            continue;
          }
          if (t.value === "then") {
            emitRaw("then", "word", "then");
            pushBlock("ifseg");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "else") {
            if (blockStack[blockStack.length - 1] === "ifseg") popBlock();
            emitRaw("else", "word", "else");
            pushBlock("ifseg");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "elseif") {
            if (blockStack[blockStack.length - 1] === "ifseg") popBlock();
            emitRaw("elseif", "word", "elseif");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "do") {
            emitRaw("do", "word", "do");
            pushBlock("do");
            i++;
            expectValue = true;
            continue;
          }
          if (t.value === "end") {
            emitRaw("end", "word", "end");
            const popped = blockStack.length ? popBlock() : null;
            i++;
            if (popped === "function") expectValue = false;
            continue;
          }
        }

        if (expectValue && t.type === "symbol" && (t.value === "-" || t.value === "#")) {
          i = emitToken(i);
          expectValue = true;
          continue;
        }
        if (expectValue && t.type === "keyword" && t.value === "not") {
          i = emitToken(i);
          expectValue = true;
          continue;
        }
        if (!expectValue && (isBinaryOpToken(t) || isPostfixStart(t))) {
          i = emitToken(i);
          expectValue = true;
          continue;
        }

        i = emitToken(i);

        if (
            t.type === "ident" ||
            t.type === "number" ||
            t.type === "string" ||
            t.type === "btstring" ||
            (t.type === "keyword" && (t.value === "nil" || t.value === "true" || t.value === "false")) ||
            (t.type === "symbol" && t.value === "...") ||
            (t.type === "symbol" && t.value === ")") ||
            (t.type === "symbol" && t.value === "]") ||
            (t.type === "symbol" && t.value === "}")
          ) {
            expectValue = false;
          }

        if (!deeper) {
          if (
            blockStack.length === startBlockDepth &&
            braceDepth === baseBrace &&
            parenDepth === baseParen &&
            bracketDepth === baseBracket &&
            expectValue === false
          ) {
            const next = peekNonTrivia(i);
            if (!next) break;
            if (isBinaryOpToken(next.tok) || isPostfixStart(next.tok)) {
              // continues
            } else {
              break;
            }
          }
        }
      }

      return i;
    }

    function processUntil(i) {
      // 'until' closes the nearest repeat after its condition.
      i = emitToken(i);
      i = consumeSingleExpression(i);

      if (blockStack[blockStack.length - 1] === "repeat") {
        popBlock();
      }
      return i;
    }

    // Emit directive comments at the very top (ensure newline so they don't comment-out code).
    let started = false;
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.type === "ws") {
        i++;
        continue;
      }
      if (t.type === "comment" && t.directive && !started) {
        emitRaw(t.value, "sym", t.value);
        emitNewline();
        i++;
        continue;
      }
      if (t.type === "comment") {
        i++;
        continue;
      }
      started = true;
      break;
    }

    while (i < tokens.length) {
      const t = tokens[i];

      if (t.type === "ws" || t.type === "comment") {
        i++;
        continue;
      }

      if (t.type === "keyword") {
        if (t.value === "local") {
          i = processLocalStatement(i);
          continue;
        }
        if (t.value === "for") {
          i = processForStatement(i);
          continue;
        }
        if (t.value === "function") {
          i = processFunction(i, false);
          continue;
        }
        if (t.value === "repeat") {
          emitRaw("repeat", "word", "repeat");
          pushBlock("repeat");
          i++;
          continue;
        }
        if (t.value === "until") {
          i = processUntil(i);
          continue;
        }
        if (t.value === "then") {
          emitRaw("then", "word", "then");
          pushBlock("ifseg");
          i++;
          continue;
        }
        if (t.value === "else") {
          if (blockStack[blockStack.length - 1] === "ifseg") popBlock();
          emitRaw("else", "word", "else");
          pushBlock("ifseg");
          i++;
          continue;
        }
        if (t.value === "elseif") {
          if (blockStack[blockStack.length - 1] === "ifseg") popBlock();
          emitRaw("elseif", "word", "elseif");
          i++;
          continue;
        }
        if (t.value === "do") {
          emitRaw("do", "word", "do");
          pushBlock("do");
          i++;
          continue;
        }
        if (t.value === "end") {
          emitRaw("end", "word", "end");
          if (blockStack.length) {
            const top = blockStack[blockStack.length - 1];
            if (top !== "repeat") popBlock();
          }
          i++;
          continue;
        }
      }

      i = emitToken(i);
    }

    return { code: out.join(""), warnings };
  }

  async function copyFromElementId(id) {
    const el = $(id);
    const value = "value" in el ? el.value : el.textContent;
    if (!value) {
      showToast("Nothing to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      showToast("Copied.");
      return;
    } catch {
      // fallthrough
    }

    try {
      if ("select" in el) {
        el.focus();
        el.select();
      } else {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      const ok = document.execCommand("copy");
      showToast(ok ? "Copied." : "Copy failed. Select and copy manually.");
    } catch {
      showToast("Copy failed. Select and copy manually.");
    }
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function sampleScript() {
    return [
      "local Players = game:GetService(\"Players\")",
      "",
      "Players.PlayerAdded:Connect(function(player)",
      "    print((\"Hello, %s!\"):format(player.Name))",
      "end)",
      "",
      "-- Tip: Obfuscate output is runnable Luau.",
    ].join("\n");
  }

  function setActiveTab(tabName) {
    for (const btn of els.tabButtons) {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }

    els.panels.obf.classList.toggle("is-active", tabName === "obf");
    els.panels.restore.classList.toggle("is-active", tabName === "restore");
  }

  async function handleObfuscate() {
    const input = (els.obfInput.value || "").trimEnd();
    if (!input.trim()) {
      showToast("Paste a script first.");
      els.obfInput.focus();
      return;
    }

    const btn = document.querySelector("[data-action='obfuscate']");
    const label = btn?.querySelector(".btn__label");
    const prevText = label?.textContent;

    try {
      if (btn) btn.disabled = true;
      if (label && prevText) label.textContent = "Working...";

      const { code, warnings } = obfuscateLuau(input, { renameLocals: true });
      const key = randomKey();

      try {
        vaultPut(key, input);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Vault save failed: ${msg}`);
        return;
      }

      els.obfOutput.value = code;
      els.obfKey.value = key;

      // Prefill restore panel.
      els.restoreKey.value = key;

      if (warnings.length) {
        showToast(warnings[0]);
      } else {
        showToast("Obfuscated. Runnable output + key generated.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg);
    } finally {
      if (btn) btn.disabled = false;
      if (label && prevText) label.textContent = prevText;
    }
  }

  async function handleRestore() {
    const key = (els.restoreKey.value || "").trim();
    if (!key) {
      showToast("Paste the key first.");
      els.restoreKey.focus();
      return;
    }

    const btn = document.querySelector("[data-action='restore']");
    const label = btn?.querySelector(".btn__label");
    const prevText = label?.textContent;

    try {
      if (btn) btn.disabled = true;
      if (label && prevText) label.textContent = "Working...";

      const rec = vaultGet(key);
      if (!rec) {
        showToast("Key not found in this browser vault.");
        return;
      }
      els.restoreOutput.value = rec.original;
      showToast("Restored original.");
    } finally {
      if (btn) btn.disabled = false;
      if (label && prevText) label.textContent = prevText;
    }
  }

  function clearObf() {
    els.obfInput.value = "";
    els.obfOutput.value = "";
    els.obfKey.value = "";
    showToast("Cleared.");
  }

  function clearRestore() {
    els.restoreKey.value = "";
    els.restoreOutput.value = "";
    showToast("Cleared.");
  }

  function swapToRestore() {
    setActiveTab("restore");
    els.restoreKey.focus();
  }

  function wireTabs() {
    for (const btn of els.tabButtons) {
      btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
    }
  }

  function wireActions() {
    document.addEventListener("click", async (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;

      const copyEl = t.closest("[data-copy]");
      if (copyEl) {
        ev.preventDefault();
        await copyFromElementId(copyEl.getAttribute("data-copy"));
        return;
      }

      const actionEl = t.closest("[data-action]");
      if (!actionEl) return;

      const action = actionEl.getAttribute("data-action");
      if (!action) return;

      ev.preventDefault();
      if (action === "fill-example") {
        els.obfInput.value = sampleScript();
        els.obfInput.focus();
        showToast("Example inserted.");
      } else if (action === "obfuscate") {
        await handleObfuscate();
      } else if (action === "restore") {
        await handleRestore();
      } else if (action === "clear-obf") {
        clearObf();
      } else if (action === "clear-restore") {
        clearRestore();
      } else if (action === "swap-to-restore") {
        swapToRestore();
      } else if (action === "download-obf") {
        const text = els.obfOutput.value;
        if (!text) return showToast("Nothing to download.");
        downloadText("obfuscated.lua", text);
        showToast("Downloaded.");
      } else if (action === "download-plain") {
        const text = els.restoreOutput.value;
        if (!text) return showToast("Nothing to download.");
        downloadText("original.lua", text);
        showToast("Downloaded.");
      }
    });
  }

  function wireShortcuts() {
    document.addEventListener("keydown", (ev) => {
      const isRun = (ev.ctrlKey || ev.metaKey) && ev.key === "Enter";
      if (!isRun) return;

      const restoreActive = els.panels.restore.classList.contains("is-active");
      ev.preventDefault();
      void (restoreActive ? handleRestore() : handleObfuscate());
    });
  }

  function init() {
    wireTabs();
    wireActions();
    wireShortcuts();

    els.obfInput.focus();
    showToast("Ready. Paste a script to begin.");
  }

  init();
})();




