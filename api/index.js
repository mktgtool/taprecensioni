'use strict';
// API di tappala: login del pannello, dati del pannello e funzioni pubbliche del checkout.
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = DB_URL ? neon(DB_URL) : null;
const COOKIE = 'tap_admin';
const SESSION_SECONDS = 7 * 24 * 3600;
const MAX_FAILS = 5;
const KV_KEYS = ['product', 'theme', 'checkout', 'pages', 'uploads'];
const COLLECTIONS = { orders: 'id', abandoned: 'id', discounts: 'code' };
const DEFAULT_PRODUCT = {
  title: 'Card NFC Recensioni Google',
  status: 'Attivo',
  variants: [
    { id: 'uno', name: '1 card', price: 30, min: 1, fixed: true },
    { id: 'due', name: '2 card', price: 50, min: 1, fixed: true },
    { id: 'pack', name: '3 card o più', price: 24, min: 3, fixed: false }
  ]
};
const CUSTOMER_FIELDS = ['email', 'phone', 'gmaps', 'firstName', 'lastName', 'address', 'zip', 'city', 'province', 'invType', 'company', 'vat', 'sdi', 'cf'];

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      await sql`create table if not exists sessions (token_hash text primary key, expires_at timestamptz not null)`;
      await sql`create table if not exists login_attempts (ip text not null, at timestamptz not null default now())`;
      await sql`create table if not exists kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now())`;
      await sql`create table if not exists orders (id text primary key, number int, at bigint not null, data jsonb not null)`;
      await sql`create table if not exists abandoned (id text primary key, at bigint not null, data jsonb not null)`;
      await sql`create table if not exists discounts (code text primary key, data jsonb not null)`;
      await sql`create sequence if not exists order_seq start 1001`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const hex = (s) => sha(s).toString('hex');
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
function clientIp(req) { return str(String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'sconosciuto', 64); }
function cookieToken(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{20,})'));
  return m ? m[1] : null;
}
function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
async function isAdmin(req) {
  const t = cookieToken(req);
  if (!t) return false;
  const rows = await sql`select 1 from sessions where token_hash = ${hex(t)} and expires_at > now()`;
  return rows.length > 0;
}
async function product() {
  const rows = await sql`select value from kv where key = 'product'`;
  return rows.length ? rows[0].value : DEFAULT_PRODUCT;
}

