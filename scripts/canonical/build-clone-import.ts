import { spawnSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyForeignKeyWaivers,
  LEGACY_CDB011_WAIVERS,
  type ForeignKeyWaiver,
} from './apply-fk-waivers';

interface SchemaObjectRow {
  name: string;
  sql: string;
}

interface ForeignKeyListRow {
  id: number;
  seq: number;
  parent_table: string;
  child_column: string;
}

interface ForeignKeyEdge {
  childTable: string;
  parentTable: string;
  columns: string[];
}

export interface BuildCloneImportOptions {
  sourceDatabase: string;
  output: string;
  manifest?: string;
  waivers: ForeignKeyWaiver[];
}

export interface BuildCloneImportResult {
  output: string;
  manifest?: string;
  sizeBytes: number;
  tableCount: number;
  indexCount: number;
  triggerCount: number;
  viewCount: number;
  manualWaiverCount: number;
  graphWaiverCount: number;
  waiverCount: number;
  orderedTableCount: number;
}

function runSqlite(args: string[]): string {
  const result = spawnSync('sqlite3', args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `sqlite3 failed (${result.status}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
}

function parseJsonRows<T>(text: string, label: string): T[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`sqlite3 ${label} output was not an array`);
  }
  return parsed as T[];
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function readSchemaObjects(
  database: string,
  type: 'table' | 'index' | 'trigger' | 'view',
): SchemaObjectRow[] {
  const sql = `SELECT name, sql FROM sqlite_schema WHERE type='${type}' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name;`;
  return parseJsonRows<SchemaObjectRow>(
    runSqlite(['-json', database, sql]),
    `${type} schema`,
  );
}

function readForeignKeyEdges(
  database: string,
  tables: string[],
): ForeignKeyEdge[] {
  const edges: ForeignKeyEdge[] = [];
  for (const table of tables) {
    const rows = parseJsonRows<ForeignKeyListRow>(
      runSqlite([
        '-json',
        database,
        `SELECT id, seq, "table" AS parent_table, "from" AS child_column FROM pragma_foreign_key_list(${quoteSqlString(table)}) ORDER BY id, seq;`,
      ]),
      `foreign keys for ${table}`,
    );
    const grouped = new Map<number, ForeignKeyListRow[]>();
    for (const row of rows) {
      const group = grouped.get(Number(row.id)) ?? [];
      group.push(row);
      grouped.set(Number(row.id), group);
    }
    for (const group of grouped.values()) {
      edges.push({
        childTable: table,
        parentTable: group[0].parent_table,
        columns: group
          .sort((left, right) => Number(left.seq) - Number(right.seq))
          .map((row) => row.child_column),
      });
    }
  }
  return edges;
}

function waiverColumns(waiver: ForeignKeyWaiver): string[] {
  return waiver.columns ?? [waiver.column];
}

function edgeMatchesWaiver(
  edge: ForeignKeyEdge,
  waiver: ForeignKeyWaiver,
): boolean {
  const columns = waiverColumns(waiver);
  return (
    edge.childTable === waiver.table &&
    edge.parentTable === waiver.parentTable &&
    edge.columns.length === columns.length &&
    edge.columns.every((column, index) => column === columns[index])
  );
}

function stronglyConnectedComponents(
  tables: string[],
  edges: ForeignKeyEdge[],
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const table of tables) adjacency.set(table, []);
  for (const edge of edges) {
    if (adjacency.has(edge.childTable) && adjacency.has(edge.parentTable)) {
      adjacency.get(edge.childTable)?.push(edge.parentTable);
    }
  }
  for (const neighbors of adjacency.values()) neighbors.sort();

  let currentIndex = 0;
  const indexByTable = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (table: string): void => {
    indexByTable.set(table, currentIndex);
    lowLink.set(table, currentIndex);
    currentIndex += 1;
    stack.push(table);
    onStack.add(table);

    for (const neighbor of adjacency.get(table) ?? []) {
      if (!indexByTable.has(neighbor)) {
        visit(neighbor);
        lowLink.set(
          table,
          Math.min(lowLink.get(table) ?? 0, lowLink.get(neighbor) ?? 0),
        );
      } else if (onStack.has(neighbor)) {
        lowLink.set(
          table,
          Math.min(lowLink.get(table) ?? 0, indexByTable.get(neighbor) ?? 0),
        );
      }
    }

    if (lowLink.get(table) === indexByTable.get(table)) {
      const component: string[] = [];
      while (stack.length > 0) {
        const member = stack.pop();
        if (!member) break;
        onStack.delete(member);
        component.push(member);
        if (member === table) break;
      }
      components.push(component.sort());
    }
  };

  for (const table of [...tables].sort()) {
    if (!indexByTable.has(table)) visit(table);
  }
  return components;
}

function buildGraphWaivers(
  tables: string[],
  edges: ForeignKeyEdge[],
  manualWaivers: ForeignKeyWaiver[],
): ForeignKeyWaiver[] {
  const activeEdges = edges.filter(
    (edge) => !manualWaivers.some((waiver) => edgeMatchesWaiver(edge, waiver)),
  );
  const components = stronglyConnectedComponents(tables, activeEdges);
  const componentByTable = new Map<string, string[]>();
  for (const component of components) {
    for (const table of component) componentByTable.set(table, component);
  }

  return activeEdges
    .filter((edge) => {
      const component = componentByTable.get(edge.childTable) ?? [];
      return (
        edge.childTable === edge.parentTable ||
        (component.length > 1 && component.includes(edge.parentTable))
      );
    })
    .map((edge) => ({
      table: edge.childTable,
      column: edge.columns[0],
      columns: edge.columns,
      parentTable: edge.parentTable,
      reason:
        'D1 chunked import cycle-breaking waiver; source FK remains documented in the manifest',
    }))
    .sort((left, right) =>
      `${left.table}:${waiverColumns(left).join(',')}:${left.parentTable}`.localeCompare(
        `${right.table}:${waiverColumns(right).join(',')}:${right.parentTable}`,
      ),
    );
}

function topologicalTableOrder(
  tables: string[],
  edges: ForeignKeyEdge[],
  waivers: ForeignKeyWaiver[],
): string[] {
  const tableSet = new Set(tables);
  const dependencies = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  for (const table of tables) {
    dependencies.set(table, new Set());
    children.set(table, new Set());
  }
  for (const edge of edges) {
    if (!tableSet.has(edge.parentTable)) continue;
    if (waivers.some((waiver) => edgeMatchesWaiver(edge, waiver))) continue;
    dependencies.get(edge.childTable)?.add(edge.parentTable);
    children.get(edge.parentTable)?.add(edge.childTable);
  }

  const ready = tables
    .filter((table) => (dependencies.get(table)?.size ?? 0) === 0)
    .sort();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const table = ready.shift();
    if (!table) break;
    ordered.push(table);
    for (const child of [...(children.get(table) ?? [])].sort()) {
      const childDependencies = dependencies.get(child);
      childDependencies?.delete(table);
      if (childDependencies?.size === 0 && !ordered.includes(child) && !ready.includes(child)) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  if (ordered.length !== tables.length) {
    const unresolved = tables.filter((table) => !ordered.includes(table)).sort();
    throw new Error(
      `Foreign-key graph remains cyclic after waivers: ${unresolved.join(', ')}`,
    );
  }
  return ordered;
}

function terminate(statement: string): string {
  const trimmed = statement.trim();
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
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
      } else if (quote !== ']' && char === quote) {
        if (next === quote) index += 1;
        else quote = null;
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
    if (char === ';') {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1).replaceAll('``', '`');
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).replaceAll(']]', ']');
  }
  return trimmed;
}

