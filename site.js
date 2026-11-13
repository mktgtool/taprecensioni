(function () {
  // ===== CONFIGURAZIONE =====
  // ID del pixel Meta. Il pagamento passa da /api/public/checkout (Stripe Checkout).
  var CONFIG = {
    links: { uno: '', due: '', pack: '' },
    metaPixelId: '4574433882871297'
  };
  var WA = 'https://wa.me/393338074768?text=';
  var VALUES = { uno: 34.9, due: 68.9, pack: 72 };
  var NAMES = { uno: '1+1 gratis (2 card)', due: '2+2 gratis (4 card)', pack: '3 o più card' };

  function store(kind, key, val) {
    try {
      var s = window[kind];
      if (val === undefined) return s.getItem(key);
      s.setItem(key, val);
    } catch (e) { return null; }
  }

  // ===== Consenso cookie e pixel =====
  function loadPixel() {
    if (!CONFIG.metaPixelId || window.fbq) return;
    !function(f,b,e,v,n,t,s){n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', CONFIG.metaPixelId);
    window.fbq('track', 'PageView');
    var page = document.body.dataset.page;
    if (page === 'grazie') {
      var k = store('sessionStorage', 'tap-variant');
      window.fbq('track', 'Purchase', { currency: 'EUR', value: parseFloat(store('sessionStorage', 'tap-value')) || VALUES[k] || 30 });
    }
  }
  var banner = document.getElementById('cb');
  function decide(v) {
    store('localStorage', 'tap-consent', v);
    if (banner) banner.hidden = true;
    if (v === 'yes') loadPixel();
  }
  var consent = store('localStorage', 'tap-consent');
  if (consent === 'yes') loadPixel();
  else if (consent !== 'no' && banner) banner.hidden = false;
  document.querySelectorAll('[data-consent]').forEach(function (b) {
    b.addEventListener('click', function () { decide(b.dataset.consent); });
  });
  document.querySelectorAll('[data-cookie-prefs]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); if (banner) banner.hidden = false; });
  });

  // ===== Pagina di ringraziamento: conferma il pagamento e mostra il numero d'ordine =====
  var sessionId = new URLSearchParams(location.search).get('session_id');
  var orderBox = document.getElementById('order-n');
  if (orderBox && sessionId) {
    fetch('/api/public/confirm?session_id=' + encodeURIComponent(sessionId)).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.paid) orderBox.textContent = 'Ordine n. ' + j.number + ' · ' + new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(j.total);
    }).catch(function () { /* il pannello recupera comunque il pagamento */ });
  }

  // ===== Pagina prodotto =====
  var form = document.getElementById('tap-form');
  if (!form) return;
  var fmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  var radios = form.querySelectorAll('input[name="variant"]');
  var totals = document.querySelectorAll('[data-total]');
  var qtyBox = form.querySelector('[data-qty]');
  var qty = form.querySelector('#tap-qty-input');
  var MIN = 3, MAX = 500;
  function selected() { return form.querySelector('input[name="variant"]:checked'); }
  function count() { return Math.min(MAX, Math.max(MIN, parseInt(qty.value, 10) || MIN)); }
  function amount() {
    var r = selected();
    return r.value === 'pack' ? +r.dataset.price * count() : +r.dataset.price;
  }
  function label() {
    var r = selected();
    return r.value === 'pack' ? count() + ' card' : NAMES[r.value];
  }
  function update() {
    var r = selected();
    radios.forEach(function (x) { x.closest('.tap-variant').classList.toggle('is-active', x.checked); });
    var total = fmt.format(amount());
    totals.forEach(function (t) { t.textContent = total; });
    qtyBox.hidden = r.value !== 'pack';
  }
  radios.forEach(function (r) { r.addEventListener('change', update); });
  qty.addEventListener('input', update);
  qty.addEventListener('blur', function () { qty.value = count(); update(); });
  form.querySelectorAll('[data-step]').forEach(function (b) {
    b.addEventListener('click', function () { qty.value = Math.min(MAX, Math.max(MIN, count() + +b.dataset.step)); update(); });
  });
  update();

  // Fattura: i campi obbligatori dipendono da Partita IVA / privato
  function invoice() {
    var t = form.elements.invType.value;
    form.querySelectorAll('[data-inv]').forEach(function (box) {
      var on = box.dataset.inv === t;
      box.hidden = !on;
      box.querySelectorAll('input').forEach(function (i) { i.disabled = !on; i.required = on && i.hasAttribute('data-req'); });
    });
  }
  form.querySelectorAll('input[name=invType]').forEach(function (r) { r.addEventListener('change', invoice); });
  invoice();

  var FIELDS = ['firstName', 'lastName', 'email', 'phone', 'address', 'zip', 'city', 'province', 'gmaps', 'invType', 'company', 'vat', 'sdi', 'cf'];
  function customer() {
    var c = {};
    FIELDS.forEach(function (k) { var el = form.elements[k]; c[k] = el && !el.disabled ? String(el.value).trim() : ''; });
    c.province = c.province.toUpperCase();
    return c;
  }
  var cid = store('sessionStorage', 'tap-cid');
  if (!cid) { cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); store('sessionStorage', 'tap-cid', cid); }
  // Registra il checkout iniziato appena c'e' un'email valida (per ricontattare chi non completa).
  function snapshot() {
    var em = form.elements.email;
    if (!em.value || !em.checkValidity()) return;
    var key = selected().value;
    fetch('/api/public/abandoned', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ id: cid, variant: key, qty: key === 'pack' ? count() : 1, customer: customer() })
    }).catch(function () { /* non bloccante */ });
  }
  form.addEventListener('change', function (e) { if (e.target.name !== 'variant') snapshot(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    var key = selected().value;
    store('sessionStorage', 'tap-variant', key);
    store('sessionStorage', 'tap-value', String(amount()));
    if (window.fbq) window.fbq('track', 'InitiateCheckout', { currency: 'EUR', value: amount(), num_items: key === 'pack' ? count() : (key === 'due' ? 4 : 2) });
    var btn = form.querySelector('[type=submit]');
    var whatsapp = WA + encodeURIComponent('Ciao, vorrei ordinare: ' + label() + ' tappala (' + fmt.format(amount()) + ').');
    btn.disabled = true; btn.textContent = 'Un attimo…';
    function reset() { btn.disabled = false; btn.textContent = 'Completa ordine'; }
    snapshot();
    // Il server crea la pagina di pagamento Stripe con importo, quantità e dati del cliente.
    fetch('/api/public/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: key, qty: key === 'pack' ? count() : 1, cid: cid, customer: customer() })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
    }).then(function (res) {
      if (res.j.url) { window.location.href = res.j.url; return; }
      if (res.status === 400) { reset(); alert(res.j.error || 'Controlla i dati inseriti.'); return; }
      window.location.href = whatsapp;
    }).catch(function () { window.location.href = whatsapp; })
      .finally(function () { setTimeout(reset, 5000); });
  });

  var gal = document.querySelector('[data-gallery]'), dots = document.querySelector('[data-dots]');
  if (gal && dots) {
    var figs = gal.querySelectorAll('figure');
    figs.forEach(function (_, i) { var d = document.createElement('span'); if (!i) d.className = 'on'; dots.appendChild(d); });
    gal.addEventListener('scroll', function () {
      var i = Math.round(gal.scrollLeft / (figs[0].offsetWidth + 10));
      Array.prototype.forEach.call(dots.children, function (d, n) { d.classList.toggle('on', n === i); });
    }, { passive: true });
  }
  var sticky = document.querySelector('[data-sticky]');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { sticky.classList.toggle('is-visible', !en[0].isIntersecting && en[0].boundingClientRect.top < 0); }).observe(form);
  }
})();
