const SALT_BYTES = 16;

// Measures how long PBKDF2-SHA256 actually takes on this device, at the
// iteration count the app's real key derivation uses (see src/crypto).
// No published benchmark exists for recent iPhone Safari — this has to be
// measured on device rather than assumed. All browser dependencies are
// injected so this runs identically under Node's native WebCrypto (fast CI
// smoke test) and in the real browser (the number that actually matters).
export async function benchmarkPbkdf2({
  subtle,
  getRandomValues,
  iterations,
  now = () => performance.now(),
}) {
  const passphraseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode('pbkdf2-benchmark'),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const salt = getRandomValues(new Uint8Array(SALT_BYTES));

  const start = now();
  await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passphraseKey,
    256,
  );
  const elapsedMs = now() - start;

  return { iterations, elapsedMs };
}