// ===== Login =====
async function login(req, res) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return send(res, 503, { error: 'Password del pannello non ancora impostata su Vercel' });
  const ip = clientIp(req);
  const [{ n }] = await sql`select count(*)::int as n from login_attempts where ip = ${ip} and at > now() - interval '15 minutes'`;
  if (n >= MAX_FAILS) return send(res, 429, { error: 'Troppi tentativi: riprova tra 15 minuti' });
  const given = str(body(req).password, 200);
  if (!crypto.timingSafeEqual(sha(given), sha(pw))) {
    await sql`insert into login_attempts (ip) values (${ip})`;
    return send(res, 401, { error: 'Password errata' });
  }
  await sql`delete from login_attempts where ip = ${ip} or at < now() - interval '1 day'`;
  await sql`delete from sessions where expires_at < now()`;
  const token = crypto.randomBytes(32).toString('base64url');
  await sql`insert into sessions (token_hash, expires_at) values (${hex(token)}, now() + make_interval(secs => ${SESSION_SECONDS}))`;
  send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}` });
}
async function logout(req, res) {
  const t = cookieToken(req);
  if (t) await sql`delete from sessions where token_hash = ${hex(t)}`;
  send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

// ===== Pannello =====
async function state(res) {
  const kv = {};
  (await sql`select key, value from kv`).forEach((r) => { kv[r.key] = r.value; });
  const orders = (await sql`select data from orders order by at desc`).map((r) => r.data);
  const abandoned = (await sql`select data from abandoned order by at desc limit 2000`).map((r) => r.data);
  const discounts = (await sql`select data from discounts`).map((r) => r.data);
  send(res, 200, { kv, orders, abandoned, discounts });
}
async function patchState(req, res) {
  const b = body(req);
  if (JSON.stringify(b).length > 4000000) return send(res, 413, { error: 'Dati troppo grandi' });
  for (const k of Object.keys(b.kv || {})) {
    if (!KV_KEYS.includes(k)) continue;
    const v = JSON.stringify(b.kv[k]);
    await sql`insert into kv (key, value, updated_at) values (${k}, ${v}::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`;
  }
  for (const [c, key] of Object.entries(COLLECTIONS)) {
    for (const item of ((b.upsert || {})[c] || [])) {
      const id = str(item && item[key], 60);
      if (!id) continue;
      const json = JSON.stringify(item);
      const at = Number(item.at) || Date.now();
      if (c === 'orders') await sql`insert into orders (id, number, at, data) values (${id}, ${parseInt(item.number, 10) || null}, ${at}, ${json}::jsonb) on conflict (id) do update set number = excluded.number, at = excluded.at, data = excluded.data`;
      if (c === 'abandoned') await sql`insert into abandoned (id, at, data) values (${id}, ${at}, ${json}::jsonb) on conflict (id) do update set at = excluded.at, data = excluded.data`;
      if (c === 'discounts') await sql`insert into discounts (code, data) values (${id}, ${json}::jsonb) on conflict (code) do update set data = excluded.data`;
    }
    for (const raw of ((b.remove || {})[c] || [])) {
      const id = str(raw, 60);
      if (c === 'orders') await sql`delete from orders where id = ${id}`;
      if (c === 'abandoned') await sql`delete from abandoned where id = ${id}`;
      if (c === 'discounts') await sql`delete from discounts where code = ${id}`;
    }
  }
  send(res, 200, { ok: true });
}
async function nextNumber(res) {
  const [{ n }] = await sql`select nextval('order_seq')::int as n`;
  send(res, 200, { number: n });
}

// ===== Pubblico (checkout) =====
async function publicConfig(res) {
  const rows = await sql`select value from kv where key = 'checkout'`;
  send(res, 200, { product: await product(), checkout: rows.length ? rows[0].value : { phoneRequired: false } });
}
async function publicDiscount(url, res) {
  const code = str(url.searchParams.get('code'), 30).trim().toUpperCase();
  if (!code) return send(res, 404, { error: 'Codice non valido' });
  const rows = await sql`select data from discounts where code = ${code}`;
  const d = rows.length ? rows[0].data : null;
  if (!d || !d.active) return send(res, 404, { error: 'Codice non valido' });
  const { type, value, minOrder, maxUses, used, expires, active } = d;
  send(res, 200, { discount: { code, type, value, minOrder, maxUses, used, expires, active } });
}
async function publicAbandoned(req, res) {
  const b = body(req);
  const id = str(b.id, 40);
  if (!/^[a-z0-9]{6,40}$/.test(id)) return send(res, 400, { error: 'Richiesta non valida' });
  const p = await product();
  const v = (p.variants || []).find((x) => x.id === b.variant);
  if (!v) return send(res, 400, { error: 'Richiesta non valida' });
  const qty = v.fixed ? 1 : Math.min(500, Math.max(v.min, parseInt(b.qty, 10) || v.min));
  const customer = {};
  CUSTOMER_FIELDS.forEach((f) => { customer[f] = str((b.customer || {})[f], 200).trim(); });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return send(res, 400, { error: 'Email non valida' });
  await sql`delete from abandoned where at < ${Date.now() - 90 * 864e5}`;
  const [{ n }] = await sql`select count(*)::int as n from abandoned`;
  if (n >= 5000) return send(res, 429, { error: 'Archivio pieno' });
  const total = Math.round(v.price * qty * 100) / 100;
  const rec = { id, at: Date.now(), variant: v.id, qty, total, customer };
  await sql`insert into abandoned (id, at, data) values (${id}, ${rec.at}, ${JSON.stringify(rec)}::jsonb) on conflict (id) do update set at = excluded.at, data = excluded.data`;
  send(res, 200, { ok: true });
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://www.tappala.com');
  const route = (url.searchParams.get('route') || url.pathname.replace(/^\/api\/?/, '')).replace(/^index\/?/, '').replace(/\/+$/, '');
  try {
    if (!sql) return send(res, 503, { error: 'Database non collegato' });
    await init();
    const m = req.method;
    if (route === 'public/config' && m === 'GET') return await publicConfig(res);
    if (route === 'public/discount' && m === 'GET') return await publicDiscount(url, res);
    if (route === 'public/abandoned' && m === 'POST') return await publicAbandoned(req, res);
    if (route === 'login' && m === 'POST') return await login(req, res);
    if (route === 'logout' && m === 'POST') return await logout(req, res);
    if (route.startsWith('admin/')) {
      if (m !== 'GET' && req.headers['x-tappala'] !== '1') return send(res, 403, { error: 'Richiesta non consentita' });
      if (!(await isAdmin(req))) return send(res, 401, { error: 'Accesso richiesto' });
      if (route === 'admin/state' && m === 'GET') return await state(res);
      if (route === 'admin/state' && m === 'PATCH') return await patchState(req, res);
      if (route === 'admin/next-number' && m === 'POST') return await nextNumber(res);
    }
    send(res, 404, { error: 'Non trovato' });
  } catch (err) {
    console.error('api error', route, err && err.message);
    send(res, 500, { error: 'Errore del server' });
  }
};
