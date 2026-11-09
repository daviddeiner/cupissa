/* CUPISSA | PWA Service Worker. Versionar esta constante cuando se publiquen cambios. */
const CUPISSA_CACHE = 'cupissa-app-shell-20261109-slow-network-v1';
const CUPISSA_CACHE_PREFIX = 'cupissa-app-shell-';
const CUPISSA_ASSETS = [
  'index.html',
  'catalogo/',
  'checkout/',
  'assets/data/domicilios.json',
  'perfil/',
  'portal-pagos/',
  'terminos-y-condiciones/',
  'terminos-credito/',
  'politicas-anticipos/',
  'tratamiento-datos/',
  'politica-de-datos-personales/',
  'politica-de-compras-y-garantias/',
  'credito-cupissa/',
  'politica-y-condiciones-de-alquileres/',
  'catalogo/manifest.webmanifest',
  'catalogo/assets/css/catalogo.css?v=20261108-tallas-lupa-v1',
  'catalogo/assets/css/ficha-producto-movil.css?v=20261108-detalles-movil-1',
  'catalogo/assets/js/00-config-state.js?v=20261107-banner20-auto5-v1',
  'catalogo/assets/js/01-initialization.js?v=20261109-batch200-diversidad-v1',
  'catalogo/assets/js/01-tailwind-config.js',
  'catalogo/assets/js/02-product-data.js?v=20261109-batch200-diversidad-v1',
  'catalogo/assets/js/03-filters-search.js?v=20261107-banner20-auto5-v1',
  'catalogo/assets/js/04-product-grid.js?v=20261109-append-grid-v3',
  'catalogo/assets/js/05-product-modal.js?v=20261108-tallas-multiples-zoom-v1',
  'catalogo/assets/js/06-cart-favorites-state.js?v=20261108-tallas-multiples-v1',
  'catalogo/assets/js/07-cart.js',
  'catalogo/assets/js/08-checkout.js',
  'catalogo/assets/js/09-favorites.js',
  'catalogo/assets/js/10-formatters.js',
  'catalogo/assets/js/11-responsive-navigation.js?v=20261107-portal-restauracion-simple-v4',
  'catalogo/assets/js/12-cart-animation.js',
  'catalogo/assets/js/13-brand-ui.js',
  'catalogo/assets/js/14-product-activity.js?v=20261108-ranking-1',
  'catalogo/assets/js/16-product-recommendations.js?v=20261108-similares-1',
  'catalogo/assets/js/ficha-producto-movil.js?v=20261108-detalles-movil-1',
  'catalogo/assets/js/15-pwa-install.js',
  'catalogo/assets/images/logo.png',
  'catalogo/assets/images/favicon.png',
  'catalogo/assets/images/app-icon-192.png',
  'catalogo/assets/images/app-icon-512.png',
  'catalogo/assets/images/app-icon-180.png',
  'assets/css/checkout.css',
  'assets/js/checkout.js?v=20261109-soledad-12000-v4',
  'assets/css/perfil.css?v=20261108-nota-cliente-v1',
  'assets/js/perfil.js?v=20261108-nota-cliente-v1',
  'shared/js/cupissa-auth.js?v=20261108-otp-universal-v4',
  'shared/js/supabase-config.js',
  'portal-pagos/index.html',
  'portal-pagos/assets/css/portal.css',
  'portal-pagos/assets/js/02-supabase-config-state.js',
  'portal-pagos/assets/js/04-session.js?v=20261107-portal-restauracion-simple-v4',
  'portal-pagos/assets/js/05-authentication.js?v=20261107-otp-google',
  'portal-pagos/assets/js/06-client-dashboard.js?v=20261107-cuotas',
  'portal-pagos/assets/js/07-payment-options.js',
  'portal-pagos/assets/js/08-payment-gateway.js',
  'portal-pagos/assets/js/09-formatters.js',
  'portal-pagos/services/wompi/02-date-and-late-fees.js',
  'portal-pagos/services/wompi/04-checkout.js?v=20261109-soledad-12000-v4',
  'portal-pagos/services/wompi/03-payment-service.js?v=20261107-otp-auth'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CUPISSA_CACHE);
    const cacheKeys = await caches.keys();
    const previousNames = cacheKeys
      .filter(name => name.startsWith(CUPISSA_CACHE_PREFIX) && name !== CUPISSA_CACHE)
      .sort();
    const previousName = previousNames[previousNames.length - 1];

    // Copiar el app shell anterior. Los recursos que no cambien podrán reutilizarse
    // y la revalidación HTTP descargará únicamente los archivos modificados.
    if (previousName) {
      const previous = await caches.open(previousName);
      for (const request of await previous.keys()) {
        if (await cache.match(request)) continue;
        const response = await previous.match(request);
        if (response) await cache.put(request, response);
      }
    }

    // Precache limitado: la instalación no debe competir con el catálogo por
    // decenas de conexiones en redes 2G. Los demás recursos se cachean al usarse.
    const criticalPaths = [
      'catalogo/',
      'catalogo/assets/css/catalogo.css?v=20261109-tallas-dropdown-scroll-v3',
      'catalogo/assets/css/ficha-producto-movil.css?v=20261109-variantes-compactas-v3',
      'catalogo/assets/images/logo.png',
      'catalogo/assets/js/00-config-state.js?v=20261109-scroll-10-v2',
      'catalogo/assets/js/01-initialization.js?v=20261109-batch200-diversidad-v1',
      'catalogo/assets/js/02-product-data.js?v=20261109-batch200-diversidad-v1',
      'catalogo/assets/js/04-product-grid.js?v=20261109-append-grid-v3'
    ];
    // No bloquear la primera instalación con una precarga masiva.
    for (const path of criticalPaths) {
      const url = new URL(path, self.registration.scope);
      try {
        const existing = await cache.match(url);
        if (existing) continue;
        const response = await fetch(new Request(url, { cache: 'no-cache' }));
        if (response.ok) await cache.put(url, response);
      } catch (_) { /* Conserva la caché anterior cuando no hay red. */ }
    }

    // Primera instalación: activar de inmediato. Actualizaciones: esperar al botón del usuario.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CUPISSA_SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key.startsWith(CUPISSA_CACHE_PREFIX) && key !== CUPISSA_CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/rest/v1/') || url.pathname.includes('/storage/v1/') || url.pathname.includes('/functions/v1/')) return;

  // Catálogo: mostrar inmediatamente el HTML guardado y actualizarlo sin
  // bloquear la navegación. Se conserva el shell anterior sin conexión.
  if (request.mode === 'navigate' && /^\/catalogo\/(?:index\.html)?$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CUPISSA_CACHE);
      const cached = await cache.match(request, { ignoreSearch: true })
        || await caches.match(request, { ignoreSearch: true });
      const refresh = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      });
      if (cached) {
        event.waitUntil(refresh.catch(() => {}));
        return cached;
      }
      return refresh.catch(() => caches.match(new URL('catalogo/', self.registration.scope)));
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CUPISSA_CACHE);
      try {
        const response = await fetch(request);
        if (response && response.ok) await cache.put(request, response.clone());
        return response;
      } catch (_) {
        return (await caches.match(request))
          || (await caches.match(new URL('index.html', self.registration.scope)))
          || Response.error();
      }
    })());
    return;
  }

  // Recursos versionados del catálogo: respuesta inmediata desde caché,
  // refresco no bloqueante. Recursos críticos no versionados y pagos:
  // red primero para no inmovilizar versiones de lógica sensible.
  if (request.destination === 'script' || request.destination === 'style') {
    const versionedCatalog = url.pathname.startsWith('/catalogo/') && url.searchParams.has('v');
    event.respondWith((async () => {
      const cache = await caches.open(CUPISSA_CACHE);
      const cached = await cache.match(request) || await caches.match(request);
      const refresh = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      });
      if (cached && versionedCatalog) {
        event.waitUntil(refresh.catch(() => {}));
        return cached;
      }
      return refresh.catch(() => cached || Response.error());
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CUPISSA_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => cached);
    return cached || network;
  })());
});
