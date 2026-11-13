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
    { id: 'uno', name: '1+1 gratis (2 card)', price: 34.9, min: 1, fixed: true },
    { id: 'due', name: '2+2 gratis (4 card)', price: 68.9, min: 1, fixed: true },
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

// ===== Stripe =====
const SITE = 'https://www.tappala.com';
// Chiave privata Stripe: STRIPE_SECRET_KEY, oppure la variabile 'tappala' creata su Vercel.
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.tappala;
async function stripe(path, params) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + STRIPE_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20'
    },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe ' + r.status);
  return j;
}
function discountAmount(d, sub) {
  if (!d || !d.active) return 0;
  if (d.expires && new Date(d.expires + 'T23:59:59Z').getTime() < Date.now()) return 0;
  if (d.maxUses && d.used >= d.maxUses) return 0;
  if (d.minOrder && sub < d.minOrder) return 0;
  return d.type === 'percent' ? Math.round(sub * d.value) / 100 : Math.min(d.value, sub);
}
// Crea la pagina di pagamento Stripe con l'importo esatto del carrello.
// Indirizzo del sito da cui parte l'ordine: dominio tappala oppure una versione di prova su Vercel.
function siteOf(req) {
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (/^(www\.)?tappala\.(com|it)$/.test(h) || /^[a-z0-9-]+\.vercel\.app$/.test(h)) return 'https://' + h;
  return SITE;
}
async function publicCheckout(req, res) {
  if (!STRIPE_KEY) return send(res, 503, { error: 'Pagamenti non ancora attivi' });
  const site = siteOf(req);
  const b = body(req);
  const p = await product();
  const v = (p.variants || []).find((x) => x.id === b.variant);
  if (!v) return send(res, 400, { error: 'Prodotto non valido' });
  const qty = v.fixed ? 1 : Math.min(500, Math.max(v.min, parseInt(b.qty, 10) || v.min));
  const sub = Math.round((v.fixed ? v.price : v.price * qty) * 100) / 100;
  const code = str(b.code, 30).trim().toUpperCase();
  let disc = 0;
  if (code) {
    const rows = await sql`select data from discounts where code = ${code}`;
    disc = rows.length ? discountAmount(rows[0].data, sub) : 0;
  }
  const cents = Math.max(50, Math.round((sub - disc) * 100));
  const label = v.fixed ? v.name : qty + ' card';
  const chk = checkCustomer(b.customer);
  if (chk.error) return send(res, 400, { error: chk.error });
  const c = chk.c;
  const invoice = c.invType === 'privato'
    ? `Fattura: ${c.firstName} ${c.lastName}, C.F. ${c.cf}`
    : `Fattura: ${c.company}, P.IVA ${c.vat}, SDI/PEC ${c.sdi}`;
  const summary = [
    `Spedizione a ${c.firstName} ${c.lastName}, ${c.address}, ${c.zip} ${c.city} (${c.province})`,
    `Tel. ${c.phone}`,
    invoice,
    c.gmaps ? `Scheda Google: ${c.gmaps}` : 'Scheda Google: ti contatta il team tappala',
    'Spedizione inclusa, IVA inclusa.'
  ].join(' · ');
  const params = {
    mode: 'payment',
    locale: 'it',
    customer_email: c.email,
    customer_creation: 'always',
    billing_address_collection: 'auto',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': `${p.title} · ${label}`,
    'line_items[0][price_data][product_data][description]': summary.slice(0, 1000),
    'metadata[variant]': v.id,
    'metadata[qty]': String(qty),
    'metadata[code]': disc ? code : '',
    'metadata[cid]': str(b.cid, 40),
    success_url: site + '/grazie?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: site + '/#tap-form'
  };
  CUSTOMER_FIELDS.forEach((k) => { if (c[k]) params['metadata[c_' + k + ']'] = c[k]; });
  const s = await stripe('checkout/sessions', params);
  send(res, 200, { url: s.url });
}
// Controlla i dati inseriti nella pagina prodotto prima di creare il pagamento.
function checkCustomer(raw) {
  const c = {};
  CUSTOMER_FIELDS.forEach((f) => { c[f] = str((raw || {})[f], 250).trim(); });
  c.province = c.province.toUpperCase();
  c.invType = c.invType === 'privato' ? 'privato' : 'azienda';
  const need = ['firstName', 'lastName', 'email', 'phone', 'address', 'zip', 'city', 'province'];
  need.push(...(c.invType === 'privato' ? ['cf'] : ['company', 'vat', 'sdi']));
  const missing = need.filter((k) => !c[k]);
  if (missing.length) return { error: 'Compila tutti i campi obbligatori' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return { error: 'Email non valida' };
  if (!/^[0-9]{5}$/.test(c.zip)) return { error: 'CAP non valido' };
  if (!/^[A-Z]{2}$/.test(c.province)) return { error: 'Provincia non valida: usa la sigla, es. SS' };
  if (c.invType === 'azienda' && !/^(IT)?[0-9]{11}$/i.test(c.vat)) return { error: 'Partita IVA non valida' };
  if (c.invType === 'privato' && !/^[A-Za-z0-9]{16}$/.test(c.cf)) return { error: 'Codice fiscale non valido' };
  return { c };
}
// Registra un pagamento completato come ordine (una sola volta per sessione).
async function savePaid(s) {
  if (!s || s.status !== 'complete' || s.payment_status !== 'paid') return null;
  const exists = await sql`select data from orders where id = ${s.id}`;
  if (exists.length) return exists[0].data;
  const cd = s.customer_details || {};
  const sh = s.shipping_details || {};
  const a = sh.address || cd.address || {};
  const field = (k) => ((s.custom_fields || []).find((f) => f.key === k) || {}).text || {};
  const tax = (cd.tax_ids || [])[0];
  const md = s.metadata || {};
  const [{ n }] = await sql`select nextval('order_seq')::int as n`;
  const order = {
    id: s.id, number: n, at: (s.created || Math.floor(Date.now() / 1000)) * 1000, test: !s.livemode, source: 'Stripe',
    variant: md.variant || 'uno', qty: parseInt(md.qty, 10) || 1,
    subtotal: (s.amount_subtotal || 0) / 100, discount: ((s.amount_subtotal || 0) - (s.amount_total || 0)) / 100,
    code: md.code || null, total: (s.amount_total || 0) / 100,
    payment: 'Pagato', fulfillment: 'Da configurare', tracking: '', note: '',
    customer: md.c_firstName
      // Dati inseriti nella pagina prodotto
      ? Object.fromEntries(CUSTOMER_FIELDS.map((k) => [k, md['c_' + k] || (k === 'email' ? cd.email || '' : '')]))
      // Ordini creati quando Stripe raccoglieva i dati
      : {
        email: cd.email || '', phone: cd.phone || '', gmaps: field('gmaps').value || '',
        firstName: sh.name || cd.name || '', lastName: '',
        address: [a.line1, a.line2].filter(Boolean).join(', '), zip: a.postal_code || '', city: a.city || '', province: a.state || '',
        invType: tax ? 'azienda' : 'privato', company: tax ? (cd.name || '') : '', vat: tax ? tax.value : '', sdi: field('sdi').value || '', cf: ''
      }
  };
  if (!order.customer.gmaps) order.note = 'Scheda Google non indicata: contattare il cliente.';
  const ins = await sql`insert into orders (id, number, at, data) values (${order.id}, ${order.number}, ${order.at}, ${JSON.stringify(order)}::jsonb) on conflict (id) do nothing returning id`;
  if (ins.length && md.cid) await sql`delete from abandoned where id = ${md.cid}`;
  if (ins.length && order.code) {
    await sql`update discounts set data = jsonb_set(data, '{used}', to_jsonb(coalesce((data->>'used')::int, 0) + 1)) where code = ${order.code}`;
  }
  return order;
}
async function publicConfirm(url, res) {
  const id = str(url.searchParams.get('session_id'), 200);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id) || !STRIPE_KEY) return send(res, 400, { error: 'Sessione non valida' });
  const o = await savePaid(await stripe('checkout/sessions/' + id));
  if (!o) return send(res, 202, { paid: false });
  send(res, 200, { paid: true, number: o.number, total: o.total });
}
// Recupera i pagamenti recenti che non sono passati dalla pagina di ringraziamento.
async function syncStripe() {
  if (!STRIPE_KEY) return;
  try {
    const list = await stripe('checkout/sessions?limit=50&status=complete');
    for (const s of list.data || []) await savePaid(s);
  } catch (err) { console.error('stripe sync', err.message); }
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
    if (route === 'public/checkout' && m === 'POST') return await publicCheckout(req, res);
    if (route === 'public/confirm' && m === 'GET') return await publicConfirm(url, res);
    if (route === 'login' && m === 'POST') return await login(req, res);
    if (route === 'logout' && m === 'POST') return await logout(req, res);
    if (route.startsWith('admin/')) {
      if (m !== 'GET' && req.headers['x-tappala'] !== '1') return send(res, 403, { error: 'Richiesta non consentita' });
      if (!(await isAdmin(req))) return send(res, 401, { error: 'Accesso richiesto' });
      if (route === 'admin/state' && m === 'GET') { await syncStripe(); return await state(res); }
      if (route === 'admin/state' && m === 'PATCH') return await patchState(req, res);
      if (route === 'admin/next-number' && m === 'POST') return await nextNumber(res);
    }
    send(res, 404, { error: 'Non trovato' });
  } catch (err) {
    console.error('api error', route, err && err.message);
    send(res, 500, { error: 'Errore del server' });
  }
};
