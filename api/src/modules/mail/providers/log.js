import { logger } from '../../../lib/logger.js';

/**
 * The default provider. This dev box has no SMTP catcher (no Docker, no
 * Mailhog — see docs/DECISIONS.md's "no Docker" entry), so writing the
 * rendered email to the log is the honest option: nothing pretends to send
 * mail it can't actually deliver.
 */
export const logProvider = {
  async send({ to, subject, text }) {
    logger.info({ to, subject, preview: text.slice(0, 500) }, 'email (log provider — not actually sent)');
  },
};
