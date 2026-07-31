import { describe, it, expect, vi } from 'vitest';
import { compressImage, compressImageToWebpFile } from './compressImage';

describe('compressImage utility', () => {
  it('returns SVG files unchanged', async () => {
    const svgFile = new File(['<svg></svg>'], 'test.svg', { type: 'image/svg+xml' });
    const result = await compressImage(svgFile);
    expect(result).toBe(svgFile);
  });

  it('compresses an image file using canvas', async () => {
    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'mock-url');

    // Mock Image
    class MockImage {
      onload: any = null;
      onerror: any = null;
      width = 1000;
      height = 800;
      set src(value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    // Mock Canvas
    const mockBlob = new Blob(['compressed'], { type: 'image/webp' });
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback) => callback(mockBlob)),
    };
    document.createElement = vi.fn((tag) => {
      if (tag === 'canvas') return mockCanvas as any;
      return {};
    }) as any;

    const file = new File(['fake-image-data'], 'test.jpg', { type: 'image/jpeg' });
    const result = await compressImage(file, 400);

    expect(result).toBe(mockBlob);
    expect(mockCanvas.width).toBe(400);
    expect(mockCanvas.height).toBe(320); // 400 * 800 / 1000
    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
  });

  it('creates a WebP File for receipt uploads', async () => {
    global.URL.createObjectURL = vi.fn(() => 'mock-url');

    class MockImage {
      onload: any = null;
      onerror: any = null;
      width = 1600;
      height = 1200;
      set src(value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    const mockBlob = new Blob(['compressed-webp'], { type: 'image/webp' });
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback) => callback(mockBlob)),
    };
    document.createElement = vi.fn((tag) => {
      if (tag === 'canvas') return mockCanvas as any;
      return {};
    }) as any;

    const file = new File(['fake-image-data'], 'receipt.png', { type: 'image/png' });
    const result = await compressImageToWebpFile(file, 1200, 0.85);

    expect(result).toBeInstanceOf(File);
    expect(result.name).toBe('receipt.webp');
    expect(result.type).toBe('image/webp');
  });
});
