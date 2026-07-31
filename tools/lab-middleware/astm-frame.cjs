function calculateAstmChecksum(frameData, terminator) {
  let sum = 0;
  const content = String(frameData ?? '');
  for (let index = 0; index < content.length; index += 1) {
    sum += content.charCodeAt(index);
  }
  sum += Number(terminator);
  return (sum % 256).toString(16).toUpperCase().padStart(2, '0');
}

function validateAstmChecksum(frameData, terminator, expectedChecksum) {
  const expected = String(expectedChecksum ?? '').trim().toUpperCase();
  const actual = calculateAstmChecksum(frameData, terminator);
  return {
    valid: /^[0-9A-F]{2}$/.test(expected) && expected === actual,
    expected,
    actual,
  };
}

module.exports = {
  calculateAstmChecksum,
  validateAstmChecksum,
};
