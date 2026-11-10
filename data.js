import { json, fail, methodNotAllowed } from '../lib/http.js';
import { getPublicData } from '../lib/repo.js';
import { hasDatabase } from '../lib/db.js';
import { ensureReady } from '../lib/bootstrap.js';

/** GET /api/data — بيانات الموقع العامة (إعدادات + منيو + أقسام + كوبونات فعّالة) */
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!hasDatabase()) return fail(res, 503, 'database_not_configured');
  try {
    await ensureReady(); // تهيئة تلقائية: جداول + إعدادات + أصناف بداية عند أول طلب
    const data = await getPublicData();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
    return json(res, 200, { ok: true, ...data, serverTime: Date.now() });
  } catch (err) {
    console.error('data error', err);
    return fail(res, 500, 'server_error');
  }
}
