import { json, fail, readBody, query, methodNotAllowed, rateLimit, clientIp } from '../lib/http.js';
import { hasDatabase } from '../lib/db.js';
import { ensureReady } from '../lib/bootstrap.js';
import { isAuthed, requireAdmin, createSession, setSessionCookie, clearSessionCookie, hashPassword, verifyPassword } from '../lib/auth.js';
import {
  adminData, getSettings, setAdminPasswordHash, saveSettings,
  saveItem, toggleItem, deleteItem,
  saveCategory, deleteCategory,
  saveCoupon, toggleCoupon, deleteCoupon,
  setOrderStatus, deleteOrder, clearOrders, AppError
} from '../lib/repo.js';

const MESSAGES = {
  category_name_required: 'اسم القسم مطلوب.',
  category_not_empty: 'لا يمكن حذف قسم يحتوي أصنافاً — انقل الأصناف أولاً.',
  category_not_found: 'القسم غير موجود.',
  item_name_required: 'اسم الصنف مطلوب.',
  item_price_invalid: 'سعر الصنف غير صالح.',
  item_category_invalid: 'القسم المحدّد غير صالح.',
  item_not_found: 'الصنف غير موجود.',
  coupon_code_required: 'كود الكوبون مطلوب.',
  coupon_value_invalid: 'قيمة الكوبون غير صالحة.',
  coupon_not_found: 'الكوبون غير موجود.',
  status_invalid: 'حالة الطلب غير صالحة.',
  order_not_found: 'الطلب غير موجود.'
};

/** GET  /api/admin?action=session | data
 *  POST /api/admin  { action, ...payload }  */
export default async function handler(req, res) {
  if (!hasDatabase()) return fail(res, 503, 'database_not_configured');
  try { await ensureReady(); } catch (e) { return fail(res, 503, e.code === 'NO_DB' ? 'database_not_configured' : 'db_unreachable'); }

  try {
    if (req.method === 'GET') {
      const { action } = query(req);
      if (action === 'session') return json(res, 200, { ok: true, authed: isAuthed(req) });
      if (action === 'data') {
        if (!requireAdmin(req, res)) return;
        return json(res, 200, { ok: true, ...(await adminData()) });
      }
      return fail(res, 400, 'bad_action');
    }

    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

    const body = await readBody(req);
    const action = String(body.action || '');

    /* ---------- الدخول ---------- */
    if (action === 'login') {
      const lim = rateLimit('login:' + clientIp(req), 6, 5 * 60_000);
      if (!lim.ok) {
        res.setHeader('Retry-After', String(lim.retryAfter));
        return fail(res, 429, 'too_many_attempts', { message: 'محاولات دخول كثيرة — انتظر بضع دقائق.' });
      }
      const password = String(body.password || '');
      const settings = await getSettings(true);
      let hash = settings.adminPasswordHash;
      const envPass = process.env.ADMIN_PASSWORD;

      if (!hash) {
        if (!envPass) {
          return fail(res, 503, 'admin_not_configured', { message: 'لم تُضبط كلمة مرور الإدارة بعد. أضف ADMIN_PASSWORD ثم نفّذ npm run db:seed.' });
        }
        if (password !== envPass) return fail(res, 401, 'bad_credentials', { message: 'كلمة المرور غير صحيحة.' });
        hash = hashPassword(envPass);
        await setAdminPasswordHash(hash);
      }
      if (!verifyPassword(password, hash)) {
        return fail(res, 401, 'bad_credentials', { message: 'كلمة المرور غير صحيحة.' });
      }
      setSessionCookie(res, createSession());
      return json(res, 200, { ok: true, authed: true });
    }

    if (action === 'logout') {
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    /* كل ما يلي يتطلّب جلسة صالحة */
    if (!requireAdmin(req, res)) return;

    switch (action) {
      case 'order.status':
        await setOrderStatus(String(body.id || ''), String(body.status || ''));
        break;
      case 'order.delete':
        await deleteOrder(String(body.id || ''));
        break;
      case 'orders.clear':
        await clearOrders(body.status ? String(body.status) : null);
        break;
      case 'item.save':
        await saveItem(body.item || {});
        break;
      case 'item.toggle':
        await toggleItem(String(body.id || ''));
        break;
      case 'item.delete':
        await deleteItem(String(body.id || ''));
        break;
      case 'cat.save':
        await saveCategory(body.category || {});
        break;
      case 'cat.delete':
        await deleteCategory(String(body.id || ''));
        break;
      case 'coupon.save':
        await saveCoupon(body.coupon || {});
        break;
      case 'coupon.toggle':
        await toggleCoupon(String(body.id || ''));
        break;
      case 'coupon.delete':
        await deleteCoupon(String(body.id || ''));
        break;
      case 'settings.save':
        await saveSettings(body.settings || {});
        break;
      case 'password.change': {
        const settings = await getSettings(true);
        if (!verifyPassword(String(body.currentPassword || ''), settings.adminPasswordHash)) {
          return fail(res, 401, 'bad_credentials', { message: 'كلمة المرور الحالية غير صحيحة.' });
        }
        const next = String(body.password || '');
        if (next.length < 6) return fail(res, 400, 'weak_password', { message: 'كلمة المرور الجديدة قصيرة (6 أحرف على الأقل).' });
        await setAdminPasswordHash(hashPassword(next));
        setSessionCookie(res, createSession());
        return json(res, 200, { ok: true, ...(await adminData()) });
      }
      default:
        return fail(res, 400, 'bad_action');
    }

    return json(res, 200, { ok: true, ...(await adminData()) });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(res, err.status, err.code, { message: MESSAGES[err.code] || 'تعذّر إتمام العملية.', ...err.extra });
    }
    console.error('admin error', err);
    return fail(res, 500, 'server_error', { message: 'خطأ غير متوقع في الخادم.' });
  }
}