function extractInsertTable(statement: string): string | null {
  const match = /^\s*INSERT\s+INTO\s+("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[^\s(]+)/i.exec(
    statement,
  );
  return match ? unquoteIdentifier(match[1]) : null;
}

function decodeUnistrPayload(payload: string): string {
  let decoded = '';
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (char !== '\\') {
      decoded += char;
      continue;
    }

    const next = payload[index + 1];
    if (next === '\\') {
      decoded += '\\';
      index += 1;
      continue;
    }

    let hex = '';
    let consumed = 0;
    if (next === 'u') {
      hex = payload.slice(index + 2, index + 6);
      consumed = 5;
    } else if (next === 'U') {
      hex = payload.slice(index + 2, index + 10);
      consumed = 9;
    } else if (next === '+') {
      hex = payload.slice(index + 2, index + 8);
      consumed = 7;
    } else {
      hex = payload.slice(index + 1, index + 5);
      consumed = 4;
    }

    if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== consumed - 1) {
      throw new Error(
        `Unsupported SQLite unistr escape at payload offset ${index}`,
      );
    }
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new Error(
        `Invalid Unicode code point in SQLite unistr escape at payload offset ${index}`,
      );
    }
    decoded += String.fromCodePoint(codePoint);
    index += consumed;
  }
  return decoded;
}

function normalizeD1UnsupportedLiterals(statement: string): string {
  const pattern = /\bunistr\s*\(\s*'((?:''|[^'])*)'\s*\)/gi;
  return statement.replace(pattern, (_match, quotedPayload: string) => {
    const payload = quotedPayload.replaceAll("''", "'");
    const decoded = decodeUnistrPayload(payload);
    const hex = Buffer.from(decoded, 'utf8').toString('hex').toUpperCase();
    return `CAST(X'${hex}' AS TEXT)`;
  });
}

