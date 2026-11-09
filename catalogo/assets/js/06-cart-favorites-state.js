/**
 * CUPISSA | Catálogo / estado del carrito y favoritos
 * Código extraído de la versión original sin cambiar la lógica.
 */

function addModalProductToCart() {
    if (!selectedProductModal) return;

    const selectTalla = document.getElementById('opt-select-talla');
    const selectColor = document.getElementById('opt-select-color');
    const inputCustom = document.getElementById('opt-input-custom');
    const customText = inputCustom ? inputCustom.value.trim() : '';
    const accesoriosElegidos = typeof cupissaSelectedAccessories === 'function' ? cupissaSelectedAccessories() : [];
    const accesorio = accesoriosElegidos.map(item => item.nombre).join(', ') || null;
    const accesorioFoto = accesoriosElegidos[0]?.foto || '';
    const color = selectColor?.value || null;
    const colorFoto = selectColor?.selectedOptions?.[0]?.dataset.photo || '';
    const modalMainPhoto = document.getElementById('opt-modal-img')?.src || '';
    const sizeItems = typeof cupissaGetSelectedSizeItems === 'function' ? cupissaGetSelectedSizeItems() : [];
    const hasSizeOptions = typeof cupissaGetProductSizes === 'function' && cupissaGetProductSizes().length > 0;
    const totalQuantity = hasSizeOptions
        ? sizeItems.reduce((sum, item) => sum + item.cantidad, 0)
        : Math.max(1, Number(selectedQtyModal || 1));

    if (hasSizeOptions && totalQuantity < 1) {
        alert('Selecciona al menos una unidad en alguna talla.');
        return;
    }

    const wholesale = selectedModalidad === 'venta' &&
        Number(selectedProductModal.cant_min_mayorista || 0) > 0 &&
        totalQuantity >= Number(selectedProductModal.cant_min_mayorista) &&
        Number(selectedProductModal.precio_mayorista || 0) > 0;
    const baseUnitPrice = selectedModalidad === 'alquiler'
        ? Number(selectedProductModal.precio_alquiler || 0)
        : wholesale
            ? Number(selectedProductModal.precio_mayorista)
            : Number(selectedProductModal.precio_detal || 0);
    const colorExtra = selectColor?.selectedOptions?.[0] ? Number(selectColor.selectedOptions[0].dataset.inc || 0) : 0;
    const accessoryExtra = accesoriosElegidos.reduce((sum, item) => sum + Number(item.incremento || 0), 0);
    const commonPhoto = colorFoto || modalMainPhoto || selectedProductModal.fotos?.[0] || '';
    const percentage = Number(selectedProductModal.porcentaje_anticipo ?? 20);
    const rows = hasSizeOptions
        ? sizeItems
        : [{ talla: selectTalla?.value || null, cantidad: totalQuantity, incremento: Number(selectTalla?.selectedOptions?.[0]?.dataset.inc || 0) }];

    const newItems = rows.map((row, index) => {
        const quantity = Math.max(1, Number(row.cantidad || 1));
        const unitPrice = baseUnitPrice + Number(row.incremento || 0) + colorExtra + accessoryExtra;
        const lineTotal = unitPrice * quantity;
        return {
            cartId: `${selectedProductModal.id}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
            productId: selectedProductModal.id,
            nombre: selectedProductModal.nombre,
            modalidad: selectedModalidad.toUpperCase(),
            foto: commonPhoto,
            fotoColor: colorFoto,
            talla: row.talla || null,
            color,
            accesorio,
            accesorios: accesoriosElegidos,
            accesorioFoto,
            customText,
            cantidad: quantity,
            cantidadMayorista: totalQuantity,
            precioUnitario: unitPrice,
            total: lineTotal,
            deposito: selectedModalidad === 'alquiler' ? Number(selectedProductModal.valor_deposito || 0) * quantity : 0,
            porcentajeAnticipo: percentage,
            valorAnticipo: Math.round(lineTotal * percentage / 100)
        };
    });

    cart.push(...newItems);
    saveCart();
    animateProductToCart(commonPhoto);
    showCartAddedFeedback();
}

        // Estado compartido del catálogo: carrito y favoritos se guardan en el navegador,
        // sin separarlos por cuenta. Así el checkout siempre lee la misma lista visible.
        function parseStoredArray(value) {
            try {
                const parsed = JSON.parse(value || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        }

        function getAccountScopedCandidates(prefix) {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(`${prefix}_account_`)) keys.push(key);
            }

            // Conserva el carrito más recientemente actualizado como migración
            // de los datos que se habían guardado en las versiones por cuenta.
            return keys.map(key => {
                const accountPart = key.slice(`${prefix}_account_`.length);
                const updatedKey = `cupissa_catalog_updated_account_${accountPart}`;
                const updatedAt = localStorage.getItem(updatedKey);
                const timestamp = updatedAt ? new Date(updatedAt).getTime() : 0;
                return { key, timestamp: Number.isFinite(timestamp) ? timestamp : 0 };
            }).sort((a, b) => b.timestamp - a.timestamp);
        }

        function restoreSharedValue(storageKey, scopedPrefix) {
            const current = parseStoredArray(localStorage.getItem(storageKey));
            if (current.length) return current;

            for (const candidate of getAccountScopedCandidates(scopedPrefix)) {
                const legacy = parseStoredArray(localStorage.getItem(candidate.key));
                if (legacy.length) {
                    try {
                        localStorage.setItem(storageKey, JSON.stringify(legacy));
                    } catch (error) {
                        console.warn(`No fue posible migrar ${storageKey}:`, error);
                    }
                    return legacy;
                }
            }
            return current;
        }

        function initializeCatalogAccountState() {
            // Se mantiene el nombre de inicialización para no cambiar los módulos
            // que ya lo invocan, pero ya no se requiere sesión ni consulta remota.
            cart = restoreSharedValue('cupissa_cart', 'cupissa_cart');
            favorites = restoreSharedValue('cupissa_favs', 'cupissa_favs');
            updateBadges();
            return Promise.resolve({ cart, favorites });
        }

        function saveCart() {
            try {
                localStorage.setItem('cupissa_cart', JSON.stringify(cart));
            } catch (error) {
                console.error('No fue posible guardar el carrito CUPISSA:', error);
            }
            updateBadges();
        }

        function saveFavorites() {
            try {
                localStorage.setItem('cupissa_favs', JSON.stringify(favorites));
            } catch (error) {
                console.error('No fue posible guardar los favoritos CUPISSA:', error);
            }
            updateBadges();
            applyFiltersAndSearch();
        }

        function updateBadges() {
            const cartCount = cart.reduce((acc, c) => acc + c.cantidad, 0);
            const badgeValues = {
                'cart-badge-count': cartCount,
                'fav-badge-count': favorites.length,
                'mobile-cart-badge-count': cartCount,
                'mobile-fav-badge-count': favorites.length
            };
            Object.entries(badgeValues).forEach(([id, value]) => {
                const badge = document.getElementById(id);
                if (badge) badge.innerText = value;
            });
        }

        function toggleFavorite(prodId, e) {
            if (e) e.stopPropagation();
            const prod = rawProducts.find(p => p.id === prodId);
            if (!prod) return;
            const idx = favorites.findIndex(f => f.id === prodId);
            if (idx >= 0) favorites.splice(idx, 1);
            else favorites.push(prod);
            saveFavorites();
        }

        function toggleFavoriteCurrent() {
            if (selectedProductModal) {
                toggleFavorite(selectedProductModal.id);
                const isFav = favorites.some(f => f.id === selectedProductModal.id);
                document.getElementById('btn-modal-fav').innerHTML = `<i class="${isFav ? 'fa-solid fa-heart text-pink-600' : 'fa-regular fa-heart'} text-xl"></i>`;
            }
        }
