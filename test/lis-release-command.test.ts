import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LIS release command', () => {
  it('runs the real SQLite atomic acceptance integration test', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:lis:safety']).toContain(
      'test/integration/lis-result-acceptance-sqlite.test.ts',
    );
    expect(packageJson.scripts?.['test:lis:safety']).toContain(
      'test/patient-auth-scope.test.ts',
    );
    expect(packageJson.scripts?.['test:lis:safety']).toContain(
      'test/patient-auth-verification-contract.test.ts',
    );
    expect(packageJson.scripts?.['test:lis:web']).toContain(
      'src/pages/laboratory/AnalyzerInboxTab.test.ts',
    );
    expect(packageJson.scripts?.['test:lis:web']).toContain(
      'src/pages/laboratory/AnalyzerSupersessionPanel.test.ts',
    );
    expect(packageJson.scripts?.['test:lis:web']).toContain(
      'src/pages/LabMachineSettings.test.ts',
    );
    expect(packageJson.scripts?.['test:lis:mobile']).toContain(
      'flutter test test/features/notifications test/features/auth/patient_auth_adapter_test.dart',
    );
    expect(packageJson.scripts?.['test:lis:release']).toMatch(/^pnpm build:migrations &&/);
    expect(packageJson.scripts?.['test:lis:release']).toContain('pnpm test:lis:web');
    expect(packageJson.scripts?.['test:lis:release']).toContain('pnpm test:lis:mobile');
  });
});
