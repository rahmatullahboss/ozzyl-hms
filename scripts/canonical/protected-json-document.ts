import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type ProtectedJsonDocumentIssueCode =
  | 'INVALID_JSON'
  | 'DUPLICATE_KEY'
  | 'UNSAFE_KEY'
  | 'TOO_LARGE'
  | 'TOO_DEEP'
  | 'FILE_UNAVAILABLE'
  | 'FILE_INSIDE_REPOSITORY'
  | 'FILE_PROTECTION_INVALID';

export interface ProtectedJsonDocumentIssue {
  code: ProtectedJsonDocumentIssueCode;
  gate: 'document' | 'file';
}

export interface ProtectedJsonDocumentResult {
  ready: boolean;
  value: unknown | null;
  issues: ProtectedJsonDocumentIssue[];
}

export interface ProtectedJsonDocumentOptions {
  maxBytes: number;
  maxDepth: number;
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

interface JsonScanResult {
  duplicateKey: boolean;
  unsafeKey: boolean;
  tooDeep: boolean;
  valid: boolean;
}

class JsonStructureScanner {
  private index = 0;
  private duplicateKey = false;
  private unsafeKey = false;
  private tooDeep = false;

  constructor(
    private readonly text: string,
    private readonly maxDepth: number,
  ) {}

  scan(): JsonScanResult {
    try {
      this.skipWhitespace();
      this.parseValue(0);
      this.skipWhitespace();
      if (this.index !== this.text.length) throw new Error('trailing');
      return {
        duplicateKey: this.duplicateKey,
        unsafeKey: this.unsafeKey,
        tooDeep: this.tooDeep,
        valid: true,
      };
    } catch {
      return {
        duplicateKey: this.duplicateKey,
        unsafeKey: this.unsafeKey,
        tooDeep: this.tooDeep,
        valid: false,
      };
    }
  }

  private parseValue(depth: number): void {
    if (depth > this.maxDepth) {
      this.tooDeep = true;
      throw new Error('depth');
    }
    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === '{') return this.parseObject(depth + 1);
    if (char === '[') return this.parseArray(depth + 1);
    if (char === '"') {
      this.parseString();
      return;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      this.parseNumber();
      return;
    }
    if (this.text.startsWith('true', this.index)) {
      this.index += 4;
      return;
    }
    if (this.text.startsWith('false', this.index)) {
      this.index += 5;
      return;
    }
    if (this.text.startsWith('null', this.index)) {
      this.index += 4;
      return;
    }
    throw new Error('value');
  }

  private parseObject(depth: number): void {
    this.expect('{');
    this.skipWhitespace();
    if (this.peek('}')) {
      this.index += 1;
      return;
    }
    const keys = new Set<string>();
    while (true) {
      this.skipWhitespace();
      const key = this.parseString();
      if (keys.has(key)) this.duplicateKey = true;
      keys.add(key);
      if (UNSAFE_KEYS.has(key)) this.unsafeKey = true;
      this.skipWhitespace();
      this.expect(':');
      this.parseValue(depth);
      this.skipWhitespace();
      if (this.peek('}')) {
        this.index += 1;
        return;
      }
      this.expect(',');
    }
  }

  private parseArray(depth: number): void {
    this.expect('[');
    this.skipWhitespace();
    if (this.peek(']')) {
      this.index += 1;
      return;
    }
    while (true) {
      this.parseValue(depth);
      this.skipWhitespace();
      if (this.peek(']')) {
        this.index += 1;
        return;
      }
      this.expect(',');
    }
  }

  private parseString(): string {
    const start = this.index;
    this.expect('"');
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (char === '"') {
        this.index += 1;
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
      if (char === '\\') {
        this.index += 1;
        const escape = this.text[this.index];
        if (escape === 'u') {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('escape');
          this.index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape ?? '')) throw new Error('escape');
        this.index += 1;
        continue;
      }
      if (!char || char.charCodeAt(0) < 0x20) throw new Error('string');
      this.index += 1;
    }
    throw new Error('string');
  }

  private parseNumber(): void {
    const remaining = this.text.slice(this.index);
    const match = remaining.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error('number');
    this.index += match[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.text[this.index] ?? '')) this.index += 1;
  }

  private expect(char: string): void {
    if (this.text[this.index] !== char) throw new Error('token');
    this.index += 1;
  }

  private peek(char: string): boolean {
    return this.text[this.index] === char;
  }
}

