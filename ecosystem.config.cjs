/**
 * PM2 process definitions for a production host (Phase 3, Task 5).
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload storeforge-api          # zero downtime, see below
 *   pm2 save && pm2 startup            # survive a reboot
 *
 * CommonJS (`.cjs`) on purpose: this repo is `"type": "module"`, and PM2 reads
 * its config with `require`.
 *
 * ## Why the API is `cluster` and the storefront is `fork`
 *
 * `pm2 reload` restarts workers one at a time, waiting for each to come up
 * before stopping the next — genuinely zero-downtime, but **only in cluster
 * mode**, because only cluster mode has PM2's master socket to hand the
 * listening port between workers. In fork mode `reload` degrades to a restart
 * with a gap.
 *
 * The API is stateless per request (every bit of state is in Oracle or Redis),
 * so it clusters cleanly, and clustering is also what fixes the throughput
 * ceiling measured in Task 2: one Node process rendering SSR is CPU-bound long
 * before the database is.
 *
 * `next start` runs in fork mode with one instance because Next manages its
 * own workers; running two PM2 copies of it would fight over the port. Scale
 * the storefront by raising that instance count only behind a load balancer
 * that gives each its own port.
 *
 * ## Health
 *
 * `/ready` (Oracle + Redis) is the readiness probe, `/health` the liveness
 * one — see api/src/modules/health/health.routes.js for why they are separate.
 * PM2 has no built-in HTTP probe, so `wait_ready` + the process's own signal
 * is what gates a reload; the runbook has the curl loop for verifying it.
 */

const path = require('node:path');

const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'storeforge-api',
      cwd: path.join(root, 'api'),
      script: 'src/server.js',
      exec_mode: 'cluster',
      // One worker per core, capped: past four, Oracle connections become the
      // constraint rather than CPU (DB_POOL_MAX is per worker).
      instances: process.env.API_INSTANCES ? Number(process.env.API_INSTANCES) : 'max',
      max_memory_restart: '512M',
      kill_timeout: 10000,
      listen_timeout: 15000,
      // A worker that crashes on boot must not be restarted forever in a
      // tight loop — that turns a bad deploy into a busy machine that is also
      // down.
      min_uptime: 20000,
      max_restarts: 10,
      restart_delay: 2000,
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      out_file: path.join(root, 'logs', 'pm2-api-out.log'),
      error_file: path.join(root, 'logs', 'pm2-api-err.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'storeforge-storefront',
      cwd: path.join(root, 'storefront'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3001',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '768M',
      kill_timeout: 10000,
      listen_timeout: 20000,
      min_uptime: 20000,
      max_restarts: 10,
      restart_delay: 2000,
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      out_file: path.join(root, 'logs', 'pm2-storefront-out.log'),
      error_file: path.join(root, 'logs', 'pm2-storefront-err.log'),
      merge_logs: true,
      time: true,
    },
    {
      /**
       * The 30-day cart cleanup, which has had no scheduler since Phase 2
       * (docs/BACKLOG.md). PM2's cron restart runs a short-lived process on a
       * schedule; `autorestart: false` is what stops PM2 treating its normal
       * exit as a crash and running it in a loop.
       */
      name: 'storeforge-cart-cleanup',
      cwd: root,
      script: 'scripts/cleanup-expired-carts.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: false,
      cron_restart: '15 3 * * *',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      out_file: path.join(root, 'logs', 'pm2-cart-cleanup.log'),
      error_file: path.join(root, 'logs', 'pm2-cart-cleanup.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
