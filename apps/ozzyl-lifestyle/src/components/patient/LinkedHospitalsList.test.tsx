import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LinkedHospitalsList } from './LinkedHospitalsList';

describe('LinkedHospitalsList Validation', () => {
  it('P0: renders the hospital list component', () => {
    const { container } = render(
      <LinkedHospitalsList
        hospitals={[
          {
            id: 1,
            tenant_id: 'demo-hospital',
            hospital_name: 'Demo Hospital',
            status: 'active',
            linked_at: '2026-04-20T00:00:00.000Z',
          },
        ]}
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
