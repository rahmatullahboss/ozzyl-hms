const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');

async function runBuild() {
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
  }

  console.log('📦 Bundling with esbuild...');
  await build({
    entryPoints: ['src/index.js'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/bundle.js',
    // We externalize some native/binary dependencies to avoid breaking them
    external: ['sharp', 'winston', 'canvas', 'utf-8-validate', 'bufferutil'],
  });

  console.log('🔒 Obfuscating code...');
  const code = fs.readFileSync('dist/bundle.js', 'utf8');

  // Hardcore obfuscation settings
  const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false, // Don't block debugger to avoid false positive antiviruses
    debugProtectionInterval: 0,
    disableConsoleOutput: false, // We need console logs
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true, // Prevents code formatting/beautification
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.5,
    stringArrayEncoding: ['rc4'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: 'variable',
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false
  });

  fs.writeFileSync('dist/agent.js', obfuscationResult.getObfuscatedCode(), 'utf8');
  
  // Clean up intermediate bundle
  fs.unlinkSync('dist/bundle.js');
  
  // Copy non-JS assets needed
  fs.copyFileSync('LICENSE', 'dist/LICENSE');
  fs.copyFileSync('package.json', 'dist/package.json');
  fs.copyFileSync('.env.example', 'dist/.env.example');
  
  console.log('✅ Build complete! Obfuscated agent is in standard dist/agent.js');
  console.log('   Run with: node dist/agent.js');
}

runBuild().catch(console.error);
