// ═══════════════════════════════════════════════════════════════════════════════
// Ozzyl HMS — DICOM Print Agent: Test Sender
//
// Sends a test DICOM C-STORE request to verify the agent is working.
// Usage: node test/test-send.js [host] [port]
// ═══════════════════════════════════════════════════════════════════════════════

const dcmjsDimse = require('dcmjs-dimse');
const { Client, Dataset } = dcmjsDimse;
const { CStoreRequest } = dcmjsDimse.requests;
const { Status } = dcmjsDimse.constants;

const host = process.argv[2] || '127.0.0.1';
const port = parseInt(process.argv[3] || '4006', 10);

async function sendTestImage() {
  console.log(`Sending test DICOM to ${host}:${port}...`);

  // Create a synthetic DICOM dataset (no real pixel data, but metadata is valid)
  const dataset = new Dataset({
    PatientID: 'TEST001',
    PatientName: 'TEST^PATIENT',
    PatientBirthDate: '19900101',
    PatientSex: 'M',
    StudyInstanceUID: Dataset.generateDerivedUid(),
    SeriesInstanceUID: Dataset.generateDerivedUid(),
    SOPInstanceUID: Dataset.generateDerivedUid(),
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.1', // Computed Radiography Image Storage
    Modality: 'CR',
    StudyDate: new Date().toISOString().replace(/-/g, '').substring(0, 8),
    StudyDescription: 'Test X-Ray from DICOM Print Agent',
    InstitutionName: 'Ozzyl HMS Test',
  });

  const request = new CStoreRequest(dataset);

  request.on('response', (response) => {
    if (response.getStatus() === Status.Success) {
      console.log('✅ C-STORE Success! Agent is receiving DICOM images correctly.');
    } else {
      console.log(`❌ C-STORE returned status: ${response.getStatus()}`);
    }
  });

  const client = new Client();
  client.addRequest(request);

  client.on('networkError', (e) => {
    console.error(`❌ Network error: ${e.message}`);
    console.log('');
    console.log('Troubleshooting:');
    console.log(`  1. Is the agent running? (npm start)`);
    console.log(`  2. Is port ${port} open? (check firewall)`);
    console.log(`  3. Is the host correct? (${host})`);
  });

  client.on('closed', () => {
    console.log('Connection closed.');
  });

  client.send(host, port, 'TEST_SCU', 'OZZYL_PRINT');
}

sendTestImage().catch(console.error);
