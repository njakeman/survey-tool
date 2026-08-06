// Browser-only: client-zip's downloadZip() builds a real ZIP via a Response
// object. Thin wrapper — entry assembly (what goes in the zip) lives in
// buildSessionExport.js, kept node-testable; this file is just plumbing.

import { downloadZip } from 'client-zip';

export async function zipEntries(entries) {
  const response = downloadZip(entries);
  return response.blob();
}
