function pixTLV(id, value) {
  const len = value.length.toString().padStart(2, '0');
  return id + len + value;
}

function pixCRC16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function pixSanitize(str, max) {
  const clean = (str || '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .slice(0, max);
  return clean || '-';
}

// Builds a Pix "copia e cola" BR Code string per the Banco Central EMV QR Code spec.
function buildPixPayload({ key, name, city, amount, txid }) {
  const merchantAccountInfo = pixTLV('26', pixTLV('00', 'br.gov.bcb.pix') + pixTLV('01', (key || '').toString().trim()));
  const amountStr = amount && Number(amount) > 0 ? Number(amount).toFixed(2) : '';
  const cleanTxid = pixSanitize(txid, 25).replace(/\s/g, '').slice(0, 25) || '***';

  let payload =
    pixTLV('00', '01') +
    merchantAccountInfo +
    pixTLV('52', '0000') +
    pixTLV('53', '986') +
    (amountStr ? pixTLV('54', amountStr) : '') +
    pixTLV('58', 'BR') +
    pixTLV('59', pixSanitize(name, 25)) +
    pixTLV('60', pixSanitize(city, 15)) +
    pixTLV('62', pixTLV('05', cleanTxid)) +
    '6304';

  return payload + pixCRC16(payload);
}

function pixQrImageUrl(payload, size) {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=' + (size || 220) + 'x' + (size || 220) + '&data=' + encodeURIComponent(payload);
}
