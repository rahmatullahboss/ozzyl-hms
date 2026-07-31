import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock context/hooks
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock Lucide Icons to prevent render issues
vi.mock('lucide-react', () => {
  return new Proxy({}, {
    get: function(_, prop) {
      return () => <span data-testid={`icon-${prop.toString()}`} />;
    }
  });
});

import SymptomLoggerModal from '../src/components/patient/SymptomLoggerModal';
import AchievementGallery from '../src/components/patient/AchievementGallery';
import ScreeningHistory from '../src/components/patient/ScreeningHistory';
import CycleCalendar from '../src/components/patient/CycleCalendar';
import FoodDiary from '../src/components/patient/FoodDiary';
import VisitPassQR from '../src/components/patient/VisitPassQR';
import SocialChallenges from '../src/components/patient/SocialChallenges';
import NotificationPermission from '../src/components/patient/NotificationPermission';

describe('Patient Portal Screens', () => {
  describe('SymptomLoggerModal', () => {
    it('renders without crashing when open', () => {
      render(<SymptomLoggerModal isOpen={true} onClose={() => {}} />);
      expect(screen.getByText('Log Symptoms')).toBeInTheDocument();
      expect(screen.getByText('How are you feeling?')).toBeInTheDocument();
    });

    it('returns null when closed', () => {
      const { container } = render(<SymptomLoggerModal isOpen={false} onClose={() => {}} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('AchievementGallery', () => {
    it('renders without crashing', () => {
      render(<AchievementGallery />);
      expect(screen.getByText('Achievement Gallery')).toBeInTheDocument();
      expect(screen.getByText('7 Days Active')).toBeInTheDocument();
    });
  });

  describe('ScreeningHistory', () => {
    it('renders without crashing', () => {
      render(<ScreeningHistory />);
      expect(screen.getByText('Screening History')).toBeInTheDocument();
      expect(screen.getByText('PHQ-9')).toBeInTheDocument();
    });
  });

  describe('CycleCalendar', () => {
    it('renders without crashing', () => {
      render(<CycleCalendar />);
      expect(screen.getByText('Cycle Tracker')).toBeInTheDocument();
      expect(screen.getByText('Prediction')).toBeInTheDocument();
    });
  });

  describe('FoodDiary', () => {
    it('renders without crashing', () => {
      render(<FoodDiary />);
      expect(screen.getByText('Food Diary')).toBeInTheDocument();
      expect(screen.getByText('Protein')).toBeInTheDocument();
    });
  });

  describe('VisitPassQR', () => {
    it('renders without crashing', () => {
      render(<VisitPassQR patientName="John Doe" patientId="UHID-TEST" />);
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('UHID-TEST')).toBeInTheDocument();
      expect(screen.getByText('Ready to Scan')).toBeInTheDocument();
    });
  });

  describe('SocialChallenges', () => {
    it('renders without crashing', () => {
      render(<SocialChallenges />);
      expect(screen.getByText('Community Challenges')).toBeInTheDocument();
      expect(screen.getByText('Marathon May')).toBeInTheDocument();
    });
  });

  describe('NotificationPermission', () => {
    it('renders without crashing', () => {
      render(<NotificationPermission />);
      expect(screen.getByText('Stay Connected')).toBeInTheDocument();
      expect(screen.getByText('Enable Notifications')).toBeInTheDocument();
    });
  });
});
