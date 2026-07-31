import { describe, expect, it } from 'vitest';

describe('InventoryIssuePage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryIssuePage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('reuses the same idempotency key for an unchanged retry payload', async () => {
    const { resolveIssueSubmissionKey } = await import('./InventoryIssuePage');
    let sequence = 0;
    const generateKey = () => `issue-key-${++sequence}`;
    const payload = { IssueType: 'department_issue', FromStoreId: 1, Items: [{ ItemId: 5, Quantity: 2 }] };

    const first = resolveIssueSubmissionKey(null, payload, generateKey);
    const retry = resolveIssueSubmissionKey(first, payload, generateKey);

    expect(retry).toEqual(first);
    expect(sequence).toBe(1);
  });

  it('creates a new idempotency key when the form payload changes', async () => {
    const { resolveIssueSubmissionKey } = await import('./InventoryIssuePage');
    let sequence = 0;
    const generateKey = () => `issue-key-${++sequence}`;
    const first = resolveIssueSubmissionKey(
      null,
      { IssueType: 'department_issue', FromStoreId: 1, Items: [{ ItemId: 5, Quantity: 2 }] },
      generateKey,
    );
    const changed = resolveIssueSubmissionKey(
      first,
      { IssueType: 'department_issue', FromStoreId: 1, Items: [{ ItemId: 5, Quantity: 3 }] },
      generateKey,
    );

    expect(changed.key).not.toBe(first.key);
    expect(sequence).toBe(2);
  });
});
