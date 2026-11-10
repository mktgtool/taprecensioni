(function () {
  var S = TapStore.load();
  var f = document.getElementById('f');
  var $ = function (id) { return document.getElementById(id); };
  var fmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  var params = new URLSearchParams(location.search);
  var variant = params.get('variant') || 'uno';
  if (!S.product.variants.some(function (v) { return v.id === variant; })) variant = 'uno';
  var applied = null;

  var sid;
  try {
    sid = sessionStorage.getItem('tap-cs') || TapStore.uid();
    sessionStorage.setItem('tap-cs', sid);
  } catch (e) { sid = TapStore.uid(); }

  function v() { return S.product.variants.filter(function (x) { return x.id === variant; })[0]; }
  function qty() { return v().fixed ? 1 : Math.max(v().min, parseInt($('qty').value, 10) || v().min); }
  function amounts() {
    var sub = TapStore.subtotal(S, variant, qty());
    var d = 0;
    if (applied) {
      var c = TapStore.checkDiscount(S, applied, sub);
      if (c.ok) d = c.amount;
      else { applied = null; $('msg').className = 'msg'; $('msg').textContent = c.msg; }
    }
    return { sub: sub, disc: d, total: TapStore.round(sub - d) };
  }
  function paint() {
    var a = amounts();
    $('pName').textContent = S.product.title;
    $('vName').textContent = v().fixed ? v().name : qty() + ' card';
    $('line').textContent = fmt.format(a.sub);
    $('qtyBox').hidden = v().fixed;
    $('sub').textContent = fmt.format(a.sub);
    $('discRow').hidden = !applied;
    $('discL').textContent = 'Sconto ' + (applied || '');
    $('disc').textContent = '−' + fmt.format(a.disc);
    $('total').textContent = fmt.format(a.total);
  }

  S.product.variants.forEach(function (x) {
    var l = document.createElement('label');
    var i = document.createElement('input');
    i.type = 'radio'; i.name = 'variant'; i.value = x.id; i.checked = x.id === variant;
    i.addEventListener('change', function () { variant = x.id; paint(); snapshot(); });
    l.appendChild(i);
    l.appendChild(document.createTextNode(' ' + (x.fixed ? x.name : '3+')));
    $('vars').appendChild(l);
  });
  $('qty').addEventListener('input', paint);

  $('apply').addEventListener('click', function () {
    var c = TapStore.checkDiscount(S, $('code').value, amounts().sub);
    $('msg').className = c.ok ? 'msg ok' : 'msg';
    $('msg').textContent = c.ok ? 'Sconto applicato' : c.msg;
    applied = c.ok ? c.code : null;
    paint();
  });

  // Telefono obbligatorio se impostato nel pannello
  if (S.checkout.phoneRequired) {
    f.elements.phone.required = true;
    $('phoneL').textContent = 'Telefono *';
  }

  // Fattura: i campi obbligatori dipendono dal tipo di cliente
  var req = { azienda: ['company', 'vat', 'sdi'], privato: ['cf'] };
  function invoice() {
    var t = f.elements.invType.value;
    document.querySelectorAll('[data-inv]').forEach(function (b) {
      var on = b.dataset.inv === t;
      b.hidden = !on;
      b.querySelectorAll('input').forEach(function (i) { i.disabled = !on; i.required = on && req[t].indexOf(i.name) >= 0; });
    });
  }
  f.querySelectorAll('input[name=invType]').forEach(function (r) { r.addEventListener('change', invoice); });
  invoice();

  function data() {
    var o = {};
    new FormData(f).forEach(function (val, k) { if (k !== 'variant') o[k] = String(val).trim(); });
    return o;
  }

  // Registra il checkout abbandonato quando esiste un'email valida
  function snapshot() {
    if (!f.elements.email.value || !f.elements.email.checkValidity()) return;
    var cur = TapStore.load();
    var a = amounts();
    var rec = { id: sid, at: Date.now(), variant: variant, qty: qty(), total: a.total, customer: data() };
    var i = cur.abandoned.map(function (x) { return x.id; }).indexOf(sid);
    if (i >= 0) cur.abandoned[i] = rec; else cur.abandoned.unshift(rec);
    TapStore.save(cur);
  }
  f.addEventListener('change', snapshot);

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var cur = TapStore.load();
    S = cur;
    var a = amounts();
    cur.seq += 1;
    var order = {
      id: TapStore.uid(), number: cur.seq, at: Date.now(), test: true, source: 'Checkout',
      variant: variant, qty: qty(), subtotal: a.sub, discount: a.disc, code: applied, total: a.total,
      payment: 'Prova', fulfillment: 'Da configurare', tracking: '', note: '', customer: data()
    };
    cur.orders.unshift(order);
    if (applied) cur.discounts.forEach(function (d) { if (d.code === applied) d.used += 1; });
    cur.abandoned = cur.abandoned.filter(function (x) { return x.id !== sid; });
    TapStore.save(cur);
    try { sessionStorage.removeItem('tap-cs'); } catch (err) { /* nessuna sessione */ }
    $('main').hidden = true;
    $('done').hidden = false;
    $('doneN').textContent = 'Numero ordine #' + order.number + ' · ' + fmt.format(order.total);
  });

  paint();
})();
