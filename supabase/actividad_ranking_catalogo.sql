-- CUPISSA | Ranking público del catálogo por visitas únicas y unidades compradas.
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Reutiliza producto_vistas_web y pedidos_web; no modifica productos ni pedidos.

CREATE TABLE IF NOT EXISTS public.producto_vistas_web (
  producto_id text NOT NULL,
  visitante_id text NOT NULL,
  ultima_vista timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (producto_id, visitante_id)
);


CREATE OR REPLACE FUNCTION public.cupissa_obtener_ranking_productos_web(
  p_product_ids text[]
)
RETURNS TABLE (
  product_id text,
  total_vistas bigint,
  total_compras bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH requested AS (
    SELECT DISTINCT NULLIF(BTRIM(requested_id.value), '') AS product_id
    FROM UNNEST(COALESCE(p_product_ids, ARRAY[]::text[])) AS requested_id(value)
    WHERE NULLIF(BTRIM(requested_id.value), '') IS NOT NULL
  ),
  views AS (
    SELECT v.producto_id AS product_id,
           COUNT(DISTINCT v.visitante_id)::bigint AS total_vistas
    FROM public.producto_vistas_web v
    INNER JOIN requested r ON r.product_id = v.producto_id
    GROUP BY v.producto_id
  ),
  purchases AS (
    SELECT COALESCE(item.value->>'producto_id', item.value->>'productId', '') AS product_id,
           SUM(GREATEST(
             CASE
               WHEN COALESCE(item.value->>'cantidad', '') ~ '^[0-9]+$'
                 THEN (item.value->>'cantidad')::integer
               ELSE 1
             END,
             0
           ))::bigint AS total_compras
    FROM public.pedidos_web p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.productos, '[]'::jsonb)) AS item(value)
    INNER JOIN requested r
      ON r.product_id = COALESCE(item.value->>'producto_id', item.value->>'productId', '')
    WHERE COALESCE(p.estado, '') <> 'CANCELADO'
      AND COALESCE(p.tipo_pedido, 'VENTA') = 'VENTA'
      AND COALESCE(item.value->>'modalidad', 'VENTA') = 'VENTA'
    GROUP BY COALESCE(item.value->>'producto_id', item.value->>'productId', '')
  )
  SELECT r.product_id,
         COALESCE(v.total_vistas, 0)::bigint AS total_vistas,
         COALESCE(p.total_compras, 0)::bigint AS total_compras
  FROM requested r
  LEFT JOIN views v ON v.product_id = r.product_id
  LEFT JOIN purchases p ON p.product_id = r.product_id;
$function$;

REVOKE ALL ON FUNCTION public.cupissa_obtener_ranking_productos_web(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupissa_obtener_ranking_productos_web(text[])
  TO anon, authenticated, service_role;
