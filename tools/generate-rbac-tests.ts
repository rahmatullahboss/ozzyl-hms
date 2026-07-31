import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RouteEntry {
  file: string;
  relPath: string;
  method: string;
  path: string;
  allowedRoles: string[];
  mountPrefix: string;
}

const TENANT_ROUTES_DIR = path.resolve(__dirname, '../src/routes/tenant');
const INDEX_FILE = path.resolve(__dirname, '../src/index.ts');
const OUTPUT_TEST = path.resolve(__dirname, '../test/generated/rbac-matrix.test.ts');
const OUTPUT_DOC = path.resolve(__dirname, '../docs/rbac-permission-matrix.md');

const ALL_ROLES = [
  'super_admin', 'hospital_admin', 'doctor', 'nurse',
  'laboratory', 'reception', 'md', 'director', 'pharmacist', 'accountant',
] as const;

const WELL_KNOWN_ROLE_CONSTANTS: Record<string, readonly string[]> = {
  CLINICAL_ROLES: ['doctor', 'md', 'nurse', 'pharmacist', 'hospital_admin'],
  ADMIN_ROLES: ['hospital_admin', 'md'],
  NURSING_ROLES: ['nurse', 'doctor', 'md', 'hospital_admin'],
  OPD_ROLES: ['nurse', 'reception', 'doctor', 'hospital_admin'],
  PRESCRIBING_ROLES: ['doctor', 'md', 'pharmacist', 'hospital_admin'],
};

function buildMountMap(): Record<string, string> {
  const indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');
  const map: Record<string, string> = {};
  // Match: app.route('/api/pharmacy', pharmacyRoutes);
  // Match: app.route('/api/clinical', clinicalRoutes);
  const re = /app\.route\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
  let m;
  while ((m = re.exec(indexContent)) !== null) {
    const [, mountPath, varName] = m;
    map[varName] = mountPath;
  }
  return map;
}

function resolveImportVarName(indexContent: string, filePath: string): string | null {
  const relFromTenant = filePath;
  // Match: import pharmacyRoutes from './routes/tenant/pharmacy';
  // Match: import clinicalRoutes from './routes/tenant/clinical/index';
  const importBase = relFromTenant.replace(/\.ts$/, '').replace(/\/index$/, '');
  const patterns = [
    `routes/tenant/${importBase}`,
    `routes/tenant/${relFromTenant.replace(/\.ts$/, '')}`,
  ];
  const re = /import\s+(\w+)\s+from\s+['"]\.\/([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(indexContent)) !== null) {
    const [, varName, importPath] = m;
    for (const pattern of patterns) {
      if (importPath === pattern || importPath === `./${pattern}`) {
        return varName;
      }
    }
  }
  return null;
}

