import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/lab-middleware/index.js', 'utf8');

describe('local bridge runtime safety contract', () => {
  it('declares the encrypted ASTM journal directory before constructing the journal', () => {
    const declarationIndex = source.indexOf('const TRANSMISSION_JOURNAL_DIR =');
    const constructionIndex = source.indexOf('createTransmissionJournal(TRANSMISSION_JOURNAL_DIR');

    expect(declarationIndex).toBeGreaterThan(-1);
    expect(constructionIndex).toBeGreaterThan(declarationIndex);
  });

  it('normalizes TCP data chunks to Buffer before ASTM frame concatenation', () => {
    expect(source).toContain('const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);');
    expect(source).toContain('frameBuffer = Buffer.concat([frameBuffer, chunk]);');
  });

  it('durably journals ASTM frames before sending a positive frame acknowledgement', () => {
    const frameBranchStart = source.indexOf('} else if (byte === STX)');
    const eotBranchStart = source.indexOf('} else if (byte === EOT)', frameBranchStart);
    const frameBranch = source.slice(frameBranchStart, eotBranchStart);
    const appendIndex = frameBranch.indexOf('transmissionJournal.appendFrame');
    const firstFrameAckAfterAppend = frameBranch.indexOf('socket.write(Buffer.from([ACK]))', appendIndex);

    expect(frameBranchStart).toBeGreaterThan(-1);
    expect(appendIndex).toBeGreaterThan(-1);
    expect(firstFrameAckAfterAppend).toBeGreaterThan(appendIndex);
  });

  it('does not allow the ASTM 00 checksum bypass', () => {
    expect(source).toContain('validateAstmChecksum(frameNumberAndData, terminator, expectedCS)');
    expect(source).not.toContain("expectedCS !== '00'");
  });

  it('marks a complete ASTM journal before API delivery and retains permanent rejections', () => {
    const completeIndex = source.indexOf('transmissionJournal.markComplete');
    const postIndex = source.indexOf("postToAPI('/api/lab-machines/astm/receive'", completeIndex);
    const deliveredIndex = source.indexOf('transmissionJournal.markDelivered', postIndex);
    const retainedIndex = source.indexOf('completed journal retained', postIndex);

    expect(completeIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeGreaterThan(completeIndex);
    expect(deliveredIndex).toBeGreaterThan(postIndex);
    expect(retainedIndex).toBeGreaterThan(postIndex);
  });

  it('keeps raw analyzer message files disabled unless explicitly enabled', () => {
    expect(source).toContain('if (RAW_MESSAGE_LOGGING_ENABLED)');
    expect(source).toContain("?? config.logging?.rawMessages ?? 'false'");
  });
});
