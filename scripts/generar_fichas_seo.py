#!/usr/bin/env python3
"""Genera fichas HTML indexables y sitemaps desde productos públicos de Supabase.

No modifica Supabase, el catálogo, los pedidos ni el inicio de sesión.
Usa solo la llave pública anon ya presente en shared/js/supabase-config.js.
"""
import argparse
import csv
import datetime as dt
import html
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

DOMAIN = 'https://cupissa.com'
MAIN_PAGES = ('/catalogo/', '/terminos-y-condiciones/', '/politica-de-datos-personales/',
              '/politica-de-compras-y-garantias/', '/politica-y-condiciones-de-alquileres/',
              '/politicas-anticipos/', '/terminos-credito/', '/tratamiento-datos/', '/credito-cupissa/')
BAD_PHOTO = 'via.placeholder.com'


def public_config(root):
    data = (root / 'shared/js/supabase-config.js').read_text(encoding='utf-8')
    def get(name):
        m = re.search(r'window\.' + re.escape(name) + r'\s*=\s*[\'\"]([^\'\"]+)[\'\"]', data)
        if not m:
            raise ValueError('No se encontró la configuración pública de ' + name)
        return m.group(1)
    return (os.environ.get('CUPISSA_SUPABASE_URL') or get('CUPISSA_SUPABASE_URL')).rstrip('/'), \
           os.environ.get('CUPISSA_SUPABASE_ANON_KEY') or get('CUPISSA_SUPABASE_ANON_KEY')


def get_public_products(root):
    url, key = public_config(root)
    fields = ('id,nombre,descripcion,precio_detal,precio_alquiler,venta,alquiler,fotos,oculto,'
              'mundo,mundos,categoria,categorias,subcategoria,subcategorias,temporada,temporadas,personalizable')
    batch = 500
    products = []
    while True:
        offset = len(products)
        endpoint = f'{url}/rest/v1/productos?select={fields}&oculto=eq.false&order=id.asc&limit={batch}&offset={offset}'
        req = Request(endpoint, headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                                         'Accept': 'application/json', 'Accept-Encoding': 'identity'})
        try:
            with urlopen(req, timeout=40) as resp:
                page = json.load(resp)
        except (HTTPError, URLError, TimeoutError) as exc:
            raise RuntimeError('No se pudieron leer productos públicos de Supabase; no se alteraron fichas existentes.') from exc
        if not isinstance(page, list):
            raise RuntimeError('Respuesta inesperada de Supabase; se preservan las fichas existentes.')
        products.extend(page)
        if len(page) < batch:
            return products
        if len(products) > 200000:
            raise RuntimeError('Límite de seguridad de paginación alcanzado.')


def image_urls(value):
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            value = parsed if isinstance(parsed, list) else [value]
        except ValueError:
            value = [value]
    if not isinstance(value, list):
        value = []
    photos = []
    for item in value:
        if not isinstance(item, str):
            continue
        item = item.strip()
        if not item or BAD_PHOTO in item:
            continue
        url = urlsplit(item)
        if url.scheme == 'https' and url.netloc and item not in photos:
            photos.append(item)
        elif item.startswith('/') and not item.startswith('//'):
            photos.append(DOMAIN + item)
    return photos


def safe_id(value):
    if value is None:
        return None
    ident = str(value)
    return ident if re.fullmatch(r'[A-Za-z0-9_-]{1,90}', ident) else None


def escape(value):
    return html.escape(str(value or ''), quote=True)


def money(value):
    try:
        n = float(value)
        return f'${n:,.0f}'.replace(',', '.') + ' COP'
    except (ValueError, TypeError):
        return 'Consultar precio'


def product_price(p):
    try:
        sale = float(p.get('precio_detal') or 0)
        rent = float(p.get('precio_alquiler') or 0)
        if sale > 0 and p.get('venta') is not False:
            return sale, 'Precio desde'
        if rent > 0 and p.get('alquiler'):
            return rent, 'Alquiler desde'
        return (sale if sale > 0 else rent if rent > 0 else None), 'Precio desde'
    except (TypeError, ValueError):
        return None, 'Consultar'


def clean_text(value):
    '''Texto legible para metadatos; la ficha comercial en Supabase no se modifica.'''
    raw = html.unescape(str(value or ''))
    raw = re.sub(r'<[^>]*>', ' ', raw)
    return re.sub(r'\s+', ' ', raw).strip()