function getMountPrefix(relPath: string, mountMap: Record<string, string>): string {
  const indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');
  const varName = resolveImportVarName(indexContent, relPath);
  if (varName && mountMap[varName]) {
    return mountMap[varName];
  }
  // Fallback: derive from file name
  const base = relPath.replace(/\.ts$/, '').replace(/\/index$/, '');
  // Check common patterns
  for (const [vName, prefix] of Object.entries(mountMap)) {
    const normalizedBase = base.replace(/\//g, '-');
    if (prefix === `/api/${normalizedBase}` || prefix === `/api/${base}`) {
      return prefix;
    }
  }
  return `/api/${base}`;
}

function parseLocalConstants(content: string): Record<string, string[]> {
  const constants: Record<string, string[]> = {};
  const re = /const\s+(\w+)\s*=\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const [, name, body] = m;
    const roles = body
      .split(',')
      .map(s => s.trim().replace(/['"]/g, '').replace(/\s*as\s+const/, ''))
      .filter(s => s.length > 0);
    constants[name] = roles;
  }
  return constants;
}

function resolveRoles(args: string, localConsts: Record<string, string[]>): string[] {
  const cleaned = args.replace(/\.\.\./g, '').trim();

  const lookup = { ...WELL_KNOWN_ROLE_CONSTANTS, ...localConsts };
  if (lookup[cleaned]) {
    return [...lookup[cleaned]];
  }

  return cleaned
    .split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(s => s.length > 0 && !s.includes('('));
}

function scanRouteFile(filePath: string, relPath: string, mountPrefix: string): RouteEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath, '.ts');
  const entries: RouteEntry[] = [];
  const localConsts = parseLocalConstants(content);

  const blanketUseRe = /\.use\s*\(\s*['"]\*?\/?\*?['"]\s*,\s*requireRole\s*\(([^)]+)\)/g;
  let blanketRoles: string[] = [];
  let bm;
  while ((bm = blanketUseRe.exec(content)) !== null) {
    blanketRoles = resolveRoles(bm[1], localConsts);
  }

  const routeRe = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*requireRole\s*\(([^)]+)\)/g;
  let match;
  while ((match = routeRe.exec(content)) !== null) {
    const [, method, routePath, args] = match;
    if (routePath.includes('${')) continue;
    const allowedRoles = resolveRoles(args, localConsts);
    entries.push({
      file: fileName,
      relPath,
      method: method.toUpperCase(),
      path: routePath,
      allowedRoles,
      mountPrefix,
    });
  }

  if (blanketRoles.length > 0) {
    const unprotectedRe = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?!requireRole)/g;
    let um;
    while ((um = unprotectedRe.exec(content)) !== null) {
      const [, method, routePath] = um;
      const alreadyCaptured = entries.some(
        e => e.method === method.toUpperCase() && e.path === routePath
      );
      if (!alreadyCaptured) {
        entries.push({
          file: fileName,
          relPath,
          method: method.toUpperCase(),
          path: routePath,
          allowedRoles: blanketRoles,
          mountPrefix,
        });
      }
    }
  }

  return entries;
}

function generateTestFile(allEntries: RouteEntry[]): string {
  const byFile = new Map<string, RouteEntry[]>();
  for (const entry of allEntries) {
    const key = entry.relPath;
    const group = byFile.get(key) ?? [];
    group.push(entry);
    byFile.set(key, group);
  }

  let output = `// AUTO-GENERATED — do not edit manually.
// Regenerate: npx tsx tools/generate-rbac-tests.ts
import { describe, it, expect } from 'vitest';
import { createTestApp } from '../integration/helpers/test-app';

const ADMIN_BYPASS = ['super_admin', 'hospital_admin'];

describe('RBAC Permission Matrix', () => {
`;

  for (const [relPath, entries] of byFile) {
    const importPath = relPath.replace(/\.ts$/, '');
    output += `  describe('${relPath}', () => {\n`;

    for (const entry of entries) {
      const deniedRoles = ALL_ROLES.filter(r => {
        if (['super_admin', 'hospital_admin'].includes(r)) return false;
        return !entry.allowedRoles.includes(r);
      });

      if (deniedRoles.length === 0) continue;

      for (const role of deniedRoles) {
        const mount = entry.mountPrefix;
        const fullPath = entry.path === '/' ? mount : `${mount}${entry.path}`;
        const testName = `${entry.method} ${entry.path} denies ${role}`;
        output += `    it('${testName}', async () => {
      const mod = await import('../../src/routes/tenant/${importPath}');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '${mount}', role: '${role}',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('${fullPath}', { method: '${entry.method}' });
      expect(res.status).toBe(403);
    });\n`;
      }
    }

    output += `  });\n\n`;
  }

  output += `});\n`;
  return output;
}

function generateMarkdownDoc(allEntries: RouteEntry[]): string {
  let doc = `# RBAC Permission Matrix\n\n`;
  doc += `> Auto-generated on ${new Date().toISOString().split('T')[0]}\n\n`;
  doc += `| File | Method | Path | Allowed Roles |\n`;
  doc += `|------|--------|------|---------------|\n`;
  for (const e of allEntries) {
    doc += `| ${e.relPath} | ${e.method} | \`${e.path}\` | ${e.allowedRoles.join(', ')} |\n`;
  }
  doc += `\n**Total protected endpoints:** ${allEntries.length}\n`;
  return doc;
}

function main() {
  const mountMap = buildMountMap();
  const routeFiles: { abs: string; rel: string }[] = [];
  const dirEntries = fs.readdirSync(TENANT_ROUTES_DIR, { recursive: true });
  for (const entry of dirEntries) {
    const rel = String(entry);
    if (!rel.endsWith('.ts')) continue;
    routeFiles.push({ abs: path.join(TENANT_ROUTES_DIR, rel), rel });
  }

  const allEntries: RouteEntry[] = [];
  for (const { abs, rel } of routeFiles) {
    const prefix = getMountPrefix(rel, mountMap);
    allEntries.push(...scanRouteFile(abs, rel, prefix));
  }

  console.log(`Scanned ${routeFiles.length} route files`);
  console.log(`Found ${allEntries.length} RBAC-protected endpoints`);

  const deniedCount = allEntries.reduce((sum, e) => {
    const denied = ALL_ROLES.filter(r =>
      !['super_admin', 'hospital_admin'].includes(r) && !e.allowedRoles.includes(r)
    );
    return sum + denied.length;
  }, 0);
  console.log(`Will generate ~${deniedCount} denial test cases`);

  fs.mkdirSync(path.dirname(OUTPUT_TEST), { recursive: true });
  fs.mkdirSync(path.dirname(OUTPUT_DOC), { recursive: true });
  fs.writeFileSync(OUTPUT_TEST, generateTestFile(allEntries));
  console.log(`\nGenerated: ${OUTPUT_TEST}`);
  fs.writeFileSync(OUTPUT_DOC, generateMarkdownDoc(allEntries));
  console.log(`Generated: ${OUTPUT_DOC}`);
}

main();
