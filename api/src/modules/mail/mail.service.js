import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { logProvider } from './providers/log.js';
import { smtpProvider } from './providers/smtp.js';
import * as templates from './templates.js';

const PROVIDERS = { log: logProvider, smtp: smtpProvider };

function currentProvider() {
  return PROVIDERS[env.mail.provider] ?? logProvider;
}

async function send(message) {
  if (!message.to) return; // no address to send to (e.g. a phone-only guest order)
  try {
    await currentProvider().send(message);
  } catch (err) {
    // A failed send must never fail the request that triggered it — checkout
    // has already committed by the time these are called.
    logger.error({ err, to: message.to, subject: message.subject }, 'failed to send email');
  }
}

export async function sendOrderConfirmation({ company, order }) {
  await send(templates.orderConfirmation({ company, order }));
}

export async function sendOrderStatusChanged({ company, order, fromStatus }) {
  if (order.status === fromStatus) return;
  await send(templates.orderStatusChanged({ company, order }));
}

export async function sendAdminNewOrderNotice({ company, order }) {
  const to = company?.email;
  if (!to) return;
  await send({ to, ...templates.adminNewOrderNotice({ company, order }) });
}
