/* CUPISSA | Botón Atrás protegido en celular, PC y PWA.
   Dentro del catálogo vuelve al inicio y cierra paneles; desde una ficha o
   cualquier página independiente regresa al catálogo, nunca al sitio anterior. */
(() => {
  'use strict';
  const isEmbedded = window.top !== window.self;
  const CATALOG_PATH = '/catalogo/';
  const normalizePath = value => {
    const clean = String(value || '/').replace(/\/index\.html$/i, '/');
    return clean.endsWith('/') ? clean : `${clean}/`;
  };
  const isCatalogPage = () => normalizePath(window.location.pathname) === CATALOG_PATH;

  function installBackGuard() {
    const path = normalizePath(window.location.pathname);
    if (history.state?.cupissaCustomerBackGuardPath === path) return;
    try {
      history.pushState({ ...(history.state || {}), cupissaCustomerBackGuard:true, cupissaCustomerBackGuardPath:path }, '', window.location.href);
    } catch (error) {
      console.warn('[CUPISSA] No fue posible proteger la navegación Atrás:', error);
    }
  }

  function closeCatalogPanels() {
    [
      'closeProfileModal', 'closeCartModal', 'closeFavoritesModal',
      'closePortalModal', 'closeCheckoutFormModal', 'closeOptionsModal',
      'closeFullImageModal', 'closeMobileFilters'
    ].forEach(name => {
      try { if (typeof window[name] === 'function') window[name](); } catch (_) {}
    });
    ['modal-product-options','modal-full-image','modal-profile','modal-cart','modal-favorites','modal-portal']
      .forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.body.classList.remove('profile-open','portal-open','mobile-filters-open');
  }

  function returnToCatalogStart() {
    // El catálogo es una sola vista: Atrás cierra cualquier detalle/panel y vuelve arriba.
    closeCatalogPanels();
    const url = new URL(window.location.href);
    url.searchParams.delete('producto');
    url.searchParams.delete('cupissa_open_portal');
    const cleanUrl = CATALOG_PATH + (url.searchParams.toString() ? `?${url.searchParams}` : '') + (url.hash || '');
    try {
      history.pushState({ ...(history.state || {}), cupissaCustomerBackGuard:true, cupissaCustomerBackGuardPath:CATALOG_PATH }, '', window.location.href);
      history.replaceState({ cupissaCustomerBackGuard:true, cupissaCustomerBackGuardPath:CATALOG_PATH }, '', cleanUrl);
    } catch (_) {}
    if (typeof window.goToCatalogHome === 'function') {
      window.goToCatalogHome();
    } else {
      window.scrollTo({ top:0, left:0, behavior:'auto' });
    }
    window.scrollTo({ top:0, left:0, behavior:'auto' });
  }

  window.addEventListener('popstate', () => {
    if (isEmbedded) {
      try { window.parent.postMessage({ type:'CUPISSA_BACK_TO_CATALOG_HOME' }, window.location.origin); } catch (_) {}
      return;
    }
    if (isCatalogPage()) {
      returnToCatalogStart();
      return;
    }
    // Producto individual, Perfil, Portal, Checkout y demás páginas vuelven al catálogo.
    window.location.replace(CATALOG_PATH);
  });

  if (!isEmbedded) {
    window.addEventListener('message', event => {
      if (event.origin !== window.location.origin || event.data?.type !== 'CUPISSA_BACK_TO_CATALOG_HOME') return;
      if (isCatalogPage()) returnToCatalogStart();
    });
  }
  window.addEventListener('pageshow', installBackGuard);
  window.addEventListener('load', installBackGuard, { once:true });
  installBackGuard();
})();
