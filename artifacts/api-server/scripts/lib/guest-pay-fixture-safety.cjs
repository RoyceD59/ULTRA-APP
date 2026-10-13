'use strict';

const { randomBytes } = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { inspectResponse } = require('./guest-pay-fixture-diagnostics.cjs');

const DB_NAME = /^guestpay_fixture_\d{13}_\d+$/;
const PUBLIC_PREFIX = '/api/guest-pay-fixture';
const MPESA_KEYS = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_PASSKEY',
  'MPESA_SHORTCODE', 'MPESA_WEBHOOK_SECRET'];
function developmentOrigin(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.replit.dev') ||
      url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fixtureError();
  return url.origin;
}
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

function fixtureEnvironment(parent, databaseUrl, name, port, directory, options = {}) {
  assertDevelopment(parent);
  assertDatabase(name, databaseUrl);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fixtureError();
  // Never spread process.env here: live credentials and connector identity are excluded.
  const env = {
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
  if (options.publicOrigin) {
    env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN = developmentOrigin(options.publicOrigin);
    env.GUEST_PAY_FIXTURE_BASE_PATH = PUBLIC_PREFIX;
    env.GUEST_PAY_FIXTURE_INSTANCE = options.instance;
    if (!/^[a-f0-9-]{36}$/.test(options.instance || '')) throw fixtureError();
    env.GUEST_PAY_FIXTURE = options.mpesa ? 'mpesa-sandbox' : 'https-preparation';
    if (options.mpesa) {
      for (const key of MPESA_KEYS) {
        if (!parent[key]?.trim()) throw fixtureError();
        env[key] = parent[key];
      }
      env.API_BASE_URL = env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN + PUBLIC_PREFIX;
      env.UC_GUEST_PAY_PUBLIC_ORIGIN = env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN;
    }
  } else if (options.mpesa) throw fixtureError();
  return env;
}

function assertChildEnvironment(env) {
  const mpesa = env.GUEST_PAY_FIXTURE === 'mpesa-sandbox';
  const publicMode = mpesa || env.GUEST_PAY_FIXTURE === 'https-preparation';
  if (env.NODE_ENV !== 'guestpay-fixture' || !['local-only', 'https-preparation', 'mpesa-sandbox'].includes(env.GUEST_PAY_FIXTURE) ||
      env.STRIPE_ENABLED !== 'false' || env.MPESA_ENV !== 'sandbox' ||
      env.UC_GUEST_PAY_ANALYTICS_BOOTSTRAP_APPROVED !== 'false' ||
      env.EXPO_PUBLIC_PRODUCT_GA_ENABLED !== 'false' ||
      env.UC_GUEST_PAY_PUBLIC_ORIGIN !== (mpesa ? env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN : 'https://guest-pay.test') ||
      !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw fixtureError();
  assertDevelopment(env);
  assertDatabase(env.GUEST_PAY_FIXTURE_DATABASE, env.DATABASE_URL);
  if (publicMode && (developmentOrigin(env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN) !== env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN ||
      env.GUEST_PAY_FIXTURE_BASE_PATH !== PUBLIC_PREFIX ||
      !/^[a-f0-9-]{36}$/.test(env.GUEST_PAY_FIXTURE_INSTANCE || ''))) throw fixtureError();
  if (mpesa && (env.API_BASE_URL !== env.GUEST_PAY_FIXTURE_PUBLIC_ORIGIN + PUBLIC_PREFIX ||
      MPESA_KEYS.some(key => !env[key]?.trim()))) throw fixtureError();
  if (!mpesa && env.API_BASE_URL) throw fixtureError();
  const forbidden = /^(PAYSTACK_|MPESA_(CONSUMER|PASSKEY|SHORTCODE|WEBHOOK)|STRIPE_(SECRET|WEBHOOK)|WC_|CLERK_|VITE_CLERK_|AI_INTEGRATIONS_|RESEND_|SMTP_|REPLIT_(IDENTITY|CONNECTORS|TOKEN)|PRIVATE_OBJECT|PUBLIC_OBJECT|DEFAULT_OBJECT|UC_ADMIN|PROJECTHUB_ADMIN)/;
  if (Object.entries(env).some(([key, value]) => forbidden.test(key) && value &&
      !(mpesa && MPESA_KEYS.includes(key)))) throw fixtureError();
}

/** Fixture-only transport guard. No provider or notification host is allowed. */
function installNetworkGuard(databaseUrl, port, { mpesa = false, onProviderDiagnostic } = {}) {
  const db = new URL(databaseUrl);
  let blocked = 0;
  const deny = () => {
    blocked++;
    throw Object.assign(new Error('Outbound access disabled in preparation fixture'), { code: 'FIXTURE_EGRESS_BLOCKED' });
  };
  const local = (host, p) =>
    ['127.0.0.1', 'localhost'].includes(host) && Number(p) === port;
  const sandbox = url => mpesa && url.protocol === 'https:' &&
    url.hostname === 'sandbox.safaricom.co.ke' && (!url.port || url.port === '443') &&
    ['/oauth/v1/generate', '/mpesa/stkpush/v1/processrequest', '/mpesa/stkpushquery/v1/query'].includes(url.pathname);
  const checkHttp = (input, options = {}, protocol = 'http:') => {
    let url;
    try {
      if (typeof input === 'string' || input instanceof URL) url = new URL(input);
      else if (input?.url) url = new URL(input.url);
      else {
        const o = { ...input, ...options };
        if (o.socketPath) return deny();
        const host = o.hostname || o.host || 'localhost';
        url = new URL(`${o.protocol || protocol}//${host}${o.port ? ':' + o.port : ''}${o.path || '/'}`);
      }
    } catch { return deny(); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        !(local(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80)) || sandbox(url))) deny();
    // A request's options can override the URL's destination.
    if (options.hostname || options.host || options.port || options.socketPath) {
      const host = options.hostname || options.host || url.hostname;
      if (options.socketPath || !(local(host, options.port || url.port) ||
          (sandbox(url) && host === url.hostname && Number(options.port || url.port || 443) === 443))) deny();
    }
  };
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;
  const originalHttpRequest = http.request, originalHttpGet = http.get;
  const originalHttpsRequest = https.request, originalHttpsGet = https.get;
  globalThis.fetch = async (input, init) => {
    checkHttp(input);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const family = sandbox(url) ? ({
      '/oauth/v1/generate': 'mpesa_oauth',
      '/mpesa/stkpush/v1/processrequest': 'mpesa_initialize',
      '/mpesa/stkpushquery/v1/query': 'mpesa_query',
    })[url.pathname] : null;
    const emit = details => {
      // Optional diagnostic output must never change payment-handler behavior.
      try { if (family && onProviderDiagnostic) onProviderDiagnostic({ family, ...details }); } catch {}
    };
    try {
      const response = await originalFetch(input, { ...init, redirect: 'error' });
      if (family && onProviderDiagnostic) emit(await inspectResponse(response));
      return response;
    } catch (error) {
      emit({ status: 0, code: 'unclassified',
        issue: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'transport_timeout' : 'transport_failure',
        referenceReturned: false });
      throw error;
    }
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
        (host === db.hostname && p === Number(db.port || 5432)) ||
        (mpesa && host === 'sandbox.safaricom.co.ke' && p === 443))) deny();
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

module.exports = { assertDatabase, assertDevelopment, fixtureEnvironment, assertChildEnvironment,
  installNetworkGuard, developmentOrigin, PUBLIC_PREFIX, MPESA_KEYS };
