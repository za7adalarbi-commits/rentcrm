import { attachAppVersionHeaders } from '../backend/versionManifest.js';

export default async function handler(_req: any, res: any) {
  const manifest = attachAppVersionHeaders(res);
  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  res.status(200).json({
    ok: true,
    ...manifest,
    checkedAt: new Date().toISOString()
  });
}
