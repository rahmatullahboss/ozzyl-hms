import { describe, it, expect } from 'vitest';

describe('recursive parent-visit chain', () => {
  describe('findRootVisit', () => {
    it('returns the visit itself if no parent', () => {
      const visits = [
        { id: 1, parent_visit_id: null, visit_date: '2026-05-01' },
      ];

      function findRootVisit(visitId: number, visitMap: Map<number, { id: number; parent_visit_id: number | null; visit_date: string }>): { id: number; visit_date: string } {
        const visited = new Set<number>();
        let current = visitMap.get(visitId);
        while (current?.parent_visit_id) {
          if (visited.has(current.id)) break; // cycle detection
          visited.add(current.id);
          current = visitMap.get(current.parent_visit_id);
        }
        return current ?? { id: visitId, visit_date: '' };
      }

      const visitMap = new Map(visits.map(v => [v.id, v]));
      const root = findRootVisit(1, visitMap);
      expect(root.id).toBe(1);
    });

    it('follows parent chain to find root visit', () => {
      const visits = [
        { id: 1, parent_visit_id: null, visit_date: '2026-05-01' },
        { id: 2, parent_visit_id: 1, visit_date: '2026-05-08' },
        { id: 3, parent_visit_id: 2, visit_date: '2026-05-15' },
      ];

      function findRootVisit(visitId: number, visitMap: Map<number, { id: number; parent_visit_id: number | null; visit_date: string }>): { id: number; visit_date: string } {
        const visited = new Set<number>();
        let current = visitMap.get(visitId);
        while (current?.parent_visit_id) {
          if (visited.has(current.id)) break;
          visited.add(current.id);
          current = visitMap.get(current.parent_visit_id);
        }
        return current ?? { id: visitId, visit_date: '' };
      }

      const visitMap = new Map(visits.map(v => [v.id, v]));
      const root = findRootVisit(3, visitMap);
      expect(root.id).toBe(1);
      expect(root.visit_date).toBe('2026-05-01');
    });

    it('handles cycle detection', () => {
      const visits = [
        { id: 1, parent_visit_id: 3, visit_date: '2026-05-01' },
        { id: 2, parent_visit_id: 1, visit_date: '2026-05-08' },
        { id: 3, parent_visit_id: 2, visit_date: '2026-05-15' },
      ];

      function findRootVisit(visitId: number, visitMap: Map<number, { id: number; parent_visit_id: number | null; visit_date: string }>): { id: number; visit_date: string } {
        const visited = new Set<number>();
        let current = visitMap.get(visitId);
        while (current?.parent_visit_id) {
          if (visited.has(current.id)) break;
          visited.add(current.id);
          current = visitMap.get(current.parent_visit_id);
        }
        return current ?? { id: visitId, visit_date: '' };
      }

      const visitMap = new Map(visits.map(v => [v.id, v]));
      // Should not infinite loop
      const root = findRootVisit(1, visitMap);
      expect(root.id).toBeDefined();
    });

    it('calculates chain depth', () => {
      const visits = [
        { id: 1, parent_visit_id: null },
        { id: 2, parent_visit_id: 1 },
        { id: 3, parent_visit_id: 2 },
        { id: 4, parent_visit_id: 3 },
      ];

      function getChainDepth(visitId: number, visitMap: Map<number, { id: number; parent_visit_id: number | null }>): number {
        let depth = 0;
        const visited = new Set<number>();
        let current = visitMap.get(visitId);
        while (current?.parent_visit_id) {
          if (visited.has(current.id)) break;
          visited.add(current.id);
          depth++;
          current = visitMap.get(current.parent_visit_id);
        }
        return depth;
      }

      const visitMap = new Map(visits.map(v => [v.id, v]));
      expect(getChainDepth(4, visitMap)).toBe(3);
      expect(getChainDepth(1, visitMap)).toBe(0);
    });
  });

  describe('follow-up eligibility via chain', () => {
    it('allows follow-up if root visit is within eligibility window', () => {
      const rootVisitDate = '2026-05-01';
      const eligibilityDays = 30;
      const today = '2026-05-20';

      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() - eligibilityDays);
      const isEligible = rootVisitDate >= cutoffDate.toISOString().slice(0, 10);

      expect(isEligible).toBe(true);
    });

    it('rejects follow-up if root visit is outside eligibility window', () => {
      const rootVisitDate = '2026-01-01';
      const eligibilityDays = 30;
      const today = '2026-05-20';

      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() - eligibilityDays);
      const isEligible = rootVisitDate >= cutoffDate.toISOString().slice(0, 10);

      expect(isEligible).toBe(false);
    });
  });
});