function orderedDataStatements(
  database: string,
  tableOrder: string[],
): string[] {
  const dump = runSqlite([database, '.dump --data-only --nosys']);
  const byTable = new Map<string, string[]>();
  for (const table of tableOrder) byTable.set(table, []);

  for (const statement of splitSqlStatements(dump)) {
    const table = extractInsertTable(statement);
    if (table) {
      const group = byTable.get(table);
      if (!group) throw new Error(`Data dump referenced unknown table: ${table}`);
      group.push(terminate(normalizeD1UnsupportedLiterals(statement)));
      continue;
    }
    if (/^\s*(?:PRAGMA|BEGIN|COMMIT)\b/i.test(statement)) continue;
    throw new Error(
      `Unsupported non-INSERT statement in data-only dump: ${statement.slice(0, 80)}`,
    );
  }

  return tableOrder.flatMap((table) => byTable.get(table) ?? []);
}

function renderSection(label: string, statements: string[]): string {
  if (statements.length === 0) return `-- ${label}: none\n`;
  return `-- ${label}\n${statements.map(terminate).join('\n')}\n`;
}

export function buildCloneImportBundle(
  options: BuildCloneImportOptions,
): BuildCloneImportResult {
  const sourceDatabase = resolve(options.sourceDatabase);
  const output = resolve(options.output);
  const manifest = options.manifest ? resolve(options.manifest) : undefined;
  if (!existsSync(sourceDatabase)) {
    throw new Error(`Source SQLite database not found: ${sourceDatabase}`);
  }
  if (existsSync(output)) {
    throw new Error(`Refusing to overwrite clone import bundle: ${output}`);
  }
  if (manifest && existsSync(manifest)) {
    throw new Error(`Refusing to overwrite clone import manifest: ${manifest}`);
  }

  const tables = readSchemaObjects(sourceDatabase, 'table');
  const indexes = readSchemaObjects(sourceDatabase, 'index');
  const triggers = readSchemaObjects(sourceDatabase, 'trigger');
  const views = readSchemaObjects(sourceDatabase, 'view');
  const tableNames = tables.map((row) => row.name);
  const tableByName = new Map(tables.map((row) => [row.name, row]));
  const edges = readForeignKeyEdges(sourceDatabase, tableNames);
  const graphWaivers = buildGraphWaivers(tableNames, edges, options.waivers);
  const allWaivers = [...options.waivers, ...graphWaivers];
  const tableOrder = topologicalTableOrder(tableNames, edges, allWaivers);

  const tableStatements = tableOrder.map((table) => {
    const schema = tableByName.get(table)?.sql;
    if (!schema) throw new Error(`Missing CREATE TABLE SQL for ${table}`);
    const tableWaivers = allWaivers.filter((waiver) => waiver.table === table);
    return tableWaivers.length > 0
      ? applyForeignKeyWaivers(terminate(schema), tableWaivers).schemaSql
      : terminate(schema);
  });
  const dataStatements = orderedDataStatements(sourceDatabase, tableOrder);

  const bundle = [
    '-- CDB-011 topologically ordered D1 clone import bundle',
    '-- Tables precede data; data is parent-before-child; indexes, triggers, and views follow historical rows.',
    'PRAGMA defer_foreign_keys=TRUE;',
    renderSection('tables', tableStatements),
    renderSection('data', dataStatements),
    renderSection(
      'indexes',
      indexes.map((row) => row.sql),
    ),
    renderSection(
      'triggers',
      triggers.map((row) => row.sql),
    ),
    renderSection(
      'views',
      views.map((row) => row.sql),
    ),
  ].join('\n');

  writeFileSync(output, `${bundle.trim()}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });

  if (manifest) {
    writeFileSync(
      manifest,
      `${JSON.stringify(
        {
          generatedAtUtc: new Date().toISOString(),
          sourceDatabase,
          output,
          tableOrder,
          manualWaivers: options.waivers,
          graphWaivers,
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
  }

  return {
    output,
    manifest,
    sizeBytes: statSync(output).size,
    tableCount: tables.length,
    indexCount: indexes.length,
    triggerCount: triggers.length,
    viewCount: views.length,
    manualWaiverCount: options.waivers.length,
    graphWaiverCount: graphWaivers.length,
    waiverCount: allWaivers.length,
    orderedTableCount: tableOrder.length,
  };
}

interface CliOptions {
  sourceDatabase: string;
  output: string;
  manifest?: string;
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
  const sourceDatabase = values.get('--source-db');
  const output = values.get('--output');
  if (!sourceDatabase || !output) {
    throw new Error(
      'Required arguments: --source-db <sqlite> --output <bundle.sql> [--manifest <json>]',
    );
  }
  return {
    sourceDatabase,
    output,
    manifest: values.get('--manifest'),
  };
}

function main(): void {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = buildCloneImportBundle({
      ...options,
      waivers: LEGACY_CDB011_WAIVERS,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Clone import bundle generation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
