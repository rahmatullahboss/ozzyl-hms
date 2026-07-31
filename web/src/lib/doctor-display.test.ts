import { describe, it, expect } from 'vitest';
import { formatDoctorName, stripDrPrefix } from './doctor-display';

describe('formatDoctorName', () => {
  it('adds prefix when name has no prefix', () => {
    expect(formatDoctorName('Aminul Islam')).toBe('Dr. Aminul Islam');
  });

  it('does not duplicate prefix when name already has it', () => {
    expect(formatDoctorName('Dr. Aminul Islam')).toBe('Dr. Aminul Islam');
    expect(formatDoctorName('Dr Aminul Islam')).toBe('Dr. Aminul Islam');
    expect(formatDoctorName('Doctor Aminul Islam')).toBe('Dr. Aminul Islam');
    expect(formatDoctorName('ডক্টর Aminul Islam')).toBe('Dr. Aminul Islam');
  });

  it('strips repeated prefix', () => {
    expect(formatDoctorName('Dr. Dr. Aminul Islam')).toBe('Dr. Aminul Islam');
    expect(formatDoctorName('Dr Dr. Dr Aminul Islam')).toBe('Dr. Aminul Islam');
  });

  it('returns just the prefix when name is empty', () => {
    expect(formatDoctorName('')).toBe('Dr.');
    expect(formatDoctorName(null)).toBe('Dr.');
    expect(formatDoctorName(undefined)).toBe('Dr.');
  });

  it('uses localized prefix', () => {
    expect(formatDoctorName('Aminul Islam', 'ডাঃ')).toBe('ডাঃ Aminul Islam');
    expect(formatDoctorName('ডাঃ Aminul Islam', 'ডাঃ')).toBe('ডাঃ Aminul Islam');
    expect(formatDoctorName('Dr. Aminul Islam', 'ডাঃ')).toBe('ডাঃ Aminul Islam');
    expect(formatDoctorName('ডাঃ ডাঃ Aminul Islam', 'ডাঃ')).toBe('ডাঃ Aminul Islam');
  });

  it('falls back to Dr. when prefix is blank', () => {
    expect(formatDoctorName('Aminul Islam', '   ')).toBe('Dr. Aminul Islam');
  });
});

describe('stripDrPrefix', () => {
  it('strips English prefix', () => {
    expect(stripDrPrefix('Dr. Aminul Islam')).toBe('Aminul Islam');
    expect(stripDrPrefix('Dr Aminul Islam')).toBe('Aminul Islam');
    expect(stripDrPrefix('DR. Aminul Islam')).toBe('Aminul Islam');
    expect(stripDrPrefix('Doctor Aminul Islam')).toBe('Aminul Islam');
  });

  it('strips Bengali prefix', () => {
    expect(stripDrPrefix('ডাঃ Aminul Islam')).toBe('Aminul Islam');
    expect(stripDrPrefix('ডা. Aminul Islam')).toBe('Aminul Islam');
    expect(stripDrPrefix('ডক্টর Aminul Islam')).toBe('Aminul Islam');
  });

  it('strips repeated prefixes', () => {
    expect(stripDrPrefix('Dr. Dr. Dr. Aminul Islam')).toBe('Aminul Islam');
    expect(stripDrPrefix('Dr. ডাঃ Aminul Islam')).toBe('Aminul Islam');
  });

  it('leaves name with no prefix untouched', () => {
    expect(stripDrPrefix('Aminul Islam')).toBe('Aminul Islam');
  });

  it('handles null/undefined/empty', () => {
    expect(stripDrPrefix(null)).toBe('');
    expect(stripDrPrefix(undefined)).toBe('');
    expect(stripDrPrefix('')).toBe('');
  });
});
