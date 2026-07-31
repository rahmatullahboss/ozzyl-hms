// HL7 Listener Agent for Ozzyl HMS
// Requirements: npm install hl7-standard axios dotenv 
// Note: This is a middleware skeleton designed to be installed on the hospital's local network.

const net = require('net');
const hl7 = require('hl7-standard');
const axios = require('axios');
require('dotenv').config();

const OZZYL_API_URL = process.env.OZZYL_API_URL || 'https://api.hms.ozzyl.com/v1/tenant/lab/machine/receive';
const OZZYL_API_KEY = process.env.OZZYL_API_KEY || 'your-secret-api-key';
const TCP_PORT = process.env.TCP_PORT || 2575; // standard HL7 MLLP port

const server = net.createServer((socket) => {
    console.log(`[+] Machine connected: ${socket.remoteAddress}:${socket.remotePort}`);

    let dataBuffer = '';

    socket.on('data', async (data) => {
        // MLLP envelope handling: starts with 0x0B, ends with 0x1C 0x0D
        dataBuffer += data.toString();
        
        while (dataBuffer.includes('\x1c\x0d')) {
            const endIdx = dataBuffer.indexOf('\x1c\x0d');
            let hl7MessageStr = dataBuffer.substring(0, endIdx);
            
            // Remove start block 0x0B
            if (hl7MessageStr.startsWith('\x0b')) {
                hl7MessageStr = hl7MessageStr.substring(1);
            }

            dataBuffer = dataBuffer.substring(endIdx + 2);
            await processHL7Message(hl7MessageStr, socket);
        }
    });

    socket.on('error', (err) => console.error(`[-] Socket error: ${err.message}`));
    socket.on('close', () => console.log('[-] Machine disconnected'));
});

async function processHL7Message(hl7String, socket) {
    try {
        let message = new hl7(hl7String);
        message.transform();
        
        // Extract basic data (assuming standard ORU_R01 message format)
        const sendingApp = message.getSegment('MSH').get('MSH.3');
        const pidSegment = message.getSegment('PID');
        const obxSegments = message.getSegments('OBX');
        const obrSegment = message.getSegment('OBR');

        const deviceId = sendingApp;
        const patientId = pidSegment ? pidSegment.get('PID.3') : null;
        
        // OBR.2 is Placer Order Number, OR OBR.3 Filler Order Number (Barcode)
        const orderNo = obrSegment ? obrSegment.get('OBR.2') : null; 
        const barcode = obrSegment ? obrSegment.get('OBR.3') : null;

        const testCodes = [];

        for (const obx of obxSegments) {
            testCodes.push({
                code: obx.get('OBX.3.1'), // Test ID
                result: obx.get('OBX.5.1'), // Result Value
                unit: obx.get('OBX.6.1'), // Units
                abnormalFlag: obx.get('OBX.8.1') // Abnormal flag (L, H, etc)
            });
        }

        const payload = {
            deviceId,
            patientId: patientId ? parseInt(patientId) : undefined,
            orderNo: orderNo || undefined,
            barcode: barcode || undefined,
            testCodes
        };

        console.log('[*] Parsed Payload automatically converting HL7 to JSON');
        console.log(JSON.stringify(payload, null, 2));

        try {
            // Push to Cloudflare Worker
            const response = await axios.post(OZZYL_API_URL, payload, {
                headers: { 'Authorization': `Bearer ${OZZYL_API_KEY}` }
            });
            console.log(`[+] Cloudflare Push Success: ${response.data.message}`);
            
            // Send ACK back to machine
            const ack = message.buildACK();
            socket.write('\x0b' + ack + '\x1c\x0d');
            
        } catch (postError) {
            console.error(`[-] Cloudflare API Error: ${postError.message}`);
            // Send NACK to machine
        }

    } catch (e) {
         console.error('[-] HL7 Parsing Error:', e);
    }
}

server.listen(TCP_PORT, () => {
    console.log(`[+] Ozzyl HL7 Middleware Agent listening on TCP port ${TCP_PORT}...`);
    console.log(`[+] Forwarding to: ${OZZYL_API_URL}`);
});
