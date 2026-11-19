import { checkDatabaseHealth } from '../backend/db';

export default async function handler(_req: any, res: any) {
  const health = await checkDatabaseHealth();
  res.status(200).json({
    ok: true,
    service: 'RENTAL GATE CRM',
    timestamp: new Date().toISOString(),
    ...health
  });
}
