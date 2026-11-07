/**
 * CUPISSA | Catálogo / carga gradual automática.
 * Primeros 20 productos al iniciar; otros 20 cada 2 segundos.
 * No depende del scroll y no reconstruye las tarjetas ya visibles.
 */

let productsBatchTimer = null;

function loadNextProductsBatch() {
    if (isLoadingMore || displayLimit >= filteredProducts.length) return;
    isLoadingMore = true;
    const statusContainer = document.getElementById('scroll-status-container');
    const loadingMsg = document.getElementById('scroll-loading-msg');
    const endMsg = document.getElementById('scroll-end-msg');
    if (statusContainer) statusContainer.classList.remove('hidden');
    if (loadingMsg) loadingMsg.classList.remove('hidden');
    if (endMsg) endMsg.classList.add('hidden');

    try {
        displayLimit = Math.min(displayLimit + CUPISSA_PRODUCT_BATCH_SIZE, filteredProducts.length);
        renderProductsGrid();
    } finally {
        isLoadingMore = false;
        if (loadingMsg) loadingMsg.classList.toggle('hidden', displayLimit >= filteredProducts.length);
    }
}

function setupAutomaticProductLoading() {
    if (productsBatchTimer !== null) return;
    productsBatchTimer = window.setInterval(loadNextProductsBatch, 2000);
}

window.onload = function() {
    updateBadges();
    setupAutomaticProductLoading();
    fetchCatalogProducts();
    if (typeof initializeCatalogAccountState === 'function') {
        Promise.resolve(initializeCatalogAccountState()).catch(error => {
            console.warn('No fue posible restaurar el carrito y favoritos de la cuenta:', error);
        });
    }
};
