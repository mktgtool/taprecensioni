(function () {
  // ===== CONFIGURAZIONE =====
  // Incollare qui i tre Payment Link di Stripe e l'ID del pixel Meta.
  var CONFIG = {
    links: { uno: '', due: '', pack: '' },
    metaPixelId: ''
  };
  var WA = 'https://wa.me/393338074768?text=';
  var VALUES = { uno: 30, due: 50, pack: 120 };
  var NAMES = { uno: '1 card', due: '2 card', pack: '5 o più card' };

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
      window.fbq('track', 'Purchase', { currency: 'EUR', value: VALUES[k] || 30 });
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

  // ===== Pagina prodotto =====
  var form = document.getElementById('tap-form');
  if (!form) return;
  var fmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  var radios = form.querySelectorAll('input[name="variant"]');
  var totals = document.querySelectorAll('[data-total]');
  var note = form.querySelector('[data-pack-note]');
  function selected() { return form.querySelector('input[name="variant"]:checked'); }
  function update() {
    var r = selected();
    radios.forEach(function (x) { x.closest('.tap-variant').classList.toggle('is-active', x.checked); });
    var total = fmt.format(+r.dataset.price);
    totals.forEach(function (t) { t.textContent = r.value === 'pack' ? 'da ' + total : total; });
    note.hidden = r.value !== 'pack';
  }
  radios.forEach(function (r) { r.addEventListener('change', update); });
  update();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var key = selected().value;
    store('sessionStorage', 'tap-variant', key);
    if (window.fbq) window.fbq('track', 'InitiateCheckout', { currency: 'EUR', value: VALUES[key] });
    var link = CONFIG.links[key];
    if (link) { window.location.href = link + (link.indexOf('?') < 0 ? '?' : '&') + 'locale=it'; return; }
    window.location.href = WA + encodeURIComponent('Ciao, vorrei ordinare: ' + NAMES[key] + ' TapRecensioni. La mia attività su Google Maps è: ');
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
