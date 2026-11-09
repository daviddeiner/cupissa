/**
 * CUPISSA | Catálogo / carga, normalización y datos SEO
 * Código extraído de la versión original sin cambiar la lógica.
 */

function shuffleArray(array) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        }

        const CUPISSA_CATALOG_PAGE_SIZE = 100;
        // Todos los mundos representados en la primera carga de 100 productos.
        const CUPISSA_INITIAL_WORLDS = [
            'INFANTIL', 'DAMAS', 'CABALLEROS', 'HOGAR', 'PUBLICIDAD Y EVENTOS',
            'DETALLES', 'PERSONALIZADOS', 'CONFECCIONES', 'ACCESORIOS',
            'JUGUETES', 'CALZADO', 'PAPELERÍA', 'FERRETERÍA', 'OTROS'
        ];
        let catalogInitialWorldsPending = true;

        // Garantiza que la selección del administrador esté disponible en la
        // primera carga, independientemente de la página aleatoria consultada.
        async function fetchInitialFeaturedSeasonRows() {
            const season = String(configuredFeaturedSeason || '').trim();
            if (!season || !hasFeaturedSeasonConfiguration) return [];
            const base = () => supabaseClient.from('productos')
                .select(CUPISSA_CATALOG_PRODUCT_FIELDS).eq('oculto', false);
            const [single, multiple] = await Promise.all([
                base().ilike('temporada', season).limit(5),
                base().contains('temporadas', [season]).limit(5)
            ]);
            if (single.error) console.warn('Temporada singular:', single.error);
            if (multiple.error) console.warn('Temporadas múltiples:', multiple.error);
            const unique = new Map();
            [...(single.data || []), ...(multiple.data || [])].forEach(row => {
                if (row?.id != null) unique.set(String(row.id), row);
            });
            return shuffleArray([...unique.values()]).slice(0, 5);
        }
        let catalogRealtimeChannel = null;
        const catalogRealtimeQueue = [];

        let catalogSupabasePageOffsets = [];
        let catalogSupabasePageIndex = 0;
        let catalogSupabaseHasMore = true;
        let catalogSupabaseLoading = false;
        let catalogSupabaseInitialized = false;
        let catalogLoadedProductIds = new Set();
        const CUPISSA_CATALOG_PRODUCT_FIELDS = 'id,nombre,mundo,mundos,categoria,categorias,subcategoria,subcategorias,temporada,temporadas,precio_detal,precio_mayorista,cant_min_mayorista,porcentaje_anticipo,dias_preparacion,personalizable,al_por_mayor,venta,alquiler,credito,precio_alquiler,valor_deposito,tallas,colores,fotos,created_at,descripcion,accesorios,oculto';

        function tryOpenCatalogProductFromLink() {
            if (window.__cupissaProductLinkOpened) return;
            const productFromLink = new URLSearchParams(window.location.search).get('producto');
            if (!productFromLink) return;
            const product = rawProducts.find(item => String(item.id) === productFromLink);
            if (!product) return;
            window.__cupissaProductLinkOpened = true;
            openOptionsModal(product.id);
        }

        function finishCatalogSupabaseLoading() {
            updateFeaturedSeasonProducts(true);
            renderSeasonFeatured();
            updateSEOStructuredData();
            tryOpenCatalogProductFromLink();
            catalogSupabaseHasMore = false;
        }

        async function loadNextCatalogProductsPage() {
            if (catalogSupabaseLoading || !catalogSupabaseHasMore || !catalogSupabaseInitialized) return false;
            catalogSupabaseLoading = true;
            try {
                const from = catalogSupabasePageOffsets[catalogSupabasePageIndex];
                if (from == null) {
                    finishCatalogSupabaseLoading();
                    return false;
                }
                const to = from + CUPISSA_CATALOG_PAGE_SIZE - 1;
                const { data, error } = await supabaseClient
                    .from('productos')
                    .select(CUPISSA_CATALOG_PRODUCT_FIELDS)
                    .eq('oculto', false)
                    .order('created_at', { ascending: false })
                    .range(from, to);

                if (error) throw error;
                const rows = Array.isArray(data) ? data : [];
                catalogSupabasePageIndex += 1;
                catalogSupabaseHasMore = catalogSupabasePageIndex < catalogSupabasePageOffsets.length;
                if (!rows.length) {
                    if (!catalogSupabaseHasMore) finishCatalogSupabaseLoading();
                    return false;
                }

                // Desordenar cada lote recibido, además de las páginas consultadas aleatoriamente.
                // No reordenar productos ya visibles ni modificar el scroll.
                let selectedRows = shuffleArray([...rows]);
                if (catalogInitialWorldsPending) {
                    catalogInitialWorldsPending = false;
                    // Consultas paralelas: la primera muestra incluye 1 producto de cada
                    // mundo con publicaciones disponibles, incluso fuera del rango de 100.
                    const worldRows = await Promise.all(CUPISSA_INITIAL_WORLDS.map(async world => {
                        let response = await supabaseClient.from('productos')
                            .select(CUPISSA_CATALOG_PRODUCT_FIELDS)
                            .eq('oculto', false).eq('mundo', world)
                            .order('created_at', { ascending: false }).limit(1);
                        if (!response.error && response.data?.length) return response.data[0];
                        response = await supabaseClient.from('productos')
                            .select(CUPISSA_CATALOG_PRODUCT_FIELDS)
                            .eq('oculto', false).contains('mundos', [world])
                            .order('created_at', { ascending: false }).limit(1);
                        return (!response.error && response.data?.length) ? response.data[0] : null;
                    }));
                    const representatives = worldRows.filter(Boolean);
                    const featuredRows = await fetchInitialFeaturedSeasonRows();
                    // Mostrar los representantes desde la primera pantalla, no esperar
                    // a que la carga automática complete los primeros 10 elementos.
                    displayLimit = Math.max(displayLimit, representatives.length + featuredRows.length);
                    // Reservar siempre los cinco espacios de destacados y uno
                    // por mundo antes de completar el grupo con productos aleatorios.
                    const reserved = new Map();
                    [...featuredRows, ...shuffleArray(representatives)].forEach(row => {
                        if (row?.id != null) reserved.set(String(row.id), row);
                    });
                    const rest = shuffleArray(rows.filter(row => !reserved.has(String(row.id))));
                    selectedRows = shuffleArray([
                        ...reserved.values(),
                        ...rest.slice(0, Math.max(0, CUPISSA_CATALOG_PAGE_SIZE - reserved.size))
                    ]);
                }
                const uniqueBatch = selectedRows
                    .filter(row => row?.id != null && !catalogLoadedProductIds.has(String(row.id)))
                    .map(normalizeProduct);

                uniqueBatch.forEach(product => catalogLoadedProductIds.add(String(product.id)));

                if (uniqueBatch.length) {
                    if (typeof window.loadCupissaProductPopularity === 'function') {
                        await window.loadCupissaProductPopularity(uniqueBatch);
                    }
                    // El lote viene mezclado desde arriba. No depender de una función opcional
                    // de recomendaciones que puede volver a agrupar o alterar la secuencia.
                    const mixedBatch = uniqueBatch;
                    rawProducts.push(...mixedBatch);

                    renderFilters();
                    applyFiltersAndSearch();
                    updateFeaturedSeasonProducts(false);
                    tryOpenCatalogProductFromLink();
                }

                if (!catalogSupabaseHasMore) {
                    finishCatalogSupabaseLoading();
                }
                return uniqueBatch.length > 0;
            } catch (err) {
                console.error('No fue posible cargar el siguiente grupo de productos desde Supabase:', err);
                catalogSupabaseHasMore = false;
                const status = document.getElementById('scroll-end-msg');
                if (status && !rawProducts.length) {
                    status.textContent = 'No fue posible cargar el catálogo. Recarga la página para intentarlo nuevamente.';
                    status.classList.remove('hidden');
                }
                return false;
            } finally {
                catalogSupabaseLoading = false;
            }
        }

        window.loadNextCupissaCatalogPage = loadNextCatalogProductsPage;
        window.hasMoreCupissaCatalogProducts = () => catalogSupabaseHasMore;

        async function fetchCatalogProducts() {
            rawProducts = [];
            filteredProducts = [];
            catalogSupabasePageOffsets = [];
            catalogSupabasePageIndex = 0;
            catalogSupabaseHasMore = true;
            catalogSupabaseLoading = false;
            catalogSupabaseInitialized = false;
            catalogLoadedProductIds = new Set();
            catalogInitialWorldsPending = true;
            catalogRealtimeQueue.length = 0;
            window.__cupissaProductLinkOpened = false;
            displayLimit = CUPISSA_PRODUCT_BATCH_SIZE;

            await loadConfiguredFeaturedSeason();
            try {
                const { count, error } = await supabaseClient
                    .from('productos')
                    .select('id', { count: 'exact', head: true })
                    .eq('oculto', false);
                if (error) throw error;
                const totalPages = Math.ceil(Number(count || 0) / CUPISSA_CATALOG_PAGE_SIZE);
                catalogSupabasePageOffsets = shuffleArray(
                    Array.from({ length: totalPages }, (_, index) => index * CUPISSA_CATALOG_PAGE_SIZE)
                );
                catalogSupabaseHasMore = catalogSupabasePageOffsets.length > 0;
                catalogSupabaseInitialized = true;
            } catch (error) {
                console.error('No fue posible preparar la paginación aleatoria del catálogo:', error);
                catalogSupabaseHasMore = false;
                renderFilters();
                applyFiltersAndSearch();
                return;
            }
            const loaded = await loadNextCatalogProductsPage();
            if (!loaded && !rawProducts.length) {
                renderFilters();
                applyFiltersAndSearch();
            }
            if (typeof setupAutomaticProductLoading === 'function') setupAutomaticProductLoading();
            setupCatalogRealtimeAppendOnly();
        }

        // INSERT: solo anexar al final; DELETE/UPDATE: conservar vista hasta recarga manual.
        // No se restablece rawProducts, displayLimit, filtros ni posición de scroll.
        function setupCatalogRealtimeAppendOnly() {
            if (catalogRealtimeChannel || !supabaseClient?.channel) return;
            catalogRealtimeChannel = supabaseClient.channel('cupissa-catalog-append-only')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'productos' },
                    async payload => {
                        const id = String(payload.new?.id || '');
                        if (!id || catalogLoadedProductIds.has(id)) return;
                        const { data, error } = await supabaseClient.from('productos')
                            .select(CUPISSA_CATALOG_PRODUCT_FIELDS)
                            .eq('id', id).eq('oculto', false).maybeSingle();
                        if (error || !data || catalogLoadedProductIds.has(id)) return;
                        catalogRealtimeQueue.push(normalizeProduct(data));
                        // No alterar la clasificación de los resultados durante la búsqueda.
                        if (document.getElementById('smart-search-input')?.value?.trim()) return;
                        flushCatalogRealtimeQueue();
                    })
                .subscribe();
        }
        function flushCatalogRealtimeQueue() {
            if (document.getElementById('smart-search-input')?.value?.trim()) return;
            const appended = catalogRealtimeQueue.splice(0).filter(product => {
                if (catalogLoadedProductIds.has(String(product.id))) return false;
                catalogLoadedProductIds.add(String(product.id));
                return true;
            });
            if (!appended.length) return;
            rawProducts.push(...appended);
            renderFilters();
            applyFiltersAndSearch();
        }
        window.flushCupissaNewCatalogProducts = flushCatalogRealtimeQueue;

        async function loadConfiguredFeaturedSeason() {
            hasFeaturedSeasonConfiguration = false;
            configuredFeaturedSeason = '';
            try {
                const { data, error } = await supabaseClient
                    .from('configuracion_destacados_web')
                    .select('temporada_destacada')
                    .eq('id', 1)
                    .maybeSingle();
                if (error) throw error;
                hasFeaturedSeasonConfiguration = true;
                configuredFeaturedSeason = String(data?.temporada_destacada || '')
                    .trim().toUpperCase();
            } catch (error) {
                console.warn('No fue posible leer la temporada elegida por CUPISSA ADMIN:', error);
                // Si la tabla aún no se ha creado, mantiene el comportamiento anterior del catálogo.
                hasFeaturedSeasonConfiguration = false;
                configuredFeaturedSeason = '';
            }
        }

        function parseProductArray(value) {
            if (Array.isArray(value)) return [...value];
            if (typeof value !== 'string' || !value.trim()) return [];
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        }

        function normalizeProductFilterValues(arrayValue, legacyValue = '') {
            let values = [];
            if (Array.isArray(arrayValue)) {
                values = arrayValue;
            } else if (typeof arrayValue === 'string' && arrayValue.trim()) {
                try {
                    const parsed = JSON.parse(arrayValue);
                    values = Array.isArray(parsed) ? parsed : [arrayValue];
                } catch (_) {
                    values = [arrayValue];
                }
            }
            if (!values.length && legacyValue != null && String(legacyValue).trim()) {
                values = [legacyValue];
            }
            const unique = [];
            values.forEach(value => {
                const clean = String(value ?? '').trim().toUpperCase();
                if (clean && !unique.includes(clean)) unique.push(clean);
            });
            return unique;
        }

        function normalizeProduct(p) {
            let fotosParsed = [];
            if (p.fotos) {
                if (Array.isArray(p.fotos)) fotosParsed = [...p.fotos];
                else if (typeof p.fotos === 'string') {
                    try {
                        const parsed = JSON.parse(p.fotos);
                        fotosParsed = Array.isArray(parsed) ? parsed : [p.fotos];
                    } catch(e) { fotosParsed = [p.fotos]; }
                }
            }

            let coloresParsed = [];
            if (Array.isArray(p.colores)) coloresParsed = [...p.colores];
            else if (typeof p.colores === 'string' && p.colores.trim()) {
                try {
                    const parsed = JSON.parse(p.colores);
                    coloresParsed = Array.isArray(parsed) ? parsed : [];
                } catch (_) { coloresParsed = []; }
            }
            coloresParsed = coloresParsed.map(color =>
                typeof color === 'string'
                    ? { nombre: color, incremento: 0, foto: '' }
                    : {
                        nombre: String(color.nombre || color.color || '').trim(),
                        incremento: Number(color.incremento || 0),
                        foto: String(color.foto || color.imagen || color.imagen_url || '').trim()
                    }
            );

            // Productos antiguos: si cada color tiene una foto correspondiente por orden,
            // vincularla automáticamente para que la selección sea bidireccional.
            if (coloresParsed.length > 0 && fotosParsed.length === coloresParsed.length) {
                coloresParsed = coloresParsed.map((color, index) => ({
                    ...color,
                    foto: color.foto || String(fotosParsed[index] || '')
                }));
            }

            // Cada foto asignada a un color también forma parte de la galería principal.
            coloresParsed.forEach(color => {
                const photo = String(color.foto || color.imagen || color.imagen_url || '').trim();
                if (photo && !fotosParsed.includes(photo)) fotosParsed.push(photo);
            });

            if (fotosParsed.length === 0) {
                fotosParsed = ['https://via.placeholder.com/400x400?text=Cupissa'];
            }

            let fotosOriginalesParsed = [];
            if (Array.isArray(p.fotos_originales)) fotosOriginalesParsed = [...p.fotos_originales];
            else if (typeof p.fotos_originales === 'string' && p.fotos_originales.trim()) {
                try {
                    const parsed = JSON.parse(p.fotos_originales);
                    fotosOriginalesParsed = Array.isArray(parsed) ? parsed : [p.fotos_originales];
                } catch (_) { fotosOriginalesParsed = [p.fotos_originales]; }
            }
            // Las fotos originales se conservan en la base para administración, nunca se exponen al cliente.
            fotosOriginalesParsed = [];

            const mundos = normalizeProductFilterValues(p.mundos, p.mundo || 'GENERAL');
            const categorias = normalizeProductFilterValues(p.categorias, p.categoria || 'GENERAL');
            const subcategorias = normalizeProductFilterValues(p.subcategorias, p.subcategoria || '');
            const temporadas = normalizeProductFilterValues(p.temporadas, p.temporada || '');

            return {
                id: p.id || 'p_' + Math.random().toString(36).substr(2, 9),
                fechaRegistro: p.created_at || p.fecha_creacion || '',
                nombre: (p.nombre || p.title || 'Producto Sin Nombre').toString(),
                descripcion: (p.descripcion || p.description || '').toString(),
                mundos,
                categorias,
                subcategorias,
                temporadas,
                // Campos singulares conservados para compatibilidad con el resto del catálogo.
                mundo: mundos[0] || 'GENERAL',
                categoria: categorias[0] || 'GENERAL',
                subcategoria: subcategorias[0] || '',
                temporada: temporadas[0] || '', 
                precio_detal: parseFloat(p.precio_detal || p.precio || p.price || 0),
                precio_mayorista: parseFloat(p.precio_mayorista || 0),
                precio_alquiler: parseFloat(p.precio_alquiler || 0),
                valor_deposito: parseFloat(p.valor_deposito || 0),
                cant_min_mayorista: parseInt(p.cant_min_mayorista || 6),
                porcentaje_anticipo: parseFloat(p.porcentaje_anticipo || 20),
                dias_preparacion: parseInt(p.dias_preparacion || 0),
                personalizable: !!p.personalizable,
                alquiler: (p.alquiler === true || p.alquiler === 1 || p.alquiler === '1' || String(p.alquiler).toLowerCase() === 'true') && parseFloat(p.precio_alquiler || 0) > 0,
                venta: true,
                fotos: fotosParsed,
                fotos_originales: [],
                tallas: parseProductArray(p.tallas),
                colores: coloresParsed,
                accesorios: parseProductArray(p.accesorios)
            };
        }

        function updateSEOStructuredData() {
            if (!rawProducts || rawProducts.length === 0) return;
            
            const schemaData = {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                name: 'Cupissa',
                url: 'https://cupissa.com/catalogo/',
                mainEntity: {
                    '@type': 'ItemList',
                    itemListElement: rawProducts.map((p, index) => ({
                        '@type': 'ListItem',
                        position: index + 1,
                        name: p.nombre,
                        url: `https://cupissa.com/producto/${encodeURIComponent(String(p.id))}/`
                    }))
                }
            };

            const scriptElem = document.getElementById('seo-schema-script');
            if (scriptElem) {
                scriptElem.textContent = JSON.stringify(schemaData);
            }
        }


