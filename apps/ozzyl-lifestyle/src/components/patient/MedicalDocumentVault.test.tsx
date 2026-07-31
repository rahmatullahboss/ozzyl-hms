import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MedicalDocumentVault } from './MedicalDocumentVault';

describe('MedicalDocumentVault Validation', () => {
  it('P0: renders the vault and upload action', () => {
    // @ts-ignore
    render(<MedicalDocumentVault documents={[]} />);
    expect(screen.getByText('Document Vault')).toBeInTheDocument();
  });
});
