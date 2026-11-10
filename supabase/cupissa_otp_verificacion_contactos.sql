-- CUPISSA: comprobación de contacto SOLO después de verificar el OTP.
-- Ningún visitante anónimo puede consultar correos o teléfonos de otros clientes.
-- No reemplaza ni modifica funciones de pagos, pedidos o correos.
create or replace function public.cupissa_check_registration_contact(p_telefono text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_user auth.users%rowtype;
  v_email text;
  v_phone text := right(regexp_replace(coalesce(p_telefono,''), '[^0-9]', '', 'g'), 10);
  v_email_exists boolean;
  v_phone_used_other boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Primero verifica tu correo mediante OTP.' using errcode = '28000';
  end if;
  select * into v_user from auth.users where id = auth.uid();
  if not found or v_user.email_confirmed_at is null then
    raise exception 'Primero verifica tu correo mediante OTP.' using errcode = '28000';
  end if;
  v_email := lower(trim(v_user.email));
  select (
    exists(select 1 from public.clientes where lower(trim(coalesce(correo,''))) = v_email)
    or exists(select 1 from public.clientes_web where lower(trim(coalesce(correo,''))) = v_email)
  ) into v_email_exists;
  if length(v_phone) = 10 then
    select (
      exists(select 1 from public.clientes where right(regexp_replace(coalesce(telefono::text,''),'[^0-9]','','g'),10) = v_phone
        and lower(trim(coalesce(correo,''))) <> v_email)
      or exists(select 1 from public.clientes_web where right(regexp_replace(coalesce(telefono::text,''),'[^0-9]','','g'),10) = v_phone
        and lower(trim(coalesce(correo,''))) <> v_email)
    ) into v_phone_used_other;
  end if;
  return jsonb_build_object('email_existing', v_email_exists, 'phone_used_by_other', v_phone_used_other);
end;
$$;
revoke all on function public.cupissa_check_registration_contact(text) from public, anon;
grant execute on function public.cupissa_check_registration_contact(text) to authenticated;
