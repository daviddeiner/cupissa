/** CUPISSA | Sesión única de Perfil y Portal. */
let cupissaPortalAuthSyncRunning = false;
let cupissaPortalLastUser = null;
async function cupissaPortalRefreshSession() {
    if (cupissaPortalAuthSyncRunning) return;
    cupissaPortalAuthSyncRunning = true;
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (!session?.user) {
            cupissaPortalLastUser = null;
            currentClient = null;
            document.getElementById('client-dashboard')?.classList.add('hidden');
            document.getElementById('client-login-card')?.classList.remove('hidden');
            return;
        }
        let client = null;
        try {
            const linked = await window.CUPISSAAuth.getLinkedAccount();
            client = linked?.client || null;
        } catch (e) { console.warn('[CUPISSA PORTAL] La ficha vinculada requiere una segunda consulta:', e); }
        if (!client && session.user.email && typeof resolveCreditClientByEmail === 'function') {
            client = await resolveCreditClientByEmail(session.user.email, session.user.id);
        }
        if (!client) throw new Error('Cuenta autenticada, pero sin ficha de crédito vinculada.');
        if (cupissaPortalLastUser !== session.user.id || document.getElementById('client-dashboard')?.classList.contains('hidden')) {
            cupissaPortalLastUser = session.user.id;
            await showClientDashboard(client);
        } else {
            document.getElementById('client-login-card')?.classList.add('hidden');
            document.getElementById('client-dashboard')?.classList.remove('hidden');
        }
        const params = new URLSearchParams(window.location.search);
        if (window.self === window.top && params.get('cupissa_google_return') === '1' && params.get('cupissa_mobile_return') === '1') {
            window.location.replace('/catalogo/?cupissa_open_portal=1');
        }
    } catch (e) {
        console.warn('[CUPISSA PORTAL] No fue posible consultar el crédito:', e);
        // Nunca presentar una sesión válida como cerrada solo porque falló una consulta.
        if (cupissaPortalLastUser) document.getElementById('client-login-card')?.classList.add('hidden');
    } finally { cupissaPortalAuthSyncRunning = false; }
}
document.addEventListener('DOMContentLoaded', () => {
    supabaseClient.auth.onAuthStateChange(() => setTimeout(cupissaPortalRefreshSession, 0));
    cupissaPortalRefreshSession();
    window.addEventListener('focus', cupissaPortalRefreshSession);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cupissaPortalRefreshSession(); });
    window.addEventListener('message', event => {
        if (event.origin === location.origin && ['CUPISSA_AUTH_CHANGED','CUPISSA_PORTAL_REFRESH'].includes(event.data?.type)) cupissaPortalRefreshSession();
    });
    setInterval(() => { if (!document.hidden) cupissaPortalRefreshSession(); }, 15000);
});
