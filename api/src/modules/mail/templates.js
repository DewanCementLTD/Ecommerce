/**
 * Small, deliberately plain HTML templates — no build step, no external
 * template engine, so they render the same whether the log provider prints
 * them or a real SMTP server delivers them. Every function returns
 * { to, subject, html, text } so the two never drift apart.
 *
 * Localized with fallback, matching the pattern used everywhere else in this
 * project (i18n.service.js's per-field fallback): a lang not in COPY falls
 * back to the company's default language, which falls back to English.
 */

const COPY = {
  en: {
    orderConfirmationSubject: (orderNo) => `Order #${orderNo} confirmed`,
    orderConfirmationHeading: (orderNo) => `Thanks for your order, #${orderNo}`,
    orderConfirmationBody: 'We have received your order and will call you to confirm delivery. Payment is due on delivery.',
    statusChangedSubject: (orderNo) => `Order #${orderNo} update`,
    statusHeadings: {
      confirmed: 'Your order has been confirmed',
      delivered: 'Your order has been delivered',
      cancelled: 'Your order has been cancelled',
    },
    itemsHeading: 'Items',
    totalLabel: 'Total',
    addressHeading: 'Delivery address',
    adminNewOrderSubject: (orderNo) => `New order #${orderNo}`,
    adminNewOrderBody: 'A new order just came in.',
  },
  ar: {
    orderConfirmationSubject: (orderNo) => `تم تأكيد الطلب #${orderNo}`,
    orderConfirmationHeading: (orderNo) => `شكراً لطلبك، رقم #${orderNo}`,
    orderConfirmationBody: 'لقد استلمنا طلبك وسنتصل بك لتأكيد التوصيل. الدفع عند الاستلام.',
    statusChangedSubject: (orderNo) => `تحديث الطلب #${orderNo}`,
    statusHeadings: {
      confirmed: 'تم تأكيد طلبك',
      delivered: 'تم توصيل طلبك',
      cancelled: 'تم إلغاء طلبك',
    },
    itemsHeading: 'العناصر',
    totalLabel: 'الإجمالي',
    addressHeading: 'عنوان التوصيل',
    adminNewOrderSubject: (orderNo) => `طلب جديد #${orderNo}`,
    adminNewOrderBody: 'وصل طلب جديد.',
  },
};

function copyFor(lang) {
  return COPY[lang] ?? COPY.en;
}

function money(amount, currency) {
  return currency ? `${amount} ${currency}` : String(amount);
}

function layout({ company, heading, body, itemsHtml, footer }) {
  const brandColor = company?.theme?.color?.primary ?? '#111827';
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:${brandColor};color:#fff;padding:20px 24px;font-size:18px;font-weight:bold;">
          ${company?.name ?? 'Your store'}
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="font-size:20px;margin:0 0 12px;">${heading}</h1>
          <p style="margin:0 0 16px;line-height:1.5;">${body}</p>
          ${itemsHtml ?? ''}
        </td></tr>
        <tr><td style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;">
          ${footer ?? ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function itemsTable(order, copy) {
  const rows = order.items
    .map(
      (item) =>
        `<tr><td style="padding:4px 0;">${item.nameSnap} × ${item.qty}</td><td style="padding:4px 0;text-align:right;">${money(item.lineTotal, order.currency)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:8px;">
    <tr><td colspan="2" style="font-weight:bold;padding-bottom:6px;">${copy.itemsHeading}</td></tr>
    ${rows}
    <tr><td style="padding-top:8px;font-weight:bold;">${copy.totalLabel}</td>
        <td style="padding-top:8px;font-weight:bold;text-align:right;">${money(order.total, order.currency)}</td></tr>
  </table>`;
}

function itemsText(order, copy) {
  const lines = order.items.map((item) => `- ${item.nameSnap} x${item.qty}: ${money(item.lineTotal, order.currency)}`);
  return [`${copy.itemsHeading}:`, ...lines, `${copy.totalLabel}: ${money(order.total, order.currency)}`].join('\n');
}

export function orderConfirmation({ company, order }) {
  const copy = copyFor(order.lang);
  const heading = copy.orderConfirmationHeading(order.orderNo);
  const html = layout({
    company,
    heading,
    body: copy.orderConfirmationBody,
    itemsHtml: itemsTable(order, copy),
  });
  const text = `${heading}\n\n${copy.orderConfirmationBody}\n\n${itemsText(order, copy)}`;
  return { to: order.email, subject: copy.orderConfirmationSubject(order.orderNo), html, text };
}

export function orderStatusChanged({ company, order }) {
  const copy = copyFor(order.lang);
  const heading = copy.statusHeadings[order.status] ?? copy.statusChangedSubject(order.orderNo);
  const html = layout({ company, heading, body: '', itemsHtml: itemsTable(order, copy) });
  const text = `${heading}\n\n${itemsText(order, copy)}`;
  return { to: order.email, subject: copy.statusChangedSubject(order.orderNo), html, text };
}

export function adminNewOrderNotice({ company, order }) {
  const copy = COPY.en; // internal, staff-facing — not the shopper's language
  const heading = copy.adminNewOrderSubject(order.orderNo);
  const html = layout({ company, heading, body: copy.adminNewOrderBody, itemsHtml: itemsTable(order, copy) });
  const text = `${heading}\n\n${copy.adminNewOrderBody}\n\n${itemsText(order, copy)}`;
  return { subject: heading, html, text };
}
