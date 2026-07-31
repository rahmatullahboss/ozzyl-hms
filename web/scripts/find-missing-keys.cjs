const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '../public/locales');
const srcDir = path.join(__dirname, '../src');

function getKeys(obj, prefix = '') {
  let keys = [];
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      keys = keys.concat(getKeys(obj[key], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const enBilling = JSON.parse(fs.readFileSync(path.join(localesDir, 'en/billing.json'), 'utf8'));
const bnBilling = JSON.parse(fs.readFileSync(path.join(localesDir, 'bn/billing.json'), 'utf8'));

const enKeys = new Set(getKeys(enBilling));
const bnKeys = new Set(getKeys(bnBilling));

console.log('--- Missing in BN (billing.json) ---');
enKeys.forEach(key => {
  if (!bnKeys.has(key)) console.log(key);
});

console.log('\n--- Missing in EN (billing.json) ---');
bnKeys.forEach(key => {
  if (!enKeys.has(key)) console.log(key);
});

function findKeysInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Look for useTranslation('billing') or useTranslation(['billing', ...])
  const usesBilling = content.includes("'billing'") || content.includes('"billing"');
  if (!usesBilling) return [];

  const keys = [];
  // Match t('key') or t('billing:key')
  const matches = content.matchAll(/t\(['"](?:billing:)?([^'"]+)['"]\)/g);
  for (const match of matches) {
      const key = match[1];
      if (!key.includes(':') || key.startsWith('billing:')) {
          keys.push(key.replace('billing:', ''));
      }
  }
  return keys;
}

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const usedKeys = new Set();
walkDir(srcDir, (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    findKeysInFile(filePath).forEach(key => usedKeys.add(key));
  }
});

console.log('\n--- Used in Billing-related Code but Missing in billing.json ---');
usedKeys.forEach(key => {
  // Ignore keys that start with other namespaces if they were caught by accident
  if (key.includes(':')) return;
  // Ignore common keys that are usually in common.json
  if (key.startsWith('common.')) return;

  if (!enKeys.has(key)) {
      console.log(key);
  }
});
