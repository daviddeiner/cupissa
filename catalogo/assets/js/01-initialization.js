/** CUPISSA | Carga progresiva automática: 30 productos por consulta y 10 tarjetas por segundo. */
let productsBatchPending = false;
let productsAutoLoadTimer = null;

async function loadNextProductsBatch() {
    if (productsBatchPending || isLoadingMore) return;
    productsBatchPending = true;
    isLoadingMore = true;

    const loadingMsg = document.getElementById('scroll-loading-msg');
    const endMsg = document.getElementById('scroll-end-msg');
    if (loadingMsg) loadingMsg.classList.remove('hidden');
    if (endMsg) endMsg.classList.add('hidden');

    try {
        if (displayLimit < filteredProducts.length) {
            displayLimit = Math.min(displayLimit + CUPISSA_PRODUCT_BATCH_SIZE, filteredProducts.length);
            renderProductsGrid();
            return;
        }

        // Cuando ya se mostraron los productos descargados, traer el siguiente grupo
        // de 30 desde Supabase. No depende del scroll ni de alcanzar el final de la página.
        if (typeof window.hasMoreCupissaCatalogProducts === 'function' &&
            window.hasMoreCupissaCatalogProducts() &&
            typeof window.loadNextCupissaCatalogPage === 'function') {
            const previousCount = filteredProducts.length;
            await window.loadNextCupissaCatalogPage();
            if (filteredProducts.length > previousCount) {
                displayLimit = Math.min(displayLimit + CUPISSA_PRODUCT_BATCH_SIZE, filteredProducts.length);
                renderProductsGrid();
            }
        }
    } catch (error) {
        console.error('[CUPISSA] Error durante la carga automática del catálogo:', error);
    } finally {
        productsBatchPending = false;
        isLoadingMore = false;
        if (loadingMsg) loadingMsg.classList.toggle('hidden', displayLimit >= filteredProducts.length);
        if (endMsg && !(typeof window.hasMoreCupissaCatalogProducts === 'function' && window.hasMoreCupissaCatalogProducts())) {
            endMsg.classList.toggle('hidden', displayLimit < filteredProducts.length);
            if (displayLimit >= filteredProducts.length) endMsg.textContent = 'Has llegado al final del catálogo';
        }
    }
}

function setupAutomaticProductLoading() {
    if (productsAutoLoadTimer !== null) return;
    // El intervalo es la fuente principal de carga. El cliente no tiene que desplazarse
    // hasta el centinela ni acercarse al final para descubrir nuevos productos.
    productsAutoLoadTimer = window.setInterval(() => {
        loadNextProductsBatch();
    }, 1000);
}

window.onload = function() {
    updateBadges();
    fetchCatalogProducts();
    if (typeof initializeCatalogAccountState === 'function') {
        Promise.resolve(initializeCatalogAccountState()).catch(error => {
            console.warn('No fue posible restaurar el carrito y favoritos:', error);
        });
    }
};
