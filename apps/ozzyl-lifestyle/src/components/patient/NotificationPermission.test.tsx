import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationPermission from './NotificationPermission';

describe('NotificationPermission', () => {
  it('renders titles and description', () => {
    render(<NotificationPermission />);
    expect(screen.getByText('Stay Connected')).toBeInTheDocument();
    expect(screen.getByText(/Never miss a pill reminder/)).toBeInTheDocument();
  });

  it('renders action buttons', () => {
    render(<NotificationPermission />);
    const enableButton = screen.getByRole('button', { name: 'Enable Notifications' });
    const maybeLaterButton = screen.getByRole('button', { name: 'Maybe Later' });
    
    expect(enableButton).toBeInTheDocument();
    expect(maybeLaterButton).toBeInTheDocument();
  });
});
