(function () {
  // Online i dati stanno nel database (API); in locale restano nel browser per le prove.
  var REMOTE = !/^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  var S = REMOTE ? TapStore.seed() : TapStore.load();
  var last = null;
  var main = document.getElementById('main');
  var fmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  var ui = { days: 30, tests: false, status: 'Tutti', device: 'd' };
  var PAY = ['In attesa', 'Pagato', 'Rimborsato', 'Prova'];
  var FUL = ['Da configurare', 'Configurata', 'Spedita', 'Consegnata', 'Annullato'];
  var SECTIONS = [
    ['home', 'Analisi'], ['ordini', 'Ordini'], ['abbandonati', 'Checkout abbandonati'], ['prodotti', 'Prodotti'],
    ['risorse', 'Risorse'], ['pagine', 'Pagine'], ['canali', 'Canali di vendita'], ['editor', 'Editor negozio'],
    ['sconti', 'Sconti'], ['checkout', 'Checkout']
  ];
  var FILES = ['black-friday.jpg', 'showcase-2.jpg', 'showcase-3.jpg', 'tappala-1.jpg', 'tappala-2.jpg', 'tappala-3.jpg', 'tappala-4.jpg', 'tappala-5.jpg'];

  function e(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function eur(n) { return fmt.format(n || 0); }
  function when(t) { return new Date(t).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function toast(m) {
    var t = document.getElementById('toast');
    t.textContent = m; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function persist(m) {
    if (REMOTE) { sync().then(function (ok) { if (ok && m) toast(m); }); return true; }
    if (TapStore.save(S)) { if (m) toast(m); return true; }
    toast('Spazio del browser esaurito: modifica non salvata');
    return false;
  }

  // ===== Collegamento al server =====
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'X-Tappala': '1' }, opts.headers || {});
    return fetch('/api/' + path, opts);
  }
  function snap() { last = JSON.parse(JSON.stringify(S)); }
  // Invia al server solo cio' che e' cambiato dall'ultimo salvataggio.
  function sync() {
    var body = { kv: {}, upsert: {}, remove: {} }, any = false;
    ['product', 'theme', 'checkout', 'pages', 'uploads'].forEach(function (k) {
      if (JSON.stringify(S[k]) !== JSON.stringify(last[k])) { body.kv[k] = S[k]; any = true; }
    });
    [['orders', 'id'], ['abandoned', 'id'], ['discounts', 'code']].forEach(function (p) {
      var c = p[0], key = p[1], prev = {}, cur = {};
      (last[c] || []).forEach(function (x) { prev[x[key]] = JSON.stringify(x); });
      var up = S[c].filter(function (x) { cur[x[key]] = 1; return prev[x[key]] !== JSON.stringify(x); });
      var rm = Object.keys(prev).filter(function (k) { return !cur[k]; });
      if (up.length) { body.upsert[c] = up; any = true; }
      if (rm.length) { body.remove[c] = rm; any = true; }
    });
    if (!any) return Promise.resolve(true);
    snap();
    return api('admin/state', { method: 'PATCH', body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 401) { loginView('Sessione scaduta: accedi di nuovo'); return false; }
      if (!r.ok) { toast('Salvataggio non riuscito: ricarico i dati'); boot(); return false; }
      return true;
    }).catch(function () { toast('Connessione assente: modifica non salvata'); boot(); return false; });
  }
  function loginView(msg) {
    document.querySelector('.nav').hidden = true;
    main.innerHTML = '<div class="wrap"><form class="card" data-form="login" style="max-width:380px;margin:10vh auto">' +
      '<h1 style="margin-bottom:14px">Accedi al pannello</h1>' + (msg ? '<p class="tag off" role="alert">' + e(msg) + '</p>' : '') +
      '<label class="f">Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>' +
      '<button class="btn p">Entra</button></form></div>';
  }
  function boot() {
    if (!REMOTE) { render(); return; }
    var note = document.querySelector('.local-note');
    if (note) note.remove();
    api('admin/state').then(function (r) {
      if (r.status === 401) return loginView();
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'Errore ' + r.status); });
      return r.json().then(function (d) {
        S = TapStore.seed();
        Object.keys(d.kv || {}).forEach(function (k) { S[k] = d.kv[k]; });
        S.orders = d.orders || []; S.abandoned = d.abandoned || []; S.discounts = d.discounts || [];
        snap();
        document.querySelector('.nav').hidden = false;
        render();
      });
    }).catch(function (err) {
      main.innerHTML = '<div class="wrap">' + empty('Pannello non raggiungibile', err.message || 'Riprova tra poco.') + '</div>';
    });
  }
  function commit(m) { persist(m); render(); }
  function vName(id, q) {
    var v = S.product.variants.filter(function (x) { return x.id === id; })[0];
    if (!v) return id;
    return v.fixed ? v.name : q + ' card';
  }
  function name(c) { return ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.email || '—'; }
  function payTag(p) { return '<span class="tag ' + (p === 'Pagato' ? 'ok' : p === 'Rimborsato' ? 'off' : 'warn') + '">' + e(p) + '</span>'; }
  function fulTag(f) { return '<span class="tag ' + (f === 'Consegnata' ? 'ok' : f === 'Annullato' ? 'off' : '') + '">' + e(f) + '</span>'; }
  function options(list, cur) { return list.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + e(x) + '</option>'; }).join(''); }
  function head(title, right) { return '<div class="head"><h1>' + e(title) + '</h1><div class="acts">' + (right || '') + '</div></div>'; }
  function empty(t, s) { return '<div class="empty"><strong>' + e(t) + '</strong>' + e(s) + '</div>'; }
  function formData(f) { var o = {}; new FormData(f).forEach(function (v, k) { o[k] = String(v).trim(); }); return o; }

  // ===== Analisi =====
  function home() {
    var from = Date.now() - ui.days * 864e5;
    var inRange = function (o) { return o.at >= from; };
    var orders = S.orders.filter(function (o) { return inRange(o) && o.fulfillment !== 'Annullato' && o.payment !== 'Rimborsato' && (ui.tests || !o.test); });
    var rev = orders.reduce(function (a, o) { return a + o.total; }, 0);
    var aband = S.abandoned.filter(inRange).length;
    var started = orders.length + aband;
    var buckets = [], max = 0;
    for (var i = ui.days - 1; i >= 0; i--) {
      var d = new Date(Date.now() - i * 864e5).toDateString();
      var sum = orders.filter(function (o) { return new Date(o.at).toDateString() === d; }).reduce(function (a, o) { return a + o.total; }, 0);
      buckets.push(sum); max = Math.max(max, sum);
    }
    var bars = max ? buckets.map(function (b) { return '<div style="height:' + (b / max * 100) + '%" title="' + eur(b) + '"></div>'; }).join('') : '';
    var byV = {};
    orders.forEach(function (o) { byV[o.variant] = (byV[o.variant] || 0) + o.total; });
    var rows = S.product.variants.map(function (v) { return '<tr><td>' + e(v.name) + '</td><td class="num">' + eur(byV[v.id]) + '</td></tr>'; }).join('');
    return head('Analisi',
      '<label class="c" style="margin:0"><input type="checkbox" data-act="tests"' + (ui.tests ? ' checked' : '') + '> Includi ordini di prova</label>' +
      '<select data-act="days" aria-label="Periodo">' + [7, 30, 90].map(function (n) { return '<option value="' + n + '"' + (n === ui.days ? ' selected' : '') + '>Ultimi ' + n + ' giorni</option>'; }).join('') + '</select>') +
      '<div class="kpis">' +
      '<div class="kpi"><span>Vendite</span><strong>' + eur(rev) + '</strong></div>' +
      '<div class="kpi"><span>Ordini</span><strong>' + orders.length + '</strong></div>' +
      '<div class="kpi"><span>Valore medio</span><strong>' + eur(orders.length ? rev / orders.length : 0) + '</strong></div>' +
      '<div class="kpi"><span>Checkout completati</span><strong>' + (started ? Math.round(orders.length / started * 100) + '%' : '—') + '</strong></div></div>' +
      '<div class="two"><div class="card"><h2>Vendite nel tempo</h2>' + (max ? '<div class="chart">' + bars + '</div><div class="axis"><span>' + ui.days + ' giorni fa</span><span>Oggi</span></div>' : empty('Nessuna vendita nel periodo', 'Il grafico si riempie con i primi ordini.')) + '</div>' +
      '<div class="card flush"><table style="min-width:0"><tr><th>Variante</th><th class="num">Vendite</th></tr>' + rows + '</table></div></div>' +
      '<div class="info">Visite e tasso di conversione non sono ancora disponibili: servono un sistema di statistiche collegato al sito e il database.</div>';
  }

  // ===== Ordini =====
  function ordini() {
    var list = S.orders.filter(function (o) { return ui.status === 'Tutti' || o.fulfillment === ui.status; });
    var rows = list.map(function (o) {
      return '<tr><td><a href="#/ordini/' + e(o.id) + '">#' + e(o.number) + '</a>' + (o.test ? ' <span class="tag warn">Prova</span>' : '') + '</td><td>' + when(o.at) + '</td><td>' + e(name(o.customer)) + '</td><td>' + payTag(o.payment) + '</td><td>' + fulTag(o.fulfillment) + '</td><td class="num">' + eur(o.total) + '</td></tr>';
    }).join('');
    return head('Ordini',
      '<select data-act="status" aria-label="Filtra per stato">' + options(['Tutti'].concat(FUL), ui.status) + '</select>' +
      '<button class="btn" data-act="csv">Esporta CSV</button><a class="btn p" href="#/ordini/nuovo">Crea ordine</a>') +
      '<div class="card flush">' + (rows ? '<table><tr><th>Ordine</th><th>Data</th><th>Cliente</th><th>Pagamento</th><th>Evasione</th><th class="num">Totale</th></tr>' + rows + '</table>' : empty('Nessun ordine', 'Gli ordini ricevuti su WhatsApp possono essere registrati con "Crea ordine".')) + '</div>';
  }
  function ordine(id) {
    var o = S.orders.filter(function (x) { return x.id === id; })[0];
    if (!o) return empty('Ordine non trovato', '');
    var c = o.customer;
    var inv = c.invType === 'privato' ? '<dt>Cod. fiscale</dt><dd>' + e(c.cf) + '</dd>' : '<dt>Ragione soc.</dt><dd>' + e(c.company) + '</dd><dt>P. IVA</dt><dd>' + e(c.vat) + '</dd><dt>SDI o PEC</dt><dd>' + e(c.sdi) + '</dd>';
    return '<a class="back" href="#/ordini">← Ordini</a>' + head('Ordine #' + o.number, payTag(o.payment) + fulTag(o.fulfillment)) +
      '<div class="two"><div>' +
      '<div class="card"><h2>Articolo</h2><dl><dt>Prodotto</dt><dd>' + e(S.product.title) + ' · ' + e(vName(o.variant, o.qty)) + '</dd><dt>Subtotale</dt><dd>' + eur(o.subtotal) + '</dd>' + (o.discount ? '<dt>Sconto</dt><dd>−' + eur(o.discount) + (o.code ? ' (' + e(o.code) + ')' : '') + '</dd>' : '') + '<dt>Spedizione</dt><dd>Inclusa</dd><dt>Totale</dt><dd><strong>' + eur(o.total) + '</strong></dd><dt>Origine</dt><dd>' + e(o.source) + ' · ' + when(o.at) + '</dd></dl></div>' +
      '<div class="card"><h2>Lavorazione</h2><form data-form="order" data-id="' + e(o.id) + '"><div class="r2"><label class="f">Pagamento<select name="payment">' + options(PAY, o.payment) + '</select></label><label class="f">Evasione<select name="fulfillment">' + options(FUL, o.fulfillment) + '</select></label></div><label class="f">Numero di tracking<input name="tracking" value="' + e(o.tracking) + '"></label><label class="f">Note interne<textarea name="note" rows="3">' + e(o.note) + '</textarea></label><button class="btn p">Salva</button></form></div></div>' +
      '<div><div class="card"><h2>Scheda Google da configurare</h2><p style="margin:0;overflow-wrap:anywhere">' + e(c.gmaps) + '</p></div>' +
      '<div class="card"><h2>Cliente e consegna</h2><dl><dt>Nome</dt><dd>' + e(name(c)) + '</dd><dt>Email</dt><dd>' + e(c.email) + '</dd><dt>Telefono</dt><dd>' + e(c.phone) + '</dd><dt>Indirizzo</dt><dd>' + e(c.address) + '<br>' + e(c.zip) + ' ' + e(c.city) + ' (' + e(String(c.province || '').toUpperCase()) + ')</dd></dl></div>' +
      '<div class="card"><h2>Fattura</h2><dl>' + inv + '</dl></div>' +
      '<button class="btn d" data-act="delOrder" data-id="' + e(o.id) + '">Elimina ordine</button></div></div>';
  }
  function nuovoOrdine() {
    return '<a class="back" href="#/ordini">← Ordini</a>' + head('Crea ordine') +
      '<form class="card" data-form="newOrder" style="max-width:640px">' +
      '<div class="r2"><label class="f">Variante<select name="variant">' + S.product.variants.map(function (v) { return '<option value="' + e(v.id) + '">' + e(v.name) + '</option>'; }).join('') + '</select></label><label class="f">Quantità card (solo 3+)<input name="qty" type="number" min="3" value="3"></label></div>' +
      '<label class="f">Pagamento<select name="payment">' + options(['In attesa', 'Pagato'], 'In attesa') + '</select></label>' +
      '<label class="f">Scheda Google *<input name="gmaps" required></label>' +
      '<div class="r2"><label class="f">Nome *<input name="firstName" required></label><label class="f">Cognome<input name="lastName"></label></div>' +
      '<div class="r2"><label class="f">Email<input name="email" type="email"></label><label class="f">Telefono<input name="phone" type="tel"></label></div>' +
      '<label class="f">Indirizzo<input name="address"></label><div class="r2"><label class="f">CAP e città<input name="city"></label><label class="f">Provincia<input name="province" maxlength="2"></label></div>' +
      '<button class="btn p">Registra ordine</button></form>';
  }

  // ===== Checkout abbandonati =====
  function abbandonati() {
    var rows = S.abandoned.map(function (a) {
      var c = a.customer, wa = String(c.phone || '').replace(/[^0-9]/g, '');
      if (wa && wa.indexOf('39') !== 0) wa = '39' + wa;
      var msg = encodeURIComponent('Ciao, hai iniziato un ordine della card tappala ma non lo hai completato. Posso aiutarti?');
      var link = wa ? '<a href="https://wa.me/' + e(wa) + '?text=' + msg + '" target="_blank" rel="noopener">WhatsApp</a>' : '<a href="mailto:' + encodeURIComponent(c.email) + '">Email</a>';
      return '<tr><td>' + when(a.at) + '</td><td>' + e(c.email) + '</td><td>' + e(vName(a.variant, a.qty)) + '</td><td class="num">' + eur(a.total) + '</td><td>' + link + '</td><td><button class="btn d" data-act="delAb" data-id="' + e(a.id) + '">Elimina</button></td></tr>';
    }).join('');
    return head('Checkout abbandonati') + '<div class="card flush">' + (rows ? '<table><tr><th>Data</th><th>Email</th><th>Carrello</th><th class="num">Valore</th><th>Contatta</th><th></th></tr>' + rows + '</table>' : empty('Nessun checkout abbandonato', 'Compaiono qui quando un cliente inserisce l\'email e non completa l\'ordine.')) + '</div>';
  }

  // ===== Prodotti =====
  function prodotti() {
    var rows = S.product.variants.map(function (v) {
      return '<label class="f">' + e(v.name) + (v.fixed ? ' (€ totali)' : ' (€ per card)') + '<input type="number" step="0.01" min="0" name="' + e(v.id) + '" value="' + e(v.price) + '" required></label>';
    }).join('');
    return head('Prodotti') + '<form class="card" data-form="product" style="max-width:520px"><label class="f">Titolo<input name="title" value="' + e(S.product.title) + '" required></label>' + rows + '<button class="btn p">Salva</button></form><div class="info" style="max-width:520px">Questi prezzi valgono per il checkout del pannello. Il sito pubblico mostra ancora i prezzi scritti nella pagina.</div>';
  }

  // ===== Risorse =====
  function risorse() {
    var figs = FILES.map(function (f) { return '<figure><img src="' + e(f) + '" alt="" loading="lazy"><figcaption>' + e(f) + '</figcaption></figure>'; }).join('');
    var up = S.uploads.map(function (u) { return '<figure><img src="' + e(u.data) + '" alt=""><figcaption>' + e(u.name) + '<br><button class="btn d" data-act="delUp" data-id="' + e(u.id) + '">Elimina</button></figcaption></figure>'; }).join('');
    return head('Risorse', '<label class="btn p">Carica immagine<input type="file" accept="image/png,image/jpeg,image/webp" data-act="upload" hidden></label>') +
      '<div class="card"><h2>Immagini del negozio</h2><div class="gal">' + figs + '</div></div>' +
      '<div class="card"><h2>Caricate</h2>' + (up ? '<div class="gal">' + up + '</div>' : '<p class="muted" style="margin:0">Nessun file caricato. In questa fase il limite è 400 KB per immagine.</p>') + '</div>';
  }

  // ===== Pagine =====
  function pagine() {
    var rows = S.pages.map(function (p) {
      return '<tr><td><a href="#/pagine/' + e(p.slug) + '">' + e(p.title) + '</a></td><td>' + (p.draft ? '<span class="tag warn">Bozza</span>' : '<span class="tag ok">Pubblicata</span>') + '</td><td><a href="' + e(p.slug) + '.html" target="_blank" rel="noopener">Apri</a></td></tr>';
    }).join('');
    return head('Pagine') + '<div class="card flush"><table style="min-width:0"><tr><th>Titolo</th><th>Stato</th><th></th></tr>' + rows + '</table></div>';
  }
  function pagina(slug) {
    var p = S.pages.filter(function (x) { return x.slug === slug; })[0];
    if (!p) return empty('Pagina non trovata', '');
    setTimeout(function () {
      var ta = document.querySelector('textarea[name=html]');
      if (!ta) return;
      if (p.draft != null) { ta.value = p.draft; return; }
      fetch(slug + '.html').then(function (r) { return r.text(); }).then(function (t) {
        var box = new DOMParser().parseFromString(t, 'text/html').querySelector('.legal');
        box.querySelectorAll('.legal__back, h1').forEach(function (n) { n.remove(); });
        ta.value = box.innerHTML.trim();
      });
    });
    return '<a class="back" href="#/pagine">← Pagine</a>' + head(p.title) + '<form class="card" data-form="page" data-slug="' + e(slug) + '"><label class="f">Titolo<input name="title" value="' + e(p.title) + '" required></label><label class="f">Contenuto (HTML)<textarea class="code" name="html"></textarea></label><div class="acts"><button class="btn p">Salva bozza</button>' + (p.draft != null ? '<button type="button" class="btn d" data-act="dropDraft" data-slug="' + e(slug) + '">Scarta bozza</button>' : '') + '</div></form>';
  }

  // ===== Canali di vendita =====
  function canali() {
    var list = [
      ['Negozio online', 'www.tappala.com · tappala.com e tappala.it reindirizzano qui', 'Attivo', 'ok'],
      ['Facebook e Instagram', 'Pixel 4574433882871297, attivo dopo il consenso cookie', 'Configurato', 'ok'],
      ['WhatsApp', '+39 333 807 4768 · riceve gli ordini finché Stripe non è attivo', 'Attivo', 'ok'],
      ['Stripe', 'Pagamenti con carta sul sito', 'Da collegare', 'off']
    ];
    return head('Canali di vendita') + list.map(function (c) { return '<div class="card"><div class="head" style="margin:0"><div><h2 style="margin:0 0 2px">' + e(c[0]) + '</h2><span class="muted">' + e(c[1]) + '</span></div><span class="tag ' + c[3] + '">' + e(c[2]) + '</span></div></div>'; }).join('');
  }

  // ===== Editor negozio =====
  var FIELDS = [
    ['announcement', 'Barra annuncio', '.tap-announce'], ['payoff', 'Payoff', '.tap-payoff__h'], ['payoffSub', 'Frase sotto il payoff', '.tap-payoff__s'],
    ['headline', 'Titolo prodotto', '.tap-h1--sub'], ['subheadline', 'Sottotitolo', '.tap-lead']
  ];
  function setPreview(frame, sel, key, val) {
    var doc = frame.contentDocument, n = doc && doc.querySelector(sel);
    if (!n) return;
    if (key !== 'payoffSub') { n.textContent = val; return; }
    n.textContent = '';
    val.split(/(\[\[.*?\]\])/).forEach(function (part) {
      var m = part.match(/^\[\[(.*)\]\]$/);
      if (m) { var s = doc.createElement('strong'); s.textContent = m[1]; n.appendChild(s); }
      else n.appendChild(doc.createTextNode(part));
    });
  }
  function editor() {
    var inputs = FIELDS.map(function (f) { return '<label class="f">' + e(f[1]) + '<textarea rows="2" name="' + f[0] + '" data-sel="' + e(f[2]) + '">' + e(S.theme[f[0]]) + '</textarea></label>'; }).join('');
    setTimeout(function () {
      var frame = document.getElementById('prev');
      if (!frame) return;
      frame.addEventListener('load', function () {
        var cb = frame.contentDocument.getElementById('cb');
        if (cb) cb.remove();
        FIELDS.forEach(function (f) { setPreview(frame, f[2], f[0], S.theme[f[0]]); });
      });
    });
    return head('Editor negozio', '<button class="btn" data-act="device" data-v="d">Desktop</button><button class="btn" data-act="device" data-v="m">Mobile</button>') +
      '<div class="two ed"><form class="card" data-form="theme">' + inputs + '<p class="muted" style="font-size:12px">Usa [[testo]] per evidenziare una parte della frase.</p><button class="btn p">Salva bozza</button></form>' +
      '<iframe id="prev" class="frame' + (ui.device === 'm' ? ' m' : '') + '" src="index.html" title="Anteprima del negozio"></iframe></div>' +
      '<div class="info">La bozza si vede solo in questa anteprima. La pubblicazione sul sito arriva con il database.</div>';
  }

  // ===== Sconti =====
  function sconti() {
    var rows = S.discounts.map(function (d) {
      return '<tr><td><strong>' + e(d.code) + '</strong></td><td>' + (d.type === 'percent' ? e(d.value) + '%' : eur(d.value)) + '</td><td>' + (d.minOrder ? eur(d.minOrder) : '—') + '</td><td>' + e(d.used) + (d.maxUses ? ' / ' + e(d.maxUses) : '') + '</td><td>' + e(d.expires || '—') + '</td><td><button class="btn" data-act="toggleD" data-id="' + e(d.code) + '">' + (d.active ? 'Disattiva' : 'Attiva') + '</button> <button class="btn d" data-act="delD" data-id="' + e(d.code) + '">Elimina</button></td></tr>';
    }).join('');
    return head('Sconti') + '<div class="two"><div class="card flush">' + (rows ? '<table><tr><th>Codice</th><th>Valore</th><th>Minimo</th><th>Usi</th><th>Scadenza</th><th></th></tr>' + rows + '</table>' : empty('Nessuno sconto', 'I codici creati qui funzionano nel checkout.')) + '</div>' +
      '<form class="card" data-form="discount"><h2>Nuovo codice</h2><label class="f">Codice *<input name="code" required pattern="[A-Za-z0-9_\\-]{3,30}"></label><div class="r2"><label class="f">Tipo<select name="type"><option value="percent">Percentuale</option><option value="fixed">Importo fisso</option></select></label><label class="f">Valore *<input name="value" type="number" min="0.01" step="0.01" required></label></div><div class="r2"><label class="f">Ordine minimo €<input name="minOrder" type="number" min="0" step="0.01"></label><label class="f">Limite utilizzi<input name="maxUses" type="number" min="1"></label></div><label class="f">Scadenza<input name="expires" type="date"></label><button class="btn p">Crea codice</button></form></div>';
  }

  // ===== Checkout =====
  function checkout() {
    return head('Checkout', '<a class="btn" href="checkout.html" target="_blank" rel="noopener">Apri</a>') +
      '<div class="two ed"><form class="card" data-form="checkoutCfg"><h2>Impostazioni</h2><label class="c"><input type="checkbox" name="phoneRequired"' + (S.checkout.phoneRequired ? ' checked' : '') + '> Telefono obbligatorio</label><button class="btn p">Salva</button></form>' +
      '<iframe class="frame" src="checkout.html" title="Anteprima del checkout"></iframe></div>';
  }

  // ===== Routing =====
  function render() {
    if (!REMOTE) S = TapStore.load();
    else if (!last) return;
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var r = parts[0] || 'home', id = decodeURIComponent(parts[1] || '');
    document.getElementById('nav').innerHTML = SECTIONS.map(function (s) { return '<a href="#/' + s[0] + '"' + (s[0] === r ? ' class="on" aria-current="page"' : '') + '>' + e(s[1]) + '</a>'; }).join('') +
      (REMOTE ? '<a href="#" data-logout>Esci</a>' : '');
    var html;
    if (r === 'ordini' && id === 'nuovo') html = nuovoOrdine();
    else if (r === 'ordini' && id) html = ordine(id);
    else if (r === 'pagine' && id) html = pagina(id);
    else html = ({ home: home, ordini: ordini, abbandonati: abbandonati, prodotti: prodotti, risorse: risorse, pagine: pagine, canali: canali, editor: editor, sconti: sconti, checkout: checkout }[r] || home)();
    main.innerHTML = '<div class="wrap">' + html + '</div>';
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita l'esecuzione di formule in Excel
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var head = ['Ordine', 'Data', 'Prova', 'Variante', 'Totale', 'Pagamento', 'Evasione', 'Tracking', 'Email', 'Nome', 'Telefono', 'Scheda Google', 'Indirizzo', 'CAP', 'Città', 'Prov', 'Ragione sociale', 'P.IVA', 'SDI/PEC', 'Cod. fiscale'];
    var rows = S.orders.map(function (o) {
      var c = o.customer;
      return [o.number, new Date(o.at).toISOString(), o.test ? 'si' : 'no', vName(o.variant, o.qty), o.total, o.payment, o.fulfillment, o.tracking, c.email, name(c), c.phone, c.gmaps, c.address, c.zip, c.city, c.province, c.company, c.vat, c.sdi, c.cf].map(csvCell).join(';');
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + head.join(';') + '\n' + rows.join('\n')], { type: 'text/csv' }));
    a.download = 'ordini-tappala.csv';
    a.click();
  }

  var FORMS = {
    order: function (d, f) {
      var o = S.orders.filter(function (x) { return x.id === f.dataset.id; })[0];
      if (o) { Object.assign(o, d); commit('Ordine salvato'); }
    },
    newOrder: function (d) {
      var v = S.product.variants.filter(function (x) { return x.id === d.variant; })[0];
      var q = v.fixed ? 1 : Math.max(v.min, parseInt(d.qty, 10) || v.min);
      var sub = TapStore.subtotal(S, d.variant, q);
      function create(num) {
        var o = { id: TapStore.uid(), number: num, at: Date.now(), test: false, source: 'Manuale', variant: d.variant, qty: q, subtotal: sub, discount: 0, code: null, total: sub, payment: d.payment, fulfillment: 'Da configurare', tracking: '', note: '', customer: { gmaps: d.gmaps, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, address: d.address, city: d.city, province: d.province, invType: 'azienda' } };
        S.orders.unshift(o);
        if (persist('Ordine registrato')) location.hash = '#/ordini/' + o.id;
      }
      if (!REMOTE) { S.seq += 1; create(S.seq); return; }
      api('admin/next-number', { method: 'POST' }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (j) { create(j.number); })
        .catch(function () { toast('Numero ordine non disponibile: riprova'); });
    },
    login: function (d) {
      api('login', { method: 'POST', body: JSON.stringify({ password: d.password }) }).then(function (r) {
        if (r.ok) return boot();
        return r.json().catch(function () { return {}; }).then(function (j) { loginView(j.error || 'Accesso non riuscito'); });
      }).catch(function () { loginView('Connessione assente'); });
    },
    product: function (d) {
      S.product.title = d.title;
      S.product.variants.forEach(function (v) { v.price = TapStore.round(parseFloat(d[v.id])); });
      commit('Prezzi salvati');
    },
    page: function (d, f) {
      var p = S.pages.filter(function (x) { return x.slug === f.dataset.slug; })[0];
      p.title = d.title; p.draft = d.html;
      commit('Bozza salvata');
    },
    theme: function (d) { Object.assign(S.theme, d); persist('Bozza salvata'); },
    discount: function (d, f) {
      var c = d.code.toUpperCase();
      if (S.discounts.some(function (x) { return x.code === c; })) { toast('Codice già esistente'); return; }
      var val = parseFloat(d.value);
      if (d.type === 'percent' && val > 100) { toast('La percentuale massima è 100'); return; }
      S.discounts.unshift({ code: c, type: d.type, value: val, minOrder: parseFloat(d.minOrder) || 0, maxUses: parseInt(d.maxUses, 10) || 0, expires: d.expires, used: 0, active: true });
      f.reset();
      commit('Codice creato');
    },
    checkoutCfg: function (d) { S.checkout.phoneRequired = d.phoneRequired === 'on'; commit('Impostazioni salvate'); }
  };

  var ACTS = {
    csv: exportCsv,
    delOrder: function (b) { if (confirm('Eliminare questo ordine?')) { S.orders = S.orders.filter(function (o) { return o.id !== b.dataset.id; }); persist('Ordine eliminato'); location.hash = '#/ordini'; } },
    delAb: function (b) { S.abandoned = S.abandoned.filter(function (o) { return o.id !== b.dataset.id; }); commit('Eliminato'); },
    delUp: function (b) { S.uploads = S.uploads.filter(function (o) { return o.id !== b.dataset.id; }); commit('Eliminato'); },
    delD: function (b) { S.discounts = S.discounts.filter(function (o) { return o.code !== b.dataset.id; }); commit('Codice eliminato'); },
    toggleD: function (b) { S.discounts.forEach(function (o) { if (o.code === b.dataset.id) o.active = !o.active; }); commit(); },
    dropDraft: function (b) { S.pages.forEach(function (p) { if (p.slug === b.dataset.slug) delete p.draft; }); commit('Bozza scartata'); },
    device: function (b) { ui.device = b.dataset.v; document.getElementById('prev').classList.toggle('m', ui.device === 'm'); }
  };

  document.addEventListener('click', function (ev) {
    var out = ev.target.closest('[data-logout]');
    if (out) {
      ev.preventDefault();
      api('logout', { method: 'POST' }).finally(function () { last = null; loginView('Sei uscito dal pannello'); });
      return;
    }
    var b = ev.target.closest('button[data-act]');
    if (b && ACTS[b.dataset.act]) ACTS[b.dataset.act](b);
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    FORMS[f.dataset.form](formData(f), f);
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.sel) setPreview(document.getElementById('prev'), t.dataset.sel, t.name, t.value);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target, a = t.dataset && t.dataset.act;
    if (a === 'days') { ui.days = +t.value; render(); }
    if (a === 'tests') { ui.tests = t.checked; render(); }
    if (a === 'status') { ui.status = t.value; render(); }
    if (a === 'upload' && t.files[0]) {
      var file = t.files[0];
      if (file.size > 400 * 1024) { toast('Immagine oltre 400 KB'); return; }
      var rd = new FileReader();
      rd.onload = function () { S.uploads.unshift({ id: TapStore.uid(), name: file.name, data: rd.result }); commit('Immagine caricata'); };
      rd.readAsDataURL(file);
    }
  });
  window.addEventListener('hashchange', function () { render(); main.focus(); });
  boot();
})();
