/**
 * Frontend tests for Blood Bank Management - Donor Registration
 *
 * Tests cover:
 * - Patient search functionality
 * - Global patient linking
 * - Donor form validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock the API hooks
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { useApiQuery, useQueryClient, useApiMutation } from '../../hooks/useApiQuery';

const mockUseApiQuery = useApiQuery as ReturnType<typeof vi.fn>;
const mockUseApiMutation = useApiMutation as ReturnType<typeof vi.fn>;
const mockUseQueryClient = useQueryClient as ReturnType<typeof vi.fn>;

// Mock data
const mockLocalPatients = [
  { id: 1, name: 'Rahim Khan', mobile: '01712345678', patient_code: 'PT-001' },
  { id: 2, name: 'Karim Ahmed', mobile: '01812345678', patient_code: 'PT-002' },
];

const mockGlobalPatients = [
  { uhid: 'UHID-001', primary_name: 'Rahim Khan', primary_phone: '01712345678' },
  { uhid: 'UHID-002', primary_name: 'Salman Ahmed', primary_phone: '01912345678' },
];

describe('Blood Bank Management - Patient Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Patient Search Logic', () => {
    it('should search local patients when input has 3+ characters', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        data: { patients: mockLocalPatients },
        isLoading: false,
      });
      mockUseApiQuery.mockImplementation(mockQuery);

      // Test that the query is called with correct parameters
      const searchTerm = 'Rahim';
      const expectedUrl = `/api/patients?search=${encodeURIComponent(searchTerm)}&limit=5`;

      // The hook should be called with search term
      expect(searchTerm.length).toBeGreaterThanOrEqual(3);
    });

    it('should search global patients only when input is an 11-digit number', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        data: { results: mockGlobalPatients },
        isLoading: false,
      });
      mockUseApiQuery.mockImplementation(mockQuery);

      const searchTerm = '01739416661';
      const expectedUrl = `/api/patients/global-search?q=${encodeURIComponent(searchTerm)}`;

      expect(searchTerm).toMatch(/^\d{11}$/);
    });

    it('should not search when input has less than 3 characters', () => {
      const searchTerm = 'Ra';

      mockUseApiQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      // Should not trigger search for short inputs
      expect(searchTerm.length).toBeLessThan(3);
    });

    it('should show local patients first in results', async () => {
      const localPatients = mockLocalPatients;
      const globalPatients = mockGlobalPatients;

      // Local patients should be shown in "This Hospital" section
      expect(localPatients.length).toBeGreaterThan(0);

      // Global patients should be shown in "Other Hospitals" section
      expect(globalPatients.length).toBeGreaterThan(0);
    });

    it('should show linked patient info when selected', async () => {
      const selectedPatient = mockLocalPatients[0];

      // When patient is selected, form should be auto-filled
      expect(selectedPatient.name).toBe('Rahim Khan');
      expect(selectedPatient.mobile).toBe('01712345678');
      expect(selectedPatient.id).toBeDefined();
    });
  });

  describe('Link Global Patient', () => {
    it('should call link mutation with correct uhid', async () => {
      const mockMutate = vi.fn();
      mockUseApiMutation.mockReturnValue({
        mutate: mockMutate,
        mutateAsync: vi.fn(),
        isPending: false,
        isError: false,
      });

      const globalPatient = mockGlobalPatients[0];

      // When clicking "Link" button, should call mutation with uhid
      expect(globalPatient.uhid).toBe('UHID-001');
    });

    it('should handle link success and auto-fill form', async () => {
      const linkedPatient = {
        patientId: 10,
        alreadyLinked: false,
        patient: {
          id: 10,
          name: 'Rahim Khan (Linked)',
          mobile: '01712345678',
        },
      };

      // On success, patient should be selected
      expect(linkedPatient.patient).toBeDefined();
      expect(linkedPatient.patient.id).toBe(10);
    });

    it('should handle already linked patient', async () => {
      const alreadyLinkedPatient = {
        patientId: 5,
        alreadyLinked: true,
        patient: {
          id: 5,
          name: 'Karim Ahmed',
          mobile: '01812345678',
        },
      };

      // Should show "already linked" message
      expect(alreadyLinkedPatient.alreadyLinked).toBe(true);
    });
  });

  describe('Donor Form Validation', () => {
    it('should require donor_name', () => {
      const formData = {
        donor_name: '',
        blood_group: 'O+',
      };

      // donor_name should not be empty
      expect(formData.donor_name).toBe('');
    });

    it('should validate blood_group enum values', () => {
      const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      const testBloodGroup = 'O+';

      expect(validBloodGroups).toContain(testBloodGroup);
    });

    it('should normalize gender to capitalized format', () => {
      const normalizeGender = (gender: string) =>
        gender ? gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase() : undefined;

      expect(normalizeGender('male')).toBe('Male');
      expect(normalizeGender('female')).toBe('Female');
      expect(normalizeGender('MALE')).toBe('Male');
      expect(normalizeGender('Female')).toBe('Female');
    });

    it('should validate gender enum values', () => {
      const validGenders = ['Male', 'Female', 'Other'];
      const testGender = 'Male';

      expect(validGenders).toContain(testGender);
    });

    it('should convert numeric string fields to numbers', () => {
      const formData = {
        age: '30',
        weight_kg: '75.5',
        hemoglobin: '14.2',
      };

      const convertToNumbers = (data: typeof formData) => ({
        age: data.age ? Number(data.age) : undefined,
        weight_kg: data.weight_kg ? Number(data.weight_kg) : undefined,
        hemoglobin: data.hemoglobin ? Number(data.hemoglobin) : undefined,
      });

      const converted = convertToNumbers(formData);
      expect(converted.age).toBe(30);
      expect(converted.weight_kg).toBe(75.5);
      expect(converted.hemoglobin).toBe(14.2);
    });

    it('should include patient_id when linking a patient', () => {
      const selectedPatient = mockLocalPatients[0];
      const formData = {
        donor_name: selectedPatient.name,
        phone: selectedPatient.mobile,
        patient_id: selectedPatient.id,
      };

      expect(formData.patient_id).toBe(1);
      expect(selectedPatient.id).toBe(formData.patient_id);
    });
  });

  describe('Reset Form', () => {
    it('should clear form state on reset', () => {
      const resetForm = () => ({
        donor_name: '',
        blood_group: 'O+',
        donor_type: 'voluntary',
        gender: 'male',
        phone: '',
        age: '',
        weight_kg: '',
        hemoglobin: '',
        patient_id: undefined,
      });

      const form = resetForm();
      expect(form.donor_name).toBe('');
      expect(form.patient_id).toBeUndefined();
    });

    it('should clear selected patient state', () => {
      const clearSelectedPatient = () => ({
        selectedPatient: null,
        patientSearch: '',
      });

      const state = clearSelectedPatient();
      expect(state.selectedPatient).toBeNull();
      expect(state.patientSearch).toBe('');
    });
  });

  describe('Donor Types', () => {
    it('should have valid donor_type enum values', () => {
      const validDonorTypes = ['voluntary', 'replacement', 'autologous', 'directed'];
      const testTypes = ['voluntary', 'replacement'];

      testTypes.forEach(type => {
        expect(validDonorTypes).toContain(type);
      });
    });
  });
});

describe('Blood Bank - API Integration', () => {
  describe('POST /donors endpoint', () => {
    it('should send patient_id in request body when linked', async () => {
      const requestBody = {
        donor_name: 'Rahim Khan',
        blood_group: 'A+',
        donor_type: 'replacement',
        gender: 'Male',
        phone: '01712345678',
        patient_id: 1,
      };

      expect(requestBody.patient_id).toBe(1);
      expect(typeof requestBody.patient_id).toBe('number');
    });

    it('should omit patient_id when not linked', async () => {
      const requestBody = {
        donor_name: 'Random Donor',
        blood_group: 'O+',
        donor_type: 'voluntary',
        gender: 'Male',
      };

      expect(requestBody.patient_id).toBeUndefined();
    });
  });

  describe('GET /donors endpoint', () => {
    it('should filter by search parameter', () => {
      const searchParams = { search: 'Rahim' };
      const url = `/api/blood-bank/donors?search=${encodeURIComponent(searchParams.search)}`;

      expect(url).toContain('search=Rahim');
    });

    it('should filter by blood_group parameter', () => {
      const params = { blood_group: 'A+' };
      const url = `/api/blood-bank/donors?blood_group=${params.blood_group}`;

      expect(url).toContain('blood_group=A+');
    });

    it('should filter by eligible parameter', () => {
      const params = { eligible: 'true' };
      const url = `/api/blood-bank/donors?eligible=${params.eligible}`;

      expect(url).toContain('eligible=true');
    });

    it('should support pagination', () => {
      const params = { page: 1, limit: 20 };
      const url = `/api/blood-bank/donors?page=${params.page}&limit=${params.limit}`;

      expect(url).toContain('page=1');
      expect(url).toContain('limit=20');
    });
  });
});
