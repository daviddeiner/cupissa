/* CUPISSA | Recomendaciones relacionadas, ordenadas por similitud real del catálogo. */
(() => {
  'use strict';

  const RELATED_BATCH = 8;
  let currentRelatedProducts = [];
  let relatedRendered = 0;

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-CO').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function valuesFor(product, pluralKey, singularKey) {
    const values = Array.isArray(product?.[pluralKey]) && product[pluralKey].length
      ? product[pluralKey]
      : [product?.[singularKey]];
    return [...new Set(values.map(normalizeText).filter(Boolean))];
  }

  function tokenSet(value) {
    const ignored = new Set(['para','con','del','las','los','una','uno','por','the','and','de','la','el','en','un','y']);
    return new Set(normalizeText(value).split(/\s+/).filter(token => token.length > 2 && !ignored.has(token)));
  }

  function intersectionSize(a, b) {
    let count = 0;
    a.forEach(value => { if (b.has(value)) count++; });
    return count;
  }

  function similarityScore(reference, candidate) {
    let score = 0;
    const dimensions = [
      ['subcategorias','subcategoria',12],
      ['categorias','categoria',7],
      ['mundos','mundo',3],
      ['temporadas','temporada',1.5]
    ];
    dimensions.forEach(([plural, singular, weight]) => {
      const a = new Set(valuesFor(reference, plural, singular));
      const b = new Set(valuesFor(candidate, plural, singular));
      const common = intersectionSize(a, b);
      if (common) score += weight * common / Math.max(a.size, b.size, 1);
    });

    const nameOverlap = intersectionSize(tokenSet(reference?.nombre), tokenSet(candidate?.nombre));
    if (nameOverlap) score += Math.min(8, nameOverlap * 2.5);
    const descriptionOverlap = intersectionSize(tokenSet(reference?.descripcion), tokenSet(candidate?.descripcion));
    if (descriptionOverlap) score += Math.min(2, descriptionOverlap * 0.15);
    return score;
  }

  function getPrice(product) {
    const rental = Boolean(product?.alquiler && Number(product?.precio_alquiler) > 0);
    return rental ? Number(product.precio_alquiler) : Number(product?.precio_detal || 0);
  }

  function createRelatedCard(product) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cupissa-related-card';
    card.setAttribute('aria-label', `Ver ${product.nombre}`);

    const photo = document.createElement('img');
    photo.src = String(product?.fotos?.[0] || 'https://via.placeholder.com/400x400?text=Cupissa');
    photo.alt = String(product?.nombre || 'Producto Cupissa');
    photo.loading = 'lazy';
    photo.decoding = 'async';

    const copy = document.createElement('span');
    copy.className = 'cupissa-related-card-copy';
    const name = document.createElement('span');
    name.className = 'cupissa-related-card-name';
    name.textContent = String(product?.nombre || 'Producto');
    const price = document.createElement('strong');
    price.className = 'cupissa-related-card-price';
    const amount = getPrice(product);
    price.textContent = typeof formatCOP === 'function' ? formatCOP(amount) : `$ ${amount.toLocaleString('es-CO')}`;
    copy.append(name, price);
    card.append(photo, copy);
    card.addEventListener('click', () => {
      if (typeof window.openOptionsModal === 'function') window.openOptionsModal(product.id);
    });
    return card;
  }

  function ensureRelatedSection() {
    const modal = document.getElementById('modal-product-options');
    const inner = modal?.querySelector('.product-modal-inner');
    const grid = inner?.querySelector('.product-modal-grid');
    if (!inner || !grid) return null;

    let section = document.getElementById('cupissa-related-products');
    if (!section) {
      section = document.createElement('section');
      section.id = 'cupissa-related-products';
      section.setAttribute('aria-label', 'Productos parecidos');
      const heading = document.createElement('h3');
      heading.className = 'cupissa-related-heading';
      heading.textContent = 'Productos parecidos';
      const list = document.createElement('div');
      list.id = 'cupissa-related-products-grid';
      list.className = 'cupissa-related-grid';
      const more = document.createElement('button');
      more.id = 'cupissa-related-products-more';
      more.type = 'button';
      more.className = 'cupissa-related-more';
      more.textContent = 'Ver más productos parecidos';
      more.addEventListener('click', renderRelatedBatch);
      section.append(heading, list, more);
    }

    const actions = inner.querySelector('.product-modal-actions');
    if (actions?.parentElement === inner) inner.insertBefore(section, actions);
    else grid.insertAdjacentElement('afterend', section);
    return section;
  }

  function renderRelatedBatch() {
    const section = ensureRelatedSection();
    const list = section?.querySelector('#cupissa-related-products-grid');
    const more = section?.querySelector('#cupissa-related-products-more');
    if (!list || !more) return;

    const nextBatch = currentRelatedProducts.slice(relatedRendered, relatedRendered + RELATED_BATCH);
    nextBatch.forEach(product => list.appendChild(createRelatedCard(product)));
    relatedRendered += nextBatch.length;
    more.hidden = relatedRendered >= currentRelatedProducts.length;
    if (!currentRelatedProducts.length) section.hidden = true;
  }

  function updateRelatedProducts(product) {
    const allProducts = typeof rawProducts !== 'undefined' && Array.isArray(rawProducts) ? rawProducts : [];
    const section = ensureRelatedSection();
    if (!section) return;

    currentRelatedProducts = allProducts
      .filter(item => String(item?.id) !== String(product?.id))
      .map((item, index) => ({ product: item, index, score: similarityScore(product, item) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.product);

    relatedRendered = 0;
    const list = section.querySelector('#cupissa-related-products-grid');
    if (list) list.replaceChildren();
    section.hidden = currentRelatedProducts.length === 0;
    renderRelatedBatch();
  }

  const originalOpen = window.openOptionsModal;
  if (typeof originalOpen === 'function') {
    window.openOptionsModal = function(productId) {
      const result = originalOpen.apply(this, arguments);
      if (!document.body.classList.contains('cupissa-web-product')) return result;
      const product = typeof rawProducts !== 'undefined'
        ? rawProducts.find(item => String(item.id) === String(productId))
        : null;
      if (product) updateRelatedProducts(product);
      return result;
    };
  }
})();