function updateFeaturedSeasonProducts(forceShuffle = false) {
    const seasonal = rawProducts.filter(product => (product.temporadas || [product.temporada]).some(value => String(value || '').trim()));
    if (!seasonal.length) {
        featuredSeasonProducts = [];
        featuredSeasonName = '';
        return;
    }

    const seasonGroups = new Map();
    seasonal.forEach(product => {
        const productSeasons = product.temporadas?.length ? product.temporadas : [product.temporada];
        productSeasons.forEach(season => {
            const name = String(season || '').trim().toUpperCase();
            if (!name) return;
            if (!seasonGroups.has(name)) seasonGroups.set(name, []);
            if (!seasonGroups.get(name).some(item => String(item.id) === String(product.id))) {
                seasonGroups.get(name).push(product);
            }
        });
    });

    let chosenName = '';

    // Si ADMIN ya guardó una selección, esa temporada tiene prioridad absoluta.
    // Un valor NULL guardado significa que no se mostrarán destacados.
    if (hasFeaturedSeasonConfiguration) {
        chosenName = configuredFeaturedSeason && seasonGroups.has(configuredFeaturedSeason)
            ? configuredFeaturedSeason
            : '';
    } else {
        // Compatibilidad temporal con el catálogo anterior si la tabla aún no existe.
        const month = new Date().getMonth() + 1;
        const seasonalMonthRules = [
            { months:[11,12], words:['NAVIDAD','DICIEMBRE','CHRISTMAS'] },
            { months:[9,10], words:['HALLOWEEN','DISFRACES'] },
            { months:[4,5], words:['MADRES','DIA DE LA MADRE'] },
            { months:[5,6], words:['PADRES','DIA DEL PADRE'] },
            { months:[1,2], words:['CARNAVAL','SAN VALENTIN','AMOR'] },
            { months:[8,9], words:['AMOR Y AMISTAD','AMISTAD'] },
            { months:[1,7], words:['REGRESO A CLASES','ESCOLAR'] }
        ];
        const preferred = seasonalMonthRules.find(rule => rule.months.includes(month));
        if (preferred) {
            chosenName = [...seasonGroups.keys()].find(name => preferred.words.some(word => name.includes(word))) || '';
        }
        if (!chosenName) {
            chosenName = [...seasonGroups.entries()]
                .sort((a,b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'es'))[0][0];
        }
    }

    if (!chosenName) {
        featuredSeasonProducts = [];
        featuredSeasonName = '';
        return;
    }

    const group = seasonGroups.get(chosenName) || [];
    if (forceShuffle || chosenName !== featuredSeasonName || !featuredSeasonProducts.length) {
        featuredSeasonName = chosenName;
        featuredSeasonProducts = shuffleArray([...group]).slice(0,5);
    }
}
