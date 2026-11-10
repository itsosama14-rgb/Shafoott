import { json, fail } from '../lib/http.js';
import { q, hasDatabase } from '../lib/db.js';

/** GET /api/health — فحص جاهزية الموقع وقاعدة البيانات */
export default async function handler(req, res) {
  if (!hasDatabase()) return fail(res, 503, 'database_not_configured');
  try {
    const [row] = await q('select now() as now');
    return json(res, 200, { ok: true, db: true, time: row.now });
  } catch (err) {
    return fail(res, 500, 'db_unreachable', { message: err.message });
  }
}
