function compactHl7Timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function parseMshFields(hl7Message) {
  const msh = String(hl7Message || '').split('\r')[0] || '';
  const fields = msh.split('|');
  return {
    sendingApp: fields[2] || '',
    sendingFacility: fields[3] || '',
    messageControlId: fields[9] || '',
    processingId: fields[10] || 'P',
    version: fields[11] || '2.3',
  };
}

function resolveHl7AckDecision(apiResult, ackMode = 'always_ack_after_queue') {
  if (apiResult?.ok) {
    return { code: 'AA', text: 'accepted' };
  }

  if (ackMode === 'always_ack_after_queue' && apiResult?.queued) {
    return { code: 'AA', text: 'accepted_for_retry' };
  }

  const status = Number(apiResult?.status || 0);
  if (status >= 400 && status < 500 && status !== 429) {
    return { code: 'AR', text: `rejected_${status}` };
  }

  return { code: 'AE', text: apiResult?.queued ? 'queued_but_not_acked_by_policy' : 'processing_error' };
}

function buildHl7Ack(hl7Message, decision, options = {}) {
  const fields = parseMshFields(hl7Message);
  const timestamp = compactHl7Timestamp(options.date || new Date());
  const ackControlId = options.ackControlId || fields.messageControlId || timestamp;
  const processingId = fields.processingId || 'P';
  const version = fields.version || '2.3';
  const code = decision?.code || 'AE';
  const text = decision?.text ? `|${decision.text}` : '';

  return [
    `MSH|^~\\&|HMS|OZZYL|${fields.sendingApp}|${fields.sendingFacility}|${timestamp}||ACK|${ackControlId}|${processingId}|${version}`,
    `MSA|${code}|${fields.messageControlId}${text}`,
    '',
  ].join('\r');
}

function wrapMllp(message) {
  return `\x0b${message}\x1c\x0d`;
}

module.exports = {
  buildHl7Ack,
  compactHl7Timestamp,
  parseMshFields,
  resolveHl7AckDecision,
  wrapMllp,
};
