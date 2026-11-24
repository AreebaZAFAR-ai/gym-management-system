// Demo external fingerprint device (mock). No real hardware, brand, SDK or protocol.
// It does what any real device or bridge must do: send a fingerprint ID to
// POST /v1/devices/<gymId>/fingerprint with the gym's device key (§10).
// Only the ID is sent; no fingerprint image or biometric template exists here.
//
// Usage (from api/):
//   DEVICE_KEY=<key from Settings> node scripts/demo-fingerprint-device.mjs <gymId> <fingerprintId>
// Optional: API_URL (default http://localhost:3000). The key is never printed.

const [gymId, fingerprintId] = process.argv.slice(2);
const deviceKey = process.env.DEVICE_KEY;
const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

if (!gymId || !fingerprintId || !deviceKey) {
  console.error('Usage: DEVICE_KEY=<key> node scripts/demo-fingerprint-device.mjs <gymId> <fingerprintId>');
  process.exit(2);
}

const res = await fetch(`${apiUrl}/v1/devices/${encodeURIComponent(gymId)}/fingerprint`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
  body: JSON.stringify({ fingerprintId }),
});
const body = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 1);
