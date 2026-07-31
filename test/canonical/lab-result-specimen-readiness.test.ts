import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkLabResultSpecimenReadiness,
  validateLabResultSpecimenReadiness,
  type LabResultSpecimenProviderCoverage,
  type LabResultSpecimenReadinessEvidence,
} from '../../scripts/canonical/check-lab-result-specimen-readiness';

function coverage(): LabResultSpecimenProviderCoverage {
  return JSON.parse(readFileSync(
    'docs/database/canonical-lab-result-specimen-provider-coverage.json',
    'utf8',
  )) as LabResultSpecimenProviderCoverage;
}

function readiness(): LabResultSpecimenReadinessEvidence {
  return JSON.parse(readFileSync(
    'docs/database/lab-result-specimen-readiness.json',
    'utf8',
  )) as LabResultSpecimenReadinessEvidence;
}

describe('canonical lab result and specimen readiness', () => {
  it('passes the real repository evidence with provider disabled and runtime activation zero', () => {
    expect(checkLabResultSpecimenReadiness(process.cwd())).toEqual({
      localReady: true,
      productionReady: false,
      issues: [],
      issueCount: 0,
      selectedAdapterCount: 3,
      knownWriterCount: 6,
      knownReaderCount: 12,
      unknownWriterAssignments: 0,
      unknownReaderAssignments: 0,
      blockedGateCount: 2,
    });
  });

  it('fails closed for provider activation, incomplete coverage, or non-legacy rollback', () => {
    const cov = coverage();
    const ready = readiness();
    cov.provider.enabledByDefault = true;
    cov.provider.rollbackMode = 'canonical';
    cov.selectedAdapters[0].routeActivated = true;
    cov.summary.routeActivationCount = 1;
    cov.summary.unknownWriterAssignments = 1;
    cov.summary.unknownReaderAssignments = 1;
    const issues = validateLabResultSpecimenReadiness(process.cwd(), ready, cov);
    expect(issues).toEqual(expect.arrayContaining([
      'provider must be disabled and default to legacy',
      'provider rollback mode must be legacy',
      'selected adapters must not activate routes',
      'route activation count must remain zero',
      'unknown writer assignments must be zero',
      'unknown reader assignments must be zero',
    ]));
  });

  it('fails closed when history, mapping, PHI minimisation, or production gates are overstated', () => {
    const cov = coverage();
    const ready = readiness();
    cov.provider.exactSourceMappingRequired = false;
    cov.provider.specimenCustodyHistoryVisible = false;
    cov.provider.shadowEvidencePhiMinimised = false;
    ready.verifiedContracts.resultVersionHistoryVisible = false;
    ready.verifiedContracts.analyzerProvenanceVisible = false;
    ready.claims.productionReady = true;
    ready.claims.providerEnabled = true;
    ready.claims.productionObservationPresent = true;
    ready.claims.rollbackExecutionEvidencePresent = true;
    ready.claims.ownerAuthorizationPresent = true;
    ready.claims.legacyRetirementApproved = true;
    ready.blockedGates[0].status = 'open';
    const issues = validateLabResultSpecimenReadiness(process.cwd(), ready, cov);
    expect(issues).toEqual(expect.arrayContaining([
      'provider must require exact mapping and forbid text time value similarity',
      'provider must expose custody version observation signature analyzer history and keep report as projection',
      'shadow evidence must be PHI-minimised',
      'history visibility and report projection contracts must be verified',
      'production readiness must remain false',
      'provider and route cutover must remain disabled',
      'production observation rollback execution and owner authorization must remain absent',
      'legacy retirement must remain unapproved',
      'all external gates must remain blocked with reasons',
    ]));
  });
});
