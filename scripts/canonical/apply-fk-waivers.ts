import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ForeignKeyWaiver {
  table: string;
  column: string;
  columns?: string[];
  parentTable: string;
  reason: string;
}

export interface ForeignKeyWaiverResult {
  schemaSql: string;
  appliedWaivers: ForeignKeyWaiver[];
}

export const LEGACY_CDB011_WAIVERS: ForeignKeyWaiver[] = [
  {
    table: 'doctor_commission_accruals_old_0391',
    column: 'visit_id',
    parentTable: 'visits',
    reason: '15 legacy orphan rows in the production snapshot',
  },
  {
    table: 'doctor_commission_accruals_old_0391',
    column: 'bill_id',
    parentTable: 'bills',
    reason: '26 legacy orphan rows in the production snapshot',
  },
  {
    table: 'billing_deposits',
    column: 'reference_bill_id',
    parentTable: 'bills',
    reason: '4 legacy orphan rows in the production snapshot',
  },
  {
    table: 'income',
    column: 'bill_id',
    parentTable: 'bills',
    reason: '4 legacy orphan rows in the production snapshot',
  },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quotedIdentifierPattern(identifier: string): string {
  const escaped = escapeRegex(identifier);
  return `(?:"${escaped}"|\`${escaped}\`|\\[${escaped}\\]|${escaped})`;
}

function findStatementEnd(sql: string, start: number): number {
  let quote: "'" | '"' | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (quote === ']' && char === ']') {
        quote = null;
        continue;
      }
      if (quote !== ']' && char === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') {
      quote = ']';
      continue;
    }
    if (char === ';') return index + 1;
  }

  throw new Error('CREATE TABLE statement did not terminate with a semicolon');
}

function findCreateTableRange(
  sql: string,
  table: string,
): { start: number; end: number } {
  const pattern = new RegExp(
    `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${quotedIdentifierPattern(table)}\\s*\\(`,
    'i',
  );
  const match = pattern.exec(sql);
  if (!match || match.index === undefined) {
    throw new Error(`CREATE TABLE statement not found for ${table}`);
  }
  return { start: match.index, end: findStatementEnd(sql, match.index) };
}

function removeWaiverFromStatement(
  statement: string,
  waiver: ForeignKeyWaiver,
): { statement: string; matches: number } {
  const waiverColumns = waiver.columns ?? [waiver.column];
  const columnList = waiverColumns
    .map((column) => quotedIdentifierPattern(column))
    .join('\\s*,\\s*');
  const parent = quotedIdentifierPattern(waiver.parentTable);

  const tableConstraint = new RegExp(
    `,\\s*FOREIGN\\s+KEY\\s*\\(\\s*${columnList}\\s*\\)\\s+REFERENCES\\s+${parent}\\s*\\([^)]*\\)(?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+\\w+)*`,
    'gi',
  );
  const tableMatches = statement.match(tableConstraint)?.length ?? 0;
  if (tableMatches > 0) {
    return {
      statement: statement.replace(tableConstraint, ''),
      matches: tableMatches,
    };
  }

  if (waiverColumns.length !== 1) {
    return { statement, matches: 0 };
  }
  const inlineColumn = quotedIdentifierPattern(waiverColumns[0]);
  const inlineConstraint = new RegExp(
    `(${inlineColumn}\\s+[^,\\n]*?)\\s+REFERENCES\\s+${parent}\\s*\\([^)]*\\)(?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+\\w+)*`,
    'gi',
  );
  const inlineMatches = statement.match(inlineConstraint)?.length ?? 0;
  return {
    statement: statement.replace(inlineConstraint, '$1'),
    matches: inlineMatches,
  };
}

export function applyForeignKeyWaivers(
  schemaSql: string,
  waivers: ForeignKeyWaiver[],
): ForeignKeyWaiverResult {
  let transformed = schemaSql;
  const appliedWaivers: ForeignKeyWaiver[] = [];

  for (const waiver of waivers) {
    const range = findCreateTableRange(transformed, waiver.table);
    const statement = transformed.slice(range.start, range.end);
    const removal = removeWaiverFromStatement(statement, waiver);
    if (removal.matches !== 1) {
      throw new Error(
        `Waiver ${waiver.table}.${waiver.column} -> ${waiver.parentTable} matched ${removal.matches} constraints; expected exactly 1`,
      );
    }
    transformed =
      transformed.slice(0, range.start) +
      removal.statement +
      transformed.slice(range.end);
    appliedWaivers.push(waiver);
  }

  return { schemaSql: transformed, appliedWaivers };
}

interface CliOptions {
  input: string;
  output: string;
  manifest: string;
}

function parseCliArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${key} requires a value`);
    }
    values.set(key, value);
    index += 1;
  }
  const input = values.get('--input');
  const output = values.get('--output');
  const manifest = values.get('--manifest');
  if (!input || !output || !manifest) {
    throw new Error(
      'Required arguments: --input <schema.sql> --output <waived.sql> --manifest <waivers.json>',
    );
  }
  return { input, output, manifest };
}

function main(): void {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const input = resolve(options.input);
    const output = resolve(options.output);
    const manifest = resolve(options.manifest);
    if (!existsSync(input)) throw new Error(`Schema input not found: ${input}`);
    if (existsSync(output)) throw new Error(`Refusing to overwrite: ${output}`);
    if (existsSync(manifest)) throw new Error(`Refusing to overwrite: ${manifest}`);

    const result = applyForeignKeyWaivers(
      readFileSync(input, 'utf8'),
      LEGACY_CDB011_WAIVERS,
    );
    writeFileSync(output, result.schemaSql, { mode: 0o600, flag: 'wx' });
    writeFileSync(
      manifest,
      `${JSON.stringify(
        {
          generatedAtUtc: new Date().toISOString(),
          sourceSchema: input,
          waivedSchema: output,
          appliedWaivers: result.appliedWaivers,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    process.stdout.write(
      `${JSON.stringify({ output, manifest, waiverCount: result.appliedWaivers.length })}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FK waiver generation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
