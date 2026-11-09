-- Atomic server-side HRS wallet provisioning and ledger posting.
-- Only service_role may execute these SECURITY DEFINER RPCs. The RPC caller must
-- be a trusted server workflow that has already authenticated clock evidence.
-- No browser/employee/agent credential may invoke these functions.

alter table public.hrs_token_ledger
  add constraint hrs_token_ledger_allocation_fk
  foreign key (tenant_id, allocation_id)
  references public.hrs_allocations(tenant_id, id) on delete restrict;

create or replace function public.provision_hrs_wallet(
  p_tenant_id uuid,
  p_employee_id uuid,
  p_signing_key_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_employee_id is null
     or p_signing_key_reference is null
     or length(trim(p_signing_key_reference)) < 8
     or length(trim(p_signing_key_reference)) > 300 then
    raise exception 'Invalid wallet provisioning input' using errcode = '22023';
  end if;

  insert into public.hrs_wallets (
    tenant_id, employee_id, custodian, employee_access, signing_key_reference
  ) values (
    p_tenant_id, p_employee_id, 'peopleos', false, p_signing_key_reference
  )
  on conflict (tenant_id, employee_id) do nothing
  returning id into v_wallet_id;

  if v_wallet_id is null then
    select id into v_wallet_id
    from public.hrs_wallets
    where tenant_id = p_tenant_id and employee_id = p_employee_id
      and status = 'active' and employee_access = false and custodian = 'peopleos';
    if v_wallet_id is null then
      raise exception 'Existing HRS wallet is not active or does not satisfy custody policy'
        using errcode = '55000';
    end if;
  end if;

  return v_wallet_id;
end;
$$;

revoke all on function public.provision_hrs_wallet(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.provision_hrs_wallet(uuid, uuid, text) to service_role;

create or replace function public.post_hrs_allocation_event(
  p_tenant_id uuid,
  p_wallet_id uuid,
  p_allocation_id uuid,
  p_entry_type text,
  p_units bigint,
  p_idempotency_key text,
  p_source_reference text,
  p_occurred_at timestamptz,
  p_actor_type text default 'system',
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation public.hrs_allocations%rowtype;
  v_wallet public.hrs_wallets%rowtype;
  v_existing public.hrs_token_ledger%rowtype;
  v_minted bigint;
  v_consumed bigint;
  v_released bigint;
  v_balance bigint;
  v_entry_id uuid;
  v_expected_mint bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_wallet_id is null or p_allocation_id is null
     or p_entry_type is null or p_entry_type not in ('mint','consume','release','correction')
     or p_units is null or p_units <= 0
     or p_idempotency_key is null or length(trim(p_idempotency_key)) < 8
     or length(trim(p_idempotency_key)) > 200
     or p_source_reference is null or length(trim(p_source_reference)) = 0 or length(trim(p_source_reference)) > 300
     or p_occurred_at is null
     or p_actor_type is null or p_actor_type not in ('manager','administrator','system','provider') then
    raise exception 'Invalid HRS posting input' using errcode = '22023';
  end if;

  select * into v_wallet
  from public.hrs_wallets
  where tenant_id = p_tenant_id and id = p_wallet_id
  for update;
  if not found or v_wallet.status <> 'active'
     or v_wallet.employee_access is distinct from false
     or v_wallet.custodian <> 'peopleos' then
    raise exception 'HRS wallet unavailable or custody policy violation' using errcode = '55000';
  end if;

  select * into v_allocation
  from public.hrs_allocations
  where tenant_id = p_tenant_id and id = p_allocation_id
    and employee_id = v_wallet.employee_id
  for update;
  if not found then
    raise exception 'Allocation does not belong to wallet employee and tenant' using errcode = '23503';
  end if;

  select * into v_existing
  from public.hrs_token_ledger
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.wallet_id = p_wallet_id
       and v_existing.allocation_id = p_allocation_id
       and v_existing.entry_type = p_entry_type
       and v_existing.units = p_units
       and v_existing.source_reference = p_source_reference
       and v_existing.occurred_at = p_occurred_at then
      return v_existing.id;
    end if;
    raise exception 'Idempotency key was already used for a different HRS event'
      using errcode = '23505';
  end if;

  select
    coalesce(sum(units) filter (where entry_type = 'mint'), 0),
    coalesce(sum(units) filter (where entry_type = 'consume'), 0),
    coalesce(sum(units) filter (where entry_type = 'release'), 0)
  into v_minted, v_consumed, v_released
  from public.hrs_token_ledger
  where tenant_id = p_tenant_id and wallet_id = p_wallet_id
    and allocation_id = p_allocation_id;

  if p_entry_type = 'mint' then
    if v_minted > 0 then
      raise exception 'Allocation already minted; schedule revisions require a new allocation or approved correction'
        using errcode = '23505';
    end if;
    v_expected_mint := v_allocation.scheduled_minutes;
    if p_units <> v_expected_mint then
      raise exception 'Mint quantity must exactly match approved scheduled minutes'
        using errcode = '22023';
    end if;
  elsif p_entry_type = 'consume' then
    if v_minted = 0 then raise exception 'Cannot consume HRS before schedule mint' using errcode = '55000'; end if;
    if p_units > v_minted - v_consumed - v_released then
      raise exception 'Verified work exceeds remaining HRS allocation; route as an overage exception'
        using errcode = '22003';
    end if;
  elsif p_entry_type = 'release' then
    if v_minted = 0 or p_units > v_minted - v_consumed - v_released then
      raise exception 'Release exceeds unused minted HRS' using errcode = '22003';
    end if;
  elsif p_entry_type = 'correction' then
    -- Corrections are positive compensating credits only. Negative adjustments
    -- must be represented by an explicitly reviewed consume/reversal workflow.
    if p_units > 1000000 then raise exception 'Correction exceeds safety limit' using errcode = '22003'; end if;
  end if;

  insert into public.hrs_token_ledger (
    tenant_id, wallet_id, allocation_id, entry_type, units,
    idempotency_key, source_reference, occurred_at, actor_type, actor_user_id, metadata
  ) values (
    p_tenant_id, p_wallet_id, p_allocation_id, p_entry_type, p_units,
    p_idempotency_key, p_source_reference, p_occurred_at, p_actor_type, p_actor_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_entry_id;

  return v_entry_id;
end;
$$;

revoke all on function public.post_hrs_allocation_event(uuid, uuid, uuid, text, bigint, text, text, timestamptz, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.post_hrs_allocation_event(uuid, uuid, uuid, text, bigint, text, text, timestamptz, text, uuid, jsonb)
  to service_role;

comment on function public.provision_hrs_wallet(uuid, uuid, text) is
  'Creates an employee-attributed HRS wallet held exclusively in PeopleOS custody. Service role only.';
comment on function public.post_hrs_allocation_event(uuid, uuid, uuid, text, bigint, text, text, timestamptz, text, uuid, jsonb) is
  'Atomically posts idempotent HRS mint/consume/release/correction entries. Service role only; caller must validate source evidence.';