function failure(
  code: ProtectedJsonDocumentIssueCode,
  gate: 'document' | 'file' = 'document',
): ProtectedJsonDocumentResult {
  return { ready: false, value: null, issues: [{ code, gate }] };
}

function isInside(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value.length > 0 && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

export function containsNormalizedKey(
  value: unknown,
  keys: ReadonlySet<string>,
): boolean {
  const visit = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.some(visit);
    if (!item || typeof item !== 'object') return false;
    return Object.entries(item as Record<string, unknown>).some(([key, child]) => (
      keys.has(key.replace(/[_-]/g, '').toLowerCase()) || visit(child)
    ));
  };
  return visit(value);
}

export function parseStrictJsonDocument(
  text: string,
  options: ProtectedJsonDocumentOptions,
): ProtectedJsonDocumentResult {
  if (Buffer.byteLength(text, 'utf8') > options.maxBytes) return failure('TOO_LARGE');
  const scan = new JsonStructureScanner(text, options.maxDepth).scan();
  if (scan.tooDeep) return failure('TOO_DEEP');
  if (!scan.valid) return failure('INVALID_JSON');
  if (scan.duplicateKey) return failure('DUPLICATE_KEY');
  if (scan.unsafeKey) return failure('UNSAFE_KEY');
  try {
    return { ready: true, value: JSON.parse(text) as unknown, issues: [] };
  } catch {
    return failure('INVALID_JSON');
  }
}

export function loadProtectedJsonDocument(
  documentPath: string,
  repositoryRoot: string,
  options: ProtectedJsonDocumentOptions,
): ProtectedJsonDocumentResult {
  let absolutePath: string;
  let repositoryReal: string;
  let parentReal: string;
  let fileReal: string;
  let initialDevice = 0;
  let initialInode = 0;
  try {
    absolutePath = resolve(documentPath);
    repositoryReal = realpathSync(repositoryRoot);
    const parent = dirname(absolutePath);
    parentReal = realpathSync(parent);
    fileReal = realpathSync(absolutePath);
    if (fileReal === repositoryReal || isInside(repositoryReal, fileReal)) {
      return failure('FILE_INSIDE_REPOSITORY', 'file');
    }
    const parentInfo = lstatSync(parent);
    if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory() || (parentInfo.mode & 0o777) !== 0o700) {
      return failure('FILE_PROTECTION_INVALID', 'file');
    }
    const fileInfo = lstatSync(absolutePath);
    if (
      fileInfo.isSymbolicLink()
      || !fileInfo.isFile()
      || (fileInfo.mode & 0o777) !== 0o600
      || fileInfo.nlink !== 1
    ) {
      return failure('FILE_PROTECTION_INVALID', 'file');
    }
    initialDevice = fileInfo.dev;
    initialInode = fileInfo.ino;
  } catch {
    return failure('FILE_UNAVAILABLE', 'file');
  }

  if (dirname(fileReal) !== parentReal) return failure('FILE_PROTECTION_INVALID', 'file');

  let descriptor: number | null = null;
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (
      !info.isFile()
      || (info.mode & 0o777) !== 0o600
      || info.nlink !== 1
      || info.dev !== initialDevice
      || info.ino !== initialInode
    ) {
      return failure('FILE_PROTECTION_INVALID', 'file');
    }
    if (info.size <= 0 || info.size > options.maxBytes) return failure('TOO_LARGE');
    return parseStrictJsonDocument(readFileSync(descriptor, 'utf8'), options);
  } catch {
    return failure('FILE_UNAVAILABLE', 'file');
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}
