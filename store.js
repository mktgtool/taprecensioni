// Archivio dati del pannello. In questa fase salva nel browser: sara' sostituito da API e database.
(function () {
  var KEY = 'tap-admin-v1';

  function seed() {
    return {
      product: {
        title: 'Card NFC Recensioni Google',
        status: 'Attivo',
        variants: [
          { id: 'uno', name: '1+1 gratis (2 card)', price: 34.9, min: 1, fixed: true },
          { id: 'due', name: '2+2 gratis (4 card)', price: 69, min: 1, fixed: true },
          { id: 'pack', name: '3 card o più', price: 24, min: 3, fixed: false }
        ]
      },
      orders: [],
      abandoned: [],
      discounts: [],
      seq: 1000,
      uploads: [],
      pages: [
        { slug: 'privacy', title: 'Privacy policy' },
        { slug: 'termini', title: 'Termini e condizioni' },
        { slug: 'spedizione', title: 'Politica di spedizione' },
        { slug: 'resi', title: 'Resi e rimborsi' },
        { slug: 'contatti', title: 'Contatti e dati aziendali' },
        { slug: 'grazie', title: 'Grazie per il tuo ordine' }
      ],
      theme: {
        announcement: 'Utilizzata da +2558 attività in Italia · Spedizione inclusa · Nessun abbonamento',
        payoff: 'Trasforma i clienti soddisfatti in recensioni Google.',
        payoffSub: 'I clienti tappala guadagnano [[+40 recensioni]] già nella prima settimana.',
        headline: 'Più recensioni Google, con un tocco.',
        subheadline: 'Metti la card alla cassa: il cliente avvicina il telefono e lascia la recensione in pochi secondi.'
      },
      checkout: { phoneRequired: false }
    };
  }

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.product) return d;
    } catch (e) { /* archivio assente o illeggibile */ }
    return seed();
  }
  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); return true; }
    catch (e) { return false; }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function round(n) { return Math.round(n * 100) / 100; }

  function subtotal(d, variantId, qty) {
    var v = d.product.variants.filter(function (x) { return x.id === variantId; })[0];
    if (!v) return 0;
    return round(v.price * (v.fixed ? 1 : Math.max(v.min, qty || v.min)));
  }

  // Calcola lo sconto di un codice su un subtotale. Non incrementa gli utilizzi.
  function checkDiscount(d, code, sub) {
    var c = String(code || '').trim().toUpperCase();
    var x = d.discounts.filter(function (y) { return y.code === c; })[0];
    if (!x || !x.active) return { ok: false, msg: 'Codice non valido' };
    if (x.expires && new Date(x.expires + 'T23:59:59').getTime() < Date.now()) return { ok: false, msg: 'Codice scaduto' };
    if (x.maxUses && x.used >= x.maxUses) return { ok: false, msg: 'Codice esaurito' };
    if (x.minOrder && sub < x.minOrder) return { ok: false, msg: 'Ordine minimo ' + x.minOrder + ' €' };
    var amount = x.type === 'percent' ? round(sub * x.value / 100) : Math.min(x.value, sub);
    return { ok: true, code: x.code, amount: amount };
  }

  window.TapStore = { load: load, save: save, seed: seed, uid: uid, round: round, subtotal: subtotal, checkDiscount: checkDiscount };
})();
