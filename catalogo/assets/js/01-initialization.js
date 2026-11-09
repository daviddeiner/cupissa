/** CUPISSA | Scroll infinito: 10 productos por lote, con pausa mínima de 1 segundo. */
let productsScrollObserver = null;
let lastProductsBatchAt = 0;
let productsBatchPending = false;
let productsScrollHandlerBound = false;
let productsScrollRafPending = false;
function loadNextProductsBatch() {
    if (isLoadingMore || productsBatchPending || displayLimit >= filteredProducts.length) return;
    const wait = Math.max(0, 1000 - (Date.now() - lastProductsBatchAt));
    productsBatchPending = true;
    window.setTimeout(() => {
        productsBatchPending = false;
        if (isLoadingMore || displayLimit >= filteredProducts.length) return;
        isLoadingMore = true;
        const loadingMsg = document.getElementById('scroll-loading-msg');
        const endMsg = document.getElementById('scroll-end-msg');
        if (loadingMsg) loadingMsg.classList.remove('hidden');
        if (endMsg) endMsg.classList.add('hidden');
        try {
            displayLimit = Math.min(displayLimit + CUPISSA_PRODUCT_BATCH_SIZE, filteredProducts.length);
            renderProductsGrid();
            lastProductsBatchAt = Date.now();
        } finally {
            isLoadingMore = false;
            if (loadingMsg) loadingMsg.classList.toggle('hidden', displayLimit >= filteredProducts.length);
        }
    }, wait);
}
function setupAutomaticProductLoading() {
    const sentinel = document.getElementById('scroll-status-container');
    if (!sentinel) return;
    if (productsScrollObserver) {
        productsScrollObserver.unobserve(sentinel);
        productsScrollObserver.observe(sentinel);
        return;
    }
    if ('IntersectionObserver' in window) {
        productsScrollObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadNextProductsBatch();
        }, { root: null, rootMargin: '650px 0px', threshold: 0 });
        productsScrollObserver.observe(sentinel);
    }
    // El evento de scroll complementa al observador para no detenerse si el
    // sentinel permanece dentro del margen visible después de añadir un lote.
    if (!productsScrollHandlerBound) {
        productsScrollHandlerBound = true;
        window.addEventListener('scroll', () => {
            if (productsScrollRafPending) return;
            productsScrollRafPending = true;
            requestAnimationFrame(() => {
                productsScrollRafPending = false;
                if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 650) loadNextProductsBatch();
            });
        }, { passive: true });
    }
}
window.onload = function() {
    updateBadges();
    setupAutomaticProductLoading();
    fetchCatalogProducts();
    if (typeof initializeCatalogAccountState === 'function') {
        Promise.resolve(initializeCatalogAccountState()).catch(error => {
            console.warn('No fue posible restaurar el carrito y favoritos:', error);
        });
    }
};
