/**
 * CUPISSA | Edge Function: credit-payments
 * Solo pagos de crédito del Portal de Pagos (independiente del checkout de la tienda).
 *
 * Acciones:
 *   - create_credit_payment  -> calcula monto real, crea referencia + firma de integridad
 *   - confirm_credit_payment -> consulta Wompi, valida y aplica el abono (una sola vez)
 *
 * Secrets requeridos (supabase secrets set ...):
 *   WOMPI_PUBLIC_KEY        pub_test_xxx  |  pub_prod_xxx
 *   WOMPI_INTEGRITY_SECRET  test_integrity_xxx | prod_integrity_xxx
 * Automáticos de Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- Configuración ----------
const CURRENCY = "COP";
const TZ = "America/Bogota";
const LOCK_MINUTES = 2;
const PAID_STATE = "PAGADO";      // estado del crédito cuando llega a 0 (ajústalo si usas otro)
const FREQ_COLUMN = "frecuencia"; // nombre de la columna de frecuencia en `creditos`
const RESTORE_CUPO = true;        // al abonar, devuelve ese valor a cupo_disponible

const PUBLIC_KEY = Deno.env.get("WOMPI_PUBLIC_KEY") ?? "";
const INTEGRITY_SECRET = Deno.env.get("WOMPI_INTEGRITY_SECRET") ?? "";
// El ambiente se deduce de la llave pública: evita mezclar sandbox con producción.
const WOMPI_API = PUBLIC_KEY.startsWith("pub_prod_")
  ? "https://production.wompi.co/v1"
  : "https://sandbox.wompi.co/v1";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

class HttpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// ---------- Fechas (misma lógica del front, en hora de Colombia) ----------
function todayBogota(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

function daysInMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function fmt(y: number, m1: number, d: number) {
  const date = new Date(Date.UTC(y, m1 - 1, d));
  return date.toISOString().slice(0, 10);
}

function nextDueDate(current: string, frequency?: string | null): string {
  const [year, month, day] = String(current).split("-").map(Number);
  if (!year || !month || !day) throw new Error("Fecha de próximo pago inválida.");

  const f = String(frequency || "Mensual")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  if (f.includes("diari")) return fmt(year, month, day + 1);
  if (f.includes("seman")) return fmt(year, month, day + 7);

  if (f.includes("quinc") || f.includes("15 dia") || f.includes("cada 15")) {
    if (day <= 15) {
      return fmt(year, month, Math.min(day + 15, daysInMonth(year, month)));
    }
    const ny = month === 12 ? year + 1 : year;
    const nm = month === 12 ? 1 : month + 1;
    return fmt(ny, nm, Math.min(day - 15, daysInMonth(ny, nm)));
  }

  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  return fmt(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

function moraDetails(dueDate: string | null, base: number) {
  if (!dueDate || base <= 0) return { moraAmount: 0, daysLate: 0 };
  const [y, m, d] = dueDate.split("-").map(Number);
  const [ty, tm, td] = todayBogota().split("-").map(Number);
  const days = Math.max(
    0,
    Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000),
  );
  const pct = Math.floor(days / 5) * 4; // 4% por cada 5 días
  return { moraAmount: Math.round(base * (pct / 100)), daysLate: days };
}

// ---------- Datos ----------
async function authClient(clientId: string, password: string) {
  const { data, error } = await supabase
    .from("clientes").select("id, password").eq("id", clientId).maybeSingle();
  if (error) throw new HttpError("No se pudo validar al cliente.", 500);
  if (!data || String(data.password) !== String(password)) {
    throw new HttpError("Tu sesión expiró. Ingresa nuevamente al Portal de Pagos.", 401);
  }
}

async function loadActiveCredits(clientId: string) {
  const { data, error } = await supabase
    .from("creditos").select("*").eq("cliente_id", clientId).eq("estado", "ACTIVO");
  if (error) throw new HttpError("No se pudieron consultar los créditos.", 500);
  return (data ?? [])
    .filter((c) => Number(c.deuda_actual || 0) > 0.009)
    .sort((a, b) =>
      String(a.proximo_vencimiento || "9999-12-31")
        .localeCompare(String(b.proximo_vencimiento || "9999-12-31"))
    );
}

function buildPlan(credits: any[], requestedType: "min" | "tot") {
  const total = credits.reduce((s, c) => s + Math.max(0, Number(c.deuda_actual || 0)), 0);
  const baseMin = credits.reduce((s, c) => s + Math.max(0, Number(c.valor_cuota || 0)), 0);
  const firstDue = credits.find((c) => c.proximo_vencimiento)?.proximo_vencimiento ?? null;
  const { moraAmount } = moraDetails(firstDue, baseMin);

  let amount = requestedType === "tot" ? total : Math.min(baseMin + moraAmount, total);
  amount = Math.round(amount);
  // Si la cuota con mora alcanza o supera la deuda, equivale a pagar todo.
  const type: "min" | "tot" = requestedType === "tot" || amount >= Math.round(total) ? "tot" : "min";
  return { total, baseMin, moraAmount, amount, type };
}

function buildUpdates(credits: any[], type: "min" | "tot") {
  let cupoDelta = 0;
  const updates = credits.map((c) => {
    const deuda = Number(c.deuda_actual || 0);
    const abono = type === "tot" ? deuda : Math.min(Number(c.valor_cuota || 0), deuda);
    const nueva = Math.round(Math.max(0, deuda - abono) * 100) / 100;
    const paid = nueva <= 0.009;
    cupoDelta += abono;

    // Una cuota liquidada ya no tiene próximo vencimiento.
    // Se envía NULL real (no una cadena vacía) y la columna debe admitir NULL.
    let due: string | null = c.proximo_vencimiento ?? null;
    if (paid) due = null;
    else if (abono > 0 && c.proximo_vencimiento) {
      due = nextDueDate(c.proximo_vencimiento, c[FREQ_COLUMN]);
    }

    return {
      id: String(c.id),
      deuda_actual: paid ? 0 : nueva,
      estado: paid ? PAID_STATE : c.estado,
      proximo_vencimiento: due,
    };
  });
  return { updates, cupoDelta: RESTORE_CUPO ? Math.round(cupoDelta) : 0 };
}

// ---------- Wompi ----------
async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchWompiTransaction(id: string) {
  const res = await fetch(`${WOMPI_API}/transactions/${encodeURIComponent(id)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.data) {
    console.error("[credit-payments] Wompi respondió", res.status, JSON.stringify(body), "API:", WOMPI_API);
    return null;
  }
  return body.data;
}

// ---------- Acciones ----------
async function createCreditPayment(b: any) {
  if (!PUBLIC_KEY || !INTEGRITY_SECRET) {
    throw new HttpError("Faltan los secretos de Wompi en el servidor.", 500);
  }
  const clientId = String(b.clientId || "");
  await authClient(clientId, String(b.clientPassword || ""));

  const credits = await loadActiveCredits(clientId);
  if (!credits.length) throw new HttpError("No tienes deudas pendientes por pagar.");

  const plan = buildPlan(credits, b.paymentType === "tot" ? "tot" : "min");
  if (plan.amount <= 0) throw new HttpError("No tienes deudas pendientes por pagar.");

  const amountInCents = plan.amount * 100;
  const reference = `CRED-${clientId.slice(0, 8)}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const signature = await sha256Hex(`${reference}${amountInCents}${CURRENCY}${INTEGRITY_SECRET}`);

  const { error } = await supabase.from("pagos_credito").insert({
    reference,
    cliente_id: clientId,
    tipo: plan.type,
    monto: plan.amount,
    mora: plan.type === "min" ? plan.moraAmount : 0,
    amount_in_cents: amountInCents,
  });
  if (error) {
    console.error("[credit-payments] insert pagos_credito:", error);
    throw new HttpError("No se pudo registrar el pago. Inténtalo de nuevo.", 500);
  }

  return {
    reference,
    amount: plan.amount,
    amountInCents,
    currency: CURRENCY,
    publicKey: PUBLIC_KEY,
    signature,
  };
}

async function confirmCreditPayment(b: any) {
  const clientId = String(b.clientId || "");
  const reference = String(b.reference || "");
  const transactionId = String(b.transactionId || "");
  if (!reference || !transactionId) throw new HttpError("Faltan datos para confirmar el pago.");

  await authClient(clientId, String(b.clientPassword || ""));

  const { data: pago, error } = await supabase
    .from("pagos_credito").select("*").eq("reference", reference).maybeSingle();
  if (error) throw new HttpError("No se pudo consultar el pago.", 500);
  if (!pago || String(pago.cliente_id) !== clientId) throw new HttpError("Pago no encontrado.", 404);

  if (pago.aplicado) return { status: "APPROVED", duplicate: true };

  const tx = await fetchWompiTransaction(transactionId);
  if (!tx) return { status: "PENDING", detail: "Wompi aún no entrega la transacción." };

  if (
    String(tx.reference) !== reference ||
    Number(tx.amount_in_cents) !== Number(pago.amount_in_cents) ||
    String(tx.currency) !== CURRENCY
  ) {
    console.error("[credit-payments] Transacción no coincide", { tx, pago });
    throw new HttpError("La transacción no coincide con el pago solicitado.", 409);
  }

  const status = String(tx.status || "PENDING").toUpperCase();
  if (status === "PENDING") return { status };
  if (status !== "APPROVED") {
    await supabase.from("pagos_credito")
      .update({ estado: status, wompi_transaction_id: transactionId }).eq("reference", reference);
    return { status };
  }

  // Candado para que dos confirmaciones simultáneas no apliquen dos veces.
  const cutoff = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { data: locked } = await supabase
    .from("pagos_credito")
    .update({ locked_at: new Date().toISOString() })
    .eq("reference", reference).eq("aplicado", false)
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`)
    .select("reference");
  if (!locked?.length) return { status: "PENDING", detail: "Otro proceso está aplicando este pago." };

  const credits = await loadActiveCredits(clientId);
  const { updates, cupoDelta } = buildUpdates(credits, pago.tipo === "tot" ? "tot" : "min");

  // Una sola transacción SQL: créditos + cupo + marca de pago aplicado.
  const { error: rpcError } = await supabase.rpc("aplicar_pago_credito", {
    p_reference: reference,
    p_transaction_id: transactionId,
    p_updates: updates,
    p_cupo_delta: cupoDelta,
  });
  if (rpcError) {
    console.error("[credit-payments] aplicar_pago_credito:", rpcError);
    await supabase.from("pagos_credito").update({ locked_at: null }).eq("reference", reference);
    throw new HttpError("El pago fue aprobado pero no se pudo aplicar aún. Se reintentará.", 500);
  }

  return { status: "APPROVED" };
}

// ---------- Servidor ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    switch (body?.action) {
      case "create_credit_payment": return json(await createCreditPayment(body));
      case "confirm_credit_payment": return json(await confirmCreditPayment(body));
      default: throw new HttpError("Acción no válida.");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error("[credit-payments]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado." }, status);
  }
});