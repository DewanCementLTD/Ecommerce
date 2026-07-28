import { logger } from './logger.js';
import { env } from '../config/env.js';

/**
 * Error tracking behind a provider interface, the same shape `modules/mail/`
 * uses: a `log` provider that always works, and a real one selected by
 * configuration.
 *
 * Sentry is loaded **dynamically and only when `SENTRY_DSN` is set**. Adding
 * `@sentry/node` as an unconditional dependency would put an agent that
 * instruments HTTP, the database driver and the process into every install —
 * including CI and every developer's machine — to serve a feature that is off
 * by default. If the DSN is set and the package is missing, that is reported
 * once, loudly, rather than silently swallowing every error report from then
 * on.
 *
 * **Every report is tagged with the company.** A platform hosting many stores
 * produces errors that are meaningless without knowing whose store they came
 * from: "500 on /shop/checkout" is a shrug, "500 on /shop/checkout for company
 * 41, twelve times in an hour" is a phone call to a client.
 */

let provider = null;
let initializing = null;

async function loadProvider() {
  if (!env.sentry.dsn) {
    return {
      name: 'log',
      capture(error, context) {
        logger.error({ err: error, ...context }, 'unhandled error');
      },
    };
  }

  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: env.sentry.dsn,
      environment: env.nodeEnv,
      release: env.sentry.release ?? undefined,
      tracesSampleRate: 0,
    });

    logger.info('error tracking: sentry');

    return {
      name: 'sentry',
      capture(error, context) {
        Sentry.withScope((scope) => {
          if (context.companyId) scope.setTag('company_id', String(context.companyId));
          if (context.reqId) scope.setTag('req_id', context.reqId);
          if (context.route) scope.setTag('route', context.route);
          scope.setContext('request', context);
          Sentry.captureException(error);
        });
        logger.error({ err: error, ...context }, 'unhandled error');
      },
    };
  } catch (err) {
    logger.error(
      { err },
      'SENTRY_DSN is set but @sentry/node could not be loaded — install it, or unset the DSN. Falling back to log-only error tracking.',
    );
    return {
      name: 'log',
      capture(error, context) {
        logger.error({ err: error, ...context }, 'unhandled error');
      },
    };
  }
}

async function getProvider() {
  if (provider) return provider;
  initializing = initializing ?? loadProvider();
  provider = await initializing;
  return provider;
}

/**
 * Reports an error that reached the top of a request. Never throws and never
 * awaits on the request path — a monitoring outage must not become an
 * application outage.
 */
export function captureError(error, context = {}) {
  getProvider()
    .then((active) => active.capture(error, context))
    .catch(() => {
      logger.error({ err: error, ...context }, 'unhandled error (tracker unavailable)');
    });
}
