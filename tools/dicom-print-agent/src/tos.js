// ═══════════════════════════════════════════════════════════════════════════════
//  Ozzyl HMS — DICOM Print Agent
//  First-Run License Agreement Prompt
//  Copyright (c) 2026 Ozzyl. All rights reserved.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ACCEPT_FLAG = path.join(__dirname, '..', '.tos-accepted');

/**
 * Returns true if user has already accepted the TOS.
 */
function isAccepted() {
  return fs.existsSync(ACCEPT_FLAG);
}

/**
 * Prompts the user to read and accept the license agreement on first run.
 * Blocks startup until accepted. If declined, exits the process.
 */
async function promptTosAcceptance() {
  if (isAccepted()) return; // Already accepted, skip

  const licenseFile = path.join(__dirname, '..', 'LICENSE');
  let licenseText = '';
  try {
    licenseText = fs.readFileSync(licenseFile, 'utf-8');
  } catch {
    licenseText = '[LICENSE file not found — please ensure LICENSE exists in the agent root]';
  }

  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════╗');
  console.log('  ║       OZZYL HMS — DICOM PRINT AGENT LICENSE             ║');
  console.log('  ║       Please read and accept to continue                ║');
  console.log('  ╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('─'.repeat(70));
  console.log(licenseText);
  console.log('─'.repeat(70));
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question(
      '  Do you accept the terms and conditions? (yes/no): ',
      (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();

        if (normalized === 'yes' || normalized === 'y') {
          // Write acceptance marker
          const acceptData = JSON.stringify({
            accepted: true,
            acceptedAt: new Date().toISOString(),
            version: '1.0.0',
            hostname: require('os').hostname(),
          }, null, 2);

          fs.writeFileSync(ACCEPT_FLAG, acceptData, 'utf-8');
          console.log('');
          console.log('  ✅ License accepted. Starting DICOM Print Agent...');
          console.log('');
          resolve();
        } else {
          console.log('');
          console.log('  ❌ License declined. Cannot start the agent.');
          console.log('  ℹ  You must accept the license to use this software.');
          console.log('');
          process.exit(1);
        }
      }
    );
  });
}

module.exports = { promptTosAcceptance, isAccepted };
