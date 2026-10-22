// Avaliador de expressões das grandezas derivadas (PRD, seção 12).
// Aceita números, parênteses, + - * /, referências a grandezas e a atributos.* e as funções
// min, max e abs. Não usa eval nem Function(), e as variáveis vêm de um Map, sem protótipo.

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'neg'; operand: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { kind: 'call'; fn: FunctionName; args: Node[] };

type Token =
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'punct'; value: string };

const FUNCTIONS = {
  min: { arity: [1, Infinity], apply: (args: number[]) => Math.min(...args) },
  max: { arity: [1, Infinity], apply: (args: number[]) => Math.max(...args) },
  abs: { arity: [1, 1], apply: (args: number[]) => Math.abs(args[0]!) },
} as const;
type FunctionName = keyof typeof FUNCTIONS;

const FORBIDDEN_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const ATTRIBUTE_PREFIX = 'atributos';
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
const NUMBER = /^\d+(\.\d+)?/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let rest = source;
  while (rest.length > 0) {
    const space = /^\s+/.exec(rest);
    if (space) {
      rest = rest.slice(space[0].length);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      rest = rest.slice(number[0].length);
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      let name = ident[0];
      rest = rest.slice(name.length);
      if (rest.startsWith('.')) {
        const member = IDENT.exec(rest.slice(1));
        if (name !== ATTRIBUTE_PREFIX || !member) {
          throw new ExpressionError(`acesso a membro não permitido em "${name}"`);
        }
        name = `${name}.${member[0]}`;
        rest = rest.slice(1 + member[0].length);
      }
      for (const part of name.split('.')) {
        if (FORBIDDEN_NAMES.has(part)) throw new ExpressionError(`nome proibido: ${part}`);
      }
      tokens.push({ type: 'ident', value: name });
      continue;
    }
    const char = rest[0]!;
    if (!'+-*/(),'.includes(char)) throw new ExpressionError(`caractere não permitido: ${char}`);
    tokens.push({ type: 'punct', value: char });
    rest = rest.slice(1);
  }
  return tokens;
}

class Parser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (this.tokens.length === 0) throw new ExpressionError('expressão vazia');
    const node = this.expression();
    if (this.position < this.tokens.length) {
      throw new ExpressionError(`símbolo inesperado: ${String(this.tokens[this.position]!.value)}`);
    }
    return node;
  }

  private peek(value: string): boolean {
    const token = this.tokens[this.position];
    return token?.type === 'punct' && token.value === value;
  }

  private expect(value: string): void {
    if (!this.peek(value)) throw new ExpressionError(`esperado "${value}"`);
    this.position += 1;
  }

  private expression(): Node {
    let left = this.term();
    while (this.peek('+') || this.peek('-')) {
      const op = (this.tokens[this.position++] as { value: '+' | '-' }).value;
      left = { kind: 'binary', op, left, right: this.term() };
    }
    return left;
  }

  private term(): Node {
    let left = this.unary();
    while (this.peek('*') || this.peek('/')) {
      const op = (this.tokens[this.position++] as { value: '*' | '/' }).value;
      left = { kind: 'binary', op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.peek('-')) {
      this.position += 1;
      return { kind: 'neg', operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.tokens[this.position];
    if (!token) throw new ExpressionError('expressão incompleta');
    this.position += 1;
    if (token.type === 'number') return { kind: 'number', value: token.value };
    if (token.type === 'ident') {
      if (!this.peek('(')) return { kind: 'ref', name: token.value };
      return this.call(token.value);
    }
    if (token.value === '(') {
      const inner = this.expression();
      this.expect(')');
      return inner;
    }
    throw new ExpressionError(`símbolo inesperado: ${token.value}`);
  }

  private call(name: string): Node {
    if (!Object.hasOwn(FUNCTIONS, name)) throw new ExpressionError(`função não permitida: ${name}`);
    const fn = name as FunctionName;
    this.expect('(');
    const args: Node[] = [];
    if (!this.peek(')')) {
      args.push(this.expression());
      while (this.peek(',')) {
        this.position += 1;
        args.push(this.expression());
      }
    }
    this.expect(')');
    const [min, max] = FUNCTIONS[fn].arity;
    if (args.length < min || args.length > max) {
      throw new ExpressionError(`número de argumentos inválido em ${fn}`);
    }
    return { kind: 'call', fn, args };
  }
}

function evaluate(node: Node, variables: ReadonlyMap<string, number>): number | null {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'ref':
      return variables.get(node.name) ?? null;
    case 'neg': {
      const value = evaluate(node.operand, variables);
      return value === null ? null : -value;
    }
    case 'binary': {
      const left = evaluate(node.left, variables);
      const right = evaluate(node.right, variables);
      if (left === null || right === null) return null;
      if (node.op === '+') return left + right;
      if (node.op === '-') return left - right;
      if (node.op === '*') return left * right;
      return left / right;
    }
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, variables));
      if (args.some((arg) => arg === null)) return null;
      return FUNCTIONS[node.fn].apply(args as number[]);
    }
  }
}

function collectReferences(node: Node, into: string[]): string[] {
  if (node.kind === 'ref' && !into.includes(node.name)) into.push(node.name);
  if (node.kind === 'neg') collectReferences(node.operand, into);
  if (node.kind === 'binary') {
    collectReferences(node.left, into);
    collectReferences(node.right, into);
  }
  if (node.kind === 'call') node.args.forEach((arg) => collectReferences(arg, into));
  return into;
}

export interface CompiledExpression {
  readonly source: string;
  readonly references: string[];
  // Devolve null quando falta uma referência ou o resultado não é um número finito.
  evaluate(variables: ReadonlyMap<string, number>): number | null;
}

export function compileExpression(source: string): CompiledExpression {
  const ast = new Parser(tokenize(source)).parse();
  return {
    source,
    references: collectReferences(ast, []),
    evaluate(variables) {
      const value = evaluate(ast, variables);
      return value !== null && Number.isFinite(value) ? value : null;
    },
  };
}