def first_classification(product, plural, singular):
    '''Lee indistintamente datos de productos antiguos y nuevos.'''
    values = product.get(plural) or product.get(singular) or ''
    if isinstance(values, str) and values.strip().startswith('['):
        try:
            parsed = json.loads(values)
            if isinstance(parsed, list):
                values = parsed
        except ValueError:
            pass
    if not isinstance(values, list):
        values = [values]
    for item in values:
        value = clean_text(item)
        if value and value.casefold() not in ('general', 'todos', 'todas', 'otros', 'sin categoria'):
            return value.capitalize() if value.isupper() else value
    return ''


def product_classification(product):
    return [x for x in (
        first_classification(product, 'mundos', 'mundo'),
        first_classification(product, 'categorias', 'categoria'),
        first_classification(product, 'subcategorias', 'subcategoria'),
    ) if x]


def product_name(product):
    return clean_text(product.get('nombre')) or 'Producto Cupissa'


def truncate_words(value, max_chars):
    value = clean_text(value)
    if len(value) <= max_chars:
        return value
    clipped = value[:max_chars + 1].rsplit(' ', 1)[0].rstrip(' ,;:-')
    return (clipped if len(clipped) >= max_chars // 2 else value[:max_chars].rstrip()) + '…'


def seo_title(product):
    '''Nombre real + contexto de Supabase; no agrega atributos inventados.'''
    name = product_name(product)
    category = product_classification(product)
    suffix = next((c for c in reversed(category) if c.casefold() not in name.casefold()), '')
    enriched = f'{name} | {suffix} | Cupissa' if suffix else f'{name} | Cupissa'
    return truncate_words(enriched if len(enriched) <= 88 else f'{name} | Cupissa', 110)


def seo_description(product, limit=500):
    name = product_name(product)
    original = clean_text(product.get('descripcion'))
    classification = product_classification(product)
    phrases = [original if original else f'{name} en Cupissa.']
    context = ' / '.join(classification)
    if context and not all(c.casefold() in original.casefold() for c in classification):
        phrases.append(f'Categoría: {context}.')
    if product.get('personalizable') is True and 'personaliz' not in original.casefold():
        phrases.append('Producto personalizable.')
    if 'colombia' not in original.casefold():
        phrases.append('Envíos a toda Colombia.')
    result = ' '.join(phrases)
    return truncate_words(result, limit)


def seo_image_alt(product, number=1):
    name = product_name(product)
    # "Foto 2" no presupone el ángulo, el material ni el color de la imagen.
    context = next((x for x in reversed(product_classification(product)) if x.casefold() not in name.casefold()), '')
    alt = f'{name} — {context}' if context else name
    if number > 1:
        alt += f' — foto {number}'
    return truncate_words(alt + ' | Cupissa', 190)


def product_html(p):
    identifier = safe_id(p['id'])
    title = product_name(p)
    description = clean_text(p.get('descripcion')) or f'{title}. Encuéntralo en Cupissa.'
    title_meta = seo_title(p)
    meta_description = seo_description(p, limit=158)
    long_description = seo_description(p, limit=950)
    images = image_urls(p.get('fotos'))
    image = images[0] if images else DOMAIN + '/catalogo/assets/images/logo.png'
    img_alt = seo_image_alt(p) if images else 'Logo de Cupissa'
    url = f'{DOMAIN}/producto/{quote(identifier)}/'
    catalog = f'{DOMAIN}/catalogo/?producto={quote(identifier)}'
    price, price_label = product_price(p)
    category = product_classification(p)
    schema = {
        '@context': 'https://schema.org', '@type': 'Product',
        '@id': url + '#producto', 'name': title, 'description': long_description,
        'sku': identifier, 'url': url,
        'brand': {'@type': 'Brand', 'name': 'Cupissa'},
    }
    if images:
        schema['image'] = images[:10]
    if category:
        schema['category'] = ' > '.join(category)
    if price is not None:
        schema['offers'] = {'@type': 'Offer', 'url': url, 'price': price,
                            'priceCurrency': 'COP', 'seller': {'@type': 'Organization', 'name': 'Cupissa'}}
    # BreadcrumbList describe la jerarquía existente sin inventar páginas de categorías.
    breadcrumbs = {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Catálogo Cupissa', 'item': DOMAIN + '/catalogo/'},
            {'@type': 'ListItem', 'position': 2, 'name': title, 'item': url}
        ]
    }
    def jsonld(obj):
        return json.dumps(obj, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    price_meta = (f'<meta property="product:price:amount" content="{price:.0f}">\n'
                  '<meta property="product:price:currency" content="COP">') if price is not None else ''
    gallery = '\n'.join(
        f'<img src="{escape(src)}" alt="{escape(seo_image_alt(p, idx))}" title="{escape(title)} — foto {idx}" '
        f'loading="lazy" decoding="async" width="520" height="520">'
        for idx, src in enumerate(images[1:11], start=2))
    gallery = f'<div class="gallery">{gallery}</div>' if gallery else ''
    classification = ('<p class="category">' + escape(' › '.join(category)) + '</p>') if category else ''
    og_extra_images = '\n'.join(f'<meta property="og:image" content="{escape(src)}">' for src in images[1:5])
    return f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title_meta)}</title>
