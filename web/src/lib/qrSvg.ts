function addFinderPattern(matrix: boolean[][], row: number, col: number) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      matrix[row + r][col + c] =
        (r === 0 || r === 6 || c === 0 || c === 6) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
  }
  for (let i = 0; i < 8; i++) {
    if (row + 7 < matrix.length && col + i < matrix.length) matrix[row + 7][col + i] = false;
    if (row + i < matrix.length && col + 7 < matrix.length) matrix[row + i][col + 7] = false;
    if (row - 1 >= 0 && col + i < matrix.length) matrix[row - 1][col + i] = false;
    if (row + i < matrix.length && col - 1 >= 0) matrix[row + i][col - 1] = false;
  }
}

function addAlignmentPattern(matrix: boolean[][], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      matrix[row + r][col + c] =
        (Math.abs(r) === 2 || Math.abs(c) === 2) || (r === 0 && c === 0);
    }
  }
}

function encodeDataBits(data: string): number[] {
  const bits: number[] = [0, 1, 0, 0];
  const len = data.length;
  for (let i = 7; i >= 0; i--) bits.push((len >> i) & 1);
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    for (let j = 7; j >= 0; j--) bits.push((code >> j) & 1);
  }
  bits.push(0, 0, 0, 0);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < 272) {
    const pb = padBytes[padIndex % 2];
    for (let j = 7; j >= 0; j--) bits.push((pb >> j) & 1);
    padIndex++;
  }
  return bits;
}

function isReserved(row: number, col: number, size: number): boolean {
  if (row < 9 && col < 9) return true;
  if (row < 9 && col >= size - 8) return true;
  if (row >= size - 8 && col < 9) return true;
  if (row === 6 || col === 6) return true;
  if (row >= 14 && row <= 18 && col >= 14 && col <= 18) return true;
  if (row === size - 8 && col === 8) return true;
  return false;
}

function placeDataBits(matrix: boolean[][], bits: number[], size: number) {
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5;
    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);
    for (const row of rows) {
      for (const c of [col, col - 1]) {
        if (c < 0) continue;
        if (isReserved(row, c, size)) continue;
        if (bitIndex < bits.length) {
          matrix[row][c] = bits[bitIndex] === 1;
          bitIndex++;
        }
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix: boolean[][], size: number) {
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isReserved(row, col, size)) continue;
      if ((row + col) % 2 === 0) {
        matrix[row][col] = !matrix[row][col];
      }
    }
  }
}

function encodeToQrModules(data: string): boolean[][] {
  const size = 25;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  addFinderPattern(matrix, 0, 0);
  addFinderPattern(matrix, 0, size - 7);
  addFinderPattern(matrix, size - 7, 0);
  addAlignmentPattern(matrix, 16, 16);
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }
  matrix[size - 8][8] = true;
  placeDataBits(matrix, encodeDataBits(data), size);
  applyMask(matrix, size);
  return matrix;
}

export function generateQrSvg(data: string, size = 220): string {
  const modules = encodeToQrModules(data);
  const moduleCount = modules.length;
  const cellSize = size / moduleCount;
  let paths = '';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!modules[row][col]) continue;
      const x = col * cellSize;
      const y = row * cellSize;
      paths += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#111827"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="18" fill="#ffffff"/>${paths}</svg>`;
}
