#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const includeRoots = [
  'web/src/pages/admin',
  'web/src/pages/accounting',
  'web/src/pages/inventory',
  'web/src/pages/pharmacy',
  'web/src/pages',
  'web/src/components/admin',
  'web/src/components/dashboard',
];
const includeNameHints = /admin|approval|audit|cash|collection|commission|dashboard|discount|drawer|expense|handover|inventory|monitor|pharmacy|refund|report|settings|stock|task|transaction/i;
const localeDirs = ['web/public/locales/en', 'web/public/locales/bn'];
const sourceExtensions = new Set(['.tsx', '.ts']);

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (sourceExtensions.has(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return {}; }
}

function hasPath(obj, dotted) {
  return dotted.split('.').every((part) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, part)) {
      obj = obj[part];
      return true;
    }
    return false;
  });
}

function flattenLocale(dir) {
  const abs = path.join(root, dir);
  const merged = {};
  if (!fs.existsSync(abs)) return merged;
  for (const file of fs.readdirSync(abs)) {
    if (!file.endsWith('.json')) continue;
    merged[file.replace(/\.json$/, '')] = readJson(path.join(dir, file));
  }
  return merged;
}

const locales = Object.fromEntries(localeDirs.map((dir) => [dir.includes('/bn') ? 'bn' : 'en', flattenLocale(dir)]));
const allFiles = Array.from(new Set(includeRoots.flatMap((dir) => walk(dir))));
const adminFiles = allFiles.filter((file) => file.includes('/pages/admin/') || file.includes('/components/admin/') || includeNameHints.test(file));

const tCallRegex = /\bt\(\s*['"]([^'"]+)['"]/g;
const nsOptionRegex = /ns\s*:\s*['"]([^'"]+)['"]/;
const hardcodedJsxRegex = />\s*([A-Z][A-Za-z0-9 ,&/().:%-]{2,})\s*</g;

const missing = [];
const hardcoded = [];

for (const rel of adminFiles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  let match;
  while ((match = tCallRegex.exec(text))) {
    const key = match[1];
    const callTail = text.slice(match.index, Math.min(text.length, match.index + 220));
    const nsMatch = callTail.match(nsOptionRegex);
    const explicitNs = nsMatch?.[1] ?? null;
    const namespacesToCheck = explicitNs ? [explicitNs] : Object.keys(locales.en);
    const enFound = namespacesToCheck.some((ns) => hasPath(locales.en[ns], key));
    const bnFound = namespacesToCheck.some((ns) => hasPath(locales.bn[ns], key));
    if (!enFound || !bnFound) missing.push({ file: rel, key, explicitNs, enFound, bnFound });
  }
  while ((match = hardcodedJsxRegex.exec(text))) {
    const value = match[1].replace(/\s+/g, ' ').trim();
    if (value.length < 3) continue;
    if (/^(API|ID|OPD|IPD|OT|URL|SMS|VAT|BDT)$/.test(value)) continue;
    hardcoded.push({ file: rel, text: value });
  }
}

function groupByFile(rows) {
  return rows.reduce((acc, row) => {
    (acc[row.file] ||= []).push(row);
    return acc;
  }, {});
}

const report = {
  generatedAt: new Date().toISOString(),
  filesScanned: adminFiles.length,
  missingTranslationKeys: missing.length,
  hardcodedTextFindings: hardcoded.length,
  missingByFile: groupByFile(missing),
  hardcodedByFile: groupByFile(hardcoded),
};

const outPath = path.join(root, 'admin-i18n-audit.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Admin i18n audit complete.`);
console.log(`Files scanned: ${report.filesScanned}`);
console.log(`Missing translation key findings: ${report.missingTranslationKeys}`);
console.log(`Hardcoded text findings: ${report.hardcodedTextFindings}`);
console.log(`Report: ${outPath}`);

if (missing.length || hardcoded.length) process.exitCode = 1;
