import type { WorkforceTransaction } from '../application/ports';

export type WorkforceD1Transaction = WorkforceTransaction<D1PreparedStatement>;

export function createWorkforceTransaction(db: D1Database): WorkforceD1Transaction {
  return {
    async commit(statements) {
      if (statements.length === 0) return;
      await db.batch([...statements]);
    },
  };
}
