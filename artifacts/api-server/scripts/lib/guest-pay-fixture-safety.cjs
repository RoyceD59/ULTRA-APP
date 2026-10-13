'use strict';

const { randomBytes } = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const DB_NAME = /^guestpay_fixture_\d{13}_\d+$/;
const fixtureError = () => Object.assign(new Error('Fixture safety check failed'), { code: 'FIXTURE_UNSAFE' });

function assertDatabase(name, connectionString) {
  const url = new URL(connectionString);
  if (!DB_NAME.test(name) || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      decodeURIComponent(url.pathname.slice(1)) !== name) throw fixtureError();
  return url;
}

function assertDevelopment(env) {
  if (env.NODE_ENV === 'production' ||
      (env.REPLIT_DEPLOYMENT && !['false', '0'].includes(env.REPLIT_DEPLOYMENT))) throw fixtureError();
}

function fixtureEnvironment(parent, databaseUrl, name, port, directory) {
  assertDevelopment(parent);
  assertDatabase(name, databaseUrl);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fixtureError();
  // Never spread process.env here: live credentials and connector identity are excluded.
  return {
    PATH: parent.PATH || '', HOME: directory, LANG: 'C.UTF-8', TZ: 'Africa/Nairobi',
    NODE_ENV: 'guestpay-fixture', GOMAXPROCS: '2',
    npm_config_manage_package_manager_versions: 'false',
    DATABASE_URL: databaseUrl, SESSION_SECRET: randomBytes(32).toString('base64url'),
    LOG_LEVEL: 'silent', STRIPE_ENABLED: 'false', MPESA_ENV: 'sandbox',
    UC_GUEST_PAY_PUBLIC_ORIGIN: 'https://guest-pay.test',
    UC_GUEST_PAY_ANALYTICS_BOOTSTRAP_APPROVED: 'false',
    EXPO_PUBLIC_PRODUCT_GA_ENABLED: 'false',
    GUEST_PAY_FIXTURE: 'local-only', GUEST_PAY_FIXTURE_DATABASE: name,
    GUEST_PAY_FIXTURE_PORT: String(port), GUEST_PAY_FIXTURE_DIRECTORY: directory,
  };
}

function assertChildEnvironment(env) {
  if (env.NODE_ENV !== 'guestpay-fixture' || env.GUEST_PAY_FIXTURE !== 'local-only' ||
      env.STRIPE_ENABLED !== 'false' || env.MPESA_ENV !== 'sandbox' ||
      env.UC_GUEST_PAY_ANALYTICS_BOOTSTRAP_APPROVED !== 'false' ||
      env.EXPO_PUBLIC_PRODUCT_GA_ENABLED !== 'false' ||
      env.UC_GUEST_PAY_PUBLIC_ORIGIN !== 'https://guest-pay.test' ||
      !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw fixtureError();
  assertDevelopment(env);
  assertDatabase(env.GUEST_PAY_FIXTURE_DATABASE, env.DATABASE_URL);
  const forbidden = /^(PAYSTACK_|MPESA_(CONSUMER|PASSKEY|SHORTCODE|WEBHOOK)|STRIPE_(SECRET|WEBHOOK)|WC_|CLERK_|VITE_CLERK_|AI_INTEGRATIONS_|RESEND_|SMTP_|REPLIT_(IDENTITY|CONNECTORS|TOKEN)|PRIVATE_OBJECT|PUBLIC_OBJECT|DEFAULT_OBJECT|UC_ADMIN|PROJECTHUB_ADMIN)/;
  if (Object.entries(env).some(([key, value]) => forbidden.test(key) && value)) throw fixtureError();
}

/** Fixture-only transport guard. No provider or notification host is allowed. */
function installNetworkGuard(databaseUrl, port) {
  const db = new URL(databaseUrl);
  let blocked = 0;
  const deny = () => {
    blocked++;
    throw Object.assign(new Error('Outbound access disabled in preparation fixture'), { code: 'FIXTURE_EGRESS_BLOCKED' });
  };
  const local = (host, p) =>
    ['127.0.0.1', 'localhost'].includes(host) && Number(p) === port;
  const checkHttp = (input, options = {}, protocol = 'http:') => {
    let url;
    try {
      if (typeof input === 'string' || input instanceof URL) url = new URL(input);
      else if (input?.url) url = new URL(input.url);
      else {
        const o = { ...input, ...options };
        if (o.socketPath) return deny();
        const host = o.hostname || o.host || 'localhost';
        url = new URL(`${o.protocol || protocol}//${host}${o.port ? ':' + o.port : ''}/`);
      }
    } catch { return deny(); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        !local(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80))) deny();
    // A request's options can override the URL's destination.
    if (options.hostname || options.host || options.port || options.socketPath) {
      const host = options.hostname || options.host || url.hostname;
      if (options.socketPath || !local(host, options.port || url.port)) deny();
    }
  };
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;
  const originalHttpRequest = http.request, originalHttpGet = http.get;
  const originalHttpsRequest = https.request, originalHttpsGet = https.get;
  globalThis.fetch = async (input, init) => {
    checkHttp(input);
    return originalFetch(input, { ...init, redirect: 'error' });
  };
  for (const [module, protocol] of [[http, 'http:'], [https, 'https:']]) {
    for (const method of ['request', 'get']) {
      const original = module[method];
      module[method] = function (...args) {
        checkHttp(args[0], typeof args[1] === 'object' ? args[1] : {}, protocol);
        return original.apply(this, args);
      };
    }
  }
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === 'object' ? first : { port: first, host: args[1] };
    const host = typeof options?.host === 'string' ? options.host : 'localhost';
    const p = Number(options?.port);
    if (options?.path || !(local(host, p) ||
        (host === db.hostname && p === Number(db.port || 5432)))) deny();
    return originalConnect.apply(this, args);
  };
  syncBuiltinESMExports();
  return {
    blocked: () => blocked,
    restore() {
      globalThis.fetch = originalFetch;
      net.Socket.prototype.connect = originalConnect;
      http.request = originalHttpRequest; http.get = originalHttpGet;
      https.request = originalHttpsRequest; https.get = originalHttpsGet;
      syncBuiltinESMExports();
    },
  };
}

module.exports = { assertDatabase, assertDevelopment, fixtureEnvironment, assertChildEnvironment, installNetworkGuard };