<meta name="description" content="{escape(meta_description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{escape(url)}">
<link rel="icon" href="/catalogo/assets/images/favicon.png" type="image/png">
<meta property="og:type" content="product">
<meta property="og:locale" content="es_CO">
<meta property="og:site_name" content="Cupissa">
<meta property="og:title" content="{escape(title_meta)}">
<meta property="og:description" content="{escape(meta_description)}">
<meta property="og:url" content="{escape(url)}">
<meta property="og:image" content="{escape(image)}">
<meta property="og:image:alt" content="{escape(img_alt)}">
{og_extra_images}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(title_meta)}">
<meta name="twitter:description" content="{escape(meta_description)}">
<meta name="twitter:image" content="{escape(image)}">
<meta name="twitter:image:alt" content="{escape(img_alt)}">
<meta name="pin:description" content="{escape(long_description)}">
<meta name="pin:media" content="{escape(image)}">
{price_meta}
<script type="application/ld+json">{jsonld(schema)}</script>
<script type="application/ld+json">{jsonld(breadcrumbs)}</script>
<style>
:root{{font-family:Inter,ui-sans-serif,system-ui,Arial,sans-serif;color:#22212a;background:#f8f8fa}}
*{{box-sizing:border-box}}body{{margin:0}}a{{color:inherit}}header{{background:white;border-bottom:1px solid #eee}}.head{{max-width:1120px;margin:auto;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:20px}}.logo{{height:40px;width:auto;max-width:185px;object-fit:contain}}.back{{font-size:14px;font-weight:700;color:#a91362;text-decoration:none}}main{{max-width:1120px;margin:35px auto 60px;padding:0 18px}}.crumb{{font-size:13px;color:#71717a;margin-bottom:24px}}.layout{{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:38px;align-items:start}}.photo{{border-radius:22px;overflow:hidden;background:white;border:1px solid #eee;min-height:260px;display:grid;place-items:center}}.photo img{{display:block;width:100%;height:auto;max-height:660px;object-fit:contain}}.gallery{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:14px}}.gallery img{{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;border:1px solid #eee;background:white}}.info{{padding:9px 0}}.eyebrow{{font-size:12px;font-weight:800;color:#be185d;letter-spacing:.05em}}h1{{font-size:clamp(25px,3vw,40px);letter-spacing:-.035em;line-height:1.17;margin:12px 0 22px}}.price{{font-weight:850;font-size:30px;color:#14121a;margin:0 0 22px}}.price small{{display:block;color:#76717a;font-size:13px;font-weight:600;margin-bottom:4px}}.desc{{white-space:pre-wrap;line-height:1.8;color:#4b5563;margin:22px 0 30px;overflow-wrap:anywhere}}.category{{color:#555;font-size:14px;margin:8px 0}}.button{{display:inline-flex;justify-content:center;text-align:center;align-items:center;padding:16px 28px;background:#d61c73;color:white;border-radius:14px;font-size:15px;font-weight:800;text-decoration:none;min-height:54px}}.button:hover{{background:#ac135a}}.note{{font-size:13px;color:#76717a;margin-top:19px}}footer{{border-top:1px solid #e7e7eb;text-align:center;padding:24px;color:#67616b;font-size:12px}}@media(max-width:740px){{.layout{{grid-template-columns:1fr;gap:20px}}.head{{padding:13px 16px}}.logo{{height:34px}}main{{margin:24px auto 38px}}.info{{padding:0}}.gallery{{gap:7px}}.photo{{min-height:170px}}}}
</style>
</head>
<body>
<header><div class="head"><a href="/catalogo/"><img class="logo" src="/catalogo/assets/images/logo.png" alt="Cupissa"></a><a class="back" href="/catalogo/">Volver al catálogo</a></div></header>
<main><div class="crumb"><a href="/catalogo/">Cupissa</a> / {escape(title)}</div>
<article class="layout" itemscope itemtype="https://schema.org/Product">
<div><div class="photo"><img src="{escape(image)}" alt="{escape(img_alt)}" title="{escape(title)} — Cupissa" width="720" height="720" fetchpriority="high" itemprop="image"></div>{gallery}</div>
<div class="info"><span class="eyebrow">Cupissa</span><h1 itemprop="name">{escape(title)}</h1>
{classification}
<div class="price"><small>{escape(price_label)}</small>{escape(money(price))}</div>
<div class="desc" itemprop="description">{escape(description)}</div>
<a class="button" href="{escape(catalog)}">Elegir opciones y comprar</a>
<p class="note">Somos fabricantes y hacemos productos a tu gusto. Envíos a toda Colombia.</p></div>
</article></main><footer>© Cupissa · <a href="/catalogo/">Ver catálogo</a></footer>
</body></html>'''


def write_sitemaps(root, products):
    ET.register_namespace('', 'http://www.sitemaps.org/schemas/sitemap/0.9')
    ET.register_namespace('image', 'http://www.google.com/schemas/sitemap-image/1.1')
    ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
    img_ns = '{http://www.google.com/schemas/sitemap-image/1.1}'
    root_node = ET.Element(ns + 'urlset')
    for path in MAIN_PAGES:
        node = ET.SubElement(root_node, ns + 'url')
        ET.SubElement(node, ns + 'loc').text = DOMAIN + path
    for p in products:
        identifier = safe_id(p.get('id'))
        if not identifier:
            continue
        node = ET.SubElement(root_node, ns + 'url')
        ET.SubElement(node, ns + 'loc').text = f'{DOMAIN}/producto/{quote(identifier)}/'
        for link in image_urls(p.get('fotos'))[:8]:
            image = ET.SubElement(node, img_ns + 'image')
            ET.SubElement(image, img_ns + 'loc').text = link
    ET.indent(root_node, space='  ')
    content = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root_node, encoding='unicode') + '\n'
    for name in ('sitemap.xml', 'sitemaps.xml'):
        (root / name).write_text(content, encoding='utf-8')


def write_pinterest_feed(root, products):
    '''Feed con clasificación, fotos adicionales y alt accesible desde Supabase.'''
    columns = ('id', 'title', 'description', 'link', 'image_link', 'price', 'availability',
               'brand', 'product_type', 'additional_image_link', 'alt_text')
    with (root / 'pinterest-feed.csv').open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for p in products:
            images = image_urls(p.get('fotos'))
            amount, _ = product_price(p)
            ident = safe_id(p.get('id'))
            if not ident or not images or amount is None or amount <= 0:
                continue
            name = product_name(p)
            writer.writerow({
                'id': ident, 'title': name[:500],
                'description': seo_description(p, limit=2000),
                'link': f'{DOMAIN}/producto/{quote(ident)}/',
                'image_link': images[0], 'price': f'{amount:.2f} COP',
                'availability': 'in stock', 'brand': 'Cupissa',
                'product_type': ' > '.join(product_classification(p)),
                'additional_image_link': ', '.join(images[1:11]),
                'alt_text': seo_image_alt(p).replace(',', ' '),
            })


def generate(root, products, allow_empty=False):
    if not products and not allow_empty:
        raise RuntimeError('Supabase no devolvió productos. Para proteger fichas existentes no se cambia nada.')
    valid = [p for p in products if isinstance(p, dict) and str(p.get('oculto', False)).lower() not in ('true', '1') and safe_id(p.get('id'))]
    if not valid and not allow_empty:
        raise RuntimeError('No hay productos públicos válidos; no se cambia nada.')
    target = root / 'producto'
    target.mkdir(parents=True, exist_ok=True)
    valid_ids = set()
    for p in valid:
        identifier = safe_id(p['id'])
        valid_ids.add(identifier)
        dest = target / identifier
        dest.mkdir(exist_ok=True)
        page = dest / 'index.html'
        contents = product_html(p)
        if not page.exists() or page.read_text(encoding='utf-8') != contents:
            page.write_text(contents, encoding='utf-8')
    # Borrar solo fichas de producto generadas previamente (nunca otros módulos).
    for page in target.glob('*/index.html'):
        if page.parent.name not in valid_ids:
            page.unlink()
            try:
                page.parent.rmdir()
            except OSError:
                pass
    write_sitemaps(root, valid)
    write_pinterest_feed(root, valid)
    print(f'Fichas indexables generadas: {len(valid)}. Sitemaps y feed actualizados.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--input', type=Path, help='JSON de prueba (sin conectarse a Supabase)')
    parser.add_argument('--allow-empty', action='store_true', help='Permitir catálogo completamente vacío')
    args = parser.parse_args()
    root = args.site_root.resolve()
    try:
        products = json.loads(args.input.read_text(encoding='utf-8')) if args.input else get_public_products(root)
        if not isinstance(products, list):
            raise ValueError('La entrada debe ser una lista de productos.')
        generate(root, products, allow_empty=args.allow_empty)
    except (RuntimeError, ValueError, OSError) as exc:
        print('ERROR:', exc, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
