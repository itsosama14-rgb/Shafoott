import { json, fail, readBody, query, methodNotAllowed, rateLimit, clientIp } from '../lib/http.js';
import { hasDatabase } from '../lib/db.js';
import { ensureReady } from '../lib/bootstrap.js';
import { createOrder, getCustomerOrders, cancelOrderByCustomer, AppError } from '../lib/repo.js';

const MESSAGES = {
  orders_closed: 'المطعم مغلق حالياً ولا يستقبل طلبات جديدة.',
  name_invalid: 'الاسم غير صالح.',
  phone_invalid: 'رقم الهاتف غير صالح.',
  address_invalid: 'عنوان التوصيل غير مكتمل.',
  cart_empty: 'السلة فارغة.',
  item_not_found: 'أحد الأصناف لم يعد موجوداً في المنيو.',
  item_unavailable: 'أحد الأصناف غير متوفر حالياً.',
  below_min_order: 'قيمة الطلب أقل من الحد الأدنى.',
  order_not_found: 'الطلب غير موجود.',
  order_not_cancellable: 'لا يمكن إلغاء الطلب بعد بدء تحضيره.',
  forbidden: 'لا تملك صلاحية على هذا الطلب.'
};

/**
 * GET  /api/orders?ids=SF-1001,SF-1002&phone=0500000000   — طلبات الزبون نفسه
 * POST /api/orders              { items, customer, type, payment, coupon, note }  — إنشاء طلب
 * POST /api/orders { action:'cancel', id, phone }          — إلغاء طلب جديد
 */
export default async function handler(req, res) {
  if (!hasDatabase()) return fail(res, 503, 'database_not_configured');
  try { await ensureReady(); } catch (e) { return fail(res, 503, e.code === 'NO_DB' ? 'database_not_configured' : 'db_unreachable'); }

  try {
    if (req.method === 'GET') {
      const qs = query(req);
      const orders = await getCustomerOrders(qs.ids, qs.phone);
      return json(res, 200, { ok: true, orders });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);

      if (body.action === 'cancel') {
        const order = await cancelOrderByCustomer(String(body.id || ''), String(body.phone || ''));
        return json(res, 200, { ok: true, order });
      }

      const lim = rateLimit('order:' + clientIp(req), 12, 60_000);
      if (!lim.ok) {
        res.setHeader('Retry-After', String(lim.retryAfter));
        return fail(res, 429, 'too_many_requests', { message: 'عدد كبير من المحاولات، انتظر قليلاً ثم أعد المحاولة.' });
      }

      const order = await createOrder(body);
      return json(res, 201, { ok: true, order });
    }

    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (err) {
    if (err instanceof AppError) {
      return fail(res, err.status, err.code, { message: MESSAGES[err.code] || 'تعذّر إتمام العملية.', ...err.extra });
    }
    console.error('orders error', err);
    return fail(res, 500, 'server_error', { message: 'خطأ غير متوقع، حاول مرة أخرى.' });
  }
}
