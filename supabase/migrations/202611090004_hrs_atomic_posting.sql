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
      and status = 'active' and employee_access = false and custodian = 'peopleos'
      and signing_key_reference = p_signing_key_reference;
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
  v_corrected bigint;
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
       and v_existing.occurred_at = p_occurred_at
       and v_existing.actor_type = p_actor_type
       and v_existing.actor_user_id is not distinct from p_actor_user_id
       and v_existing.metadata = coalesce(p_metadata, '{}'::jsonb) then
      return v_existing.id;
    end if;
    raise exception 'Idempotency key was already used for a different HRS event'
      using errcode = '23505';
  end if;

  select
    coalesce(sum(units) filter (where entry_type = 'mint'), 0),
    coalesce(sum(units) filter (where entry_type = 'consume'), 0),
    coalesce(sum(units) filter (where entry_type = 'release'), 0),
    coalesce(sum(units) filter (where entry_type = 'correction'), 0)
  into v_minted, v_consumed, v_released, v_corrected
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
    if p_units > v_minted + v_corrected - v_consumed - v_released then
      raise exception 'Verified work exceeds remaining HRS allocation; route as an overage exception'
        using errcode = '22003';
    end if;
  elsif p_entry_type = 'release' then
    if v_minted = 0 or p_units > v_minted + v_corrected - v_consumed - v_released then
      raise exception 'Release exceeds unused minted HRS' using errcode = '22003';
    end if;
  elsif p_entry_type = 'correction' then
    -- Positive, manager-authorized correction credits only. Negative adjustments
    -- require a separately reviewed correction-debit workflow.
    if v_minted = 0 then raise exception 'Cannot correct an allocation before its initial mint' using errcode = '55000'; end if;
    if p_actor_type not in ('manager','administrator') or p_actor_user_id is null then
      raise exception 'Manager or administrator identity required for HRS correction' using errcode = '42501';
    end if;
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


-- Approved schedule provisioning + initial mint in one database transaction.
-- The trusted caller must authenticate the approver before invoking this RPC.
alter table public.hrs_allocations
  add column if not exists schedule_version text;
alter table public.hrs_allocations
  add column if not exists source_reference text;

create unique index if not exists hrs_allocations_schedule_version_uidx
  on public.hrs_allocations(tenant_id, employee_id, schedule_version)
  where schedule_version is not null;

create or replace function public.create_and_mint_hrs_schedule(
  p_tenant_id uuid,
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_scheduled_minutes integer,
  p_schedule_version text,
  p_approved_by uuid,
  p_approved_at timestamptz,
  p_source_reference text,
  p_signing_key_reference text
)
returns table (wallet_id uuid, allocation_id uuid, ledger_entry_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet_id uuid;
  v_allocation_id uuid;
  v_entry_id uuid;
  v_existing public.hrs_allocations%rowtype;
  v_existing_entry public.hrs_token_ledger%rowtype;
  v_wallet public.hrs_wallets%rowtype;
  v_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_employee_id is null or p_period_start is null
     or p_period_end is null or p_period_end < p_period_start
     or p_scheduled_minutes is null or p_scheduled_minutes <= 0
     or p_schedule_version is null or length(trim(p_schedule_version)) < 1
     or length(trim(p_schedule_version)) > 100
     or p_approved_by is null or p_approved_at is null
     or p_source_reference is null or length(trim(p_source_reference)) < 1
     or length(trim(p_source_reference)) > 300
     or p_signing_key_reference is null
     or length(trim(p_signing_key_reference)) < 8
     or length(trim(p_signing_key_reference)) > 300 then
    raise exception 'Invalid approved HRS schedule input' using errcode = '22023';
  end if;

  insert into public.hrs_wallets (
    tenant_id, employee_id, custodian, employee_access, signing_key_reference
  ) values (
    p_tenant_id, p_employee_id, 'peopleos', false, p_signing_key_reference
  )
  on conflict (tenant_id, employee_id) do nothing
  returning id into v_wallet_id;

  if v_wallet_id is null then
    select * into v_wallet from public.hrs_wallets
    where tenant_id = p_tenant_id and employee_id = p_employee_id
    for update;
    v_wallet_id := v_wallet.id;
  end if;

  if v_wallet_id is null then
    raise exception 'HRS wallet could not be provisioned' using errcode = '55000';
  end if;

  select * into v_wallet from public.hrs_wallets
  where tenant_id = p_tenant_id and id = v_wallet_id
  for update;
  if not found or v_wallet.status <> 'active'
     or v_wallet.custodian <> 'peopleos' or v_wallet.employee_access is distinct from false
     or v_wallet.signing_key_reference <> p_signing_key_reference then
    raise exception 'HRS wallet unavailable or custody policy violation' using errcode = '55000';
  end if;

  v_key := 'schedule:' || p_employee_id::text || ':' || p_schedule_version;
  select * into v_existing from public.hrs_allocations
  where tenant_id = p_tenant_id and employee_id = p_employee_id
    and schedule_version = p_schedule_version
  for update;

  if found then
    if v_existing.scheduled_minutes <> p_scheduled_minutes
       or v_existing.schedule_period_start <> p_period_start
       or v_existing.schedule_period_end <> p_period_end
       or v_existing.source_reference <> p_source_reference
       or v_existing.created_by is distinct from p_approved_by then
      raise exception 'Schedule version already exists with different contents'
        using errcode = '23505';
    end if;
    v_allocation_id := v_existing.id;
    select * into v_existing_entry from public.hrs_token_ledger
    where tenant_id = p_tenant_id and idempotency_key = v_key;
    if not found or v_existing_entry.wallet_id <> v_wallet_id
       or v_existing_entry.allocation_id <> v_allocation_id
       or v_existing_entry.entry_type <> 'mint'
       or v_existing_entry.units <> p_scheduled_minutes
       or v_existing_entry.source_reference <> p_source_reference
       or v_existing_entry.occurred_at <> p_approved_at
       or v_existing_entry.actor_type <> 'manager'
       or v_existing_entry.actor_user_id is distinct from p_approved_by
       or v_existing_entry.metadata <> jsonb_build_object('schedule_version', p_schedule_version) then
      raise exception 'Existing schedule allocation has no matching HRS mint entry'
        using errcode = '55000';
    end if;
    return query select v_wallet_id, v_allocation_id, v_existing_entry.id;
    return;
  end if;

  insert into public.hrs_allocations (
    tenant_id, employee_id, schedule_period_start, schedule_period_end,
    scheduled_minutes, created_by, schedule_version, source_reference
  ) values (
    p_tenant_id, p_employee_id, p_period_start, p_period_end,
    p_scheduled_minutes, p_approved_by, p_schedule_version, p_source_reference
  ) returning id into v_allocation_id;

  insert into public.hrs_token_ledger (
    tenant_id, wallet_id, allocation_id, entry_type, units,
    idempotency_key, source_reference, occurred_at, actor_type, actor_user_id, metadata
  ) values (
    p_tenant_id, v_wallet_id, v_allocation_id, 'mint', p_scheduled_minutes,
    v_key, p_source_reference, p_approved_at, 'manager', p_approved_by,
    jsonb_build_object('schedule_version', p_schedule_version)
  ) returning id into v_entry_id;

  return query select v_wallet_id, v_allocation_id, v_entry_id;
end;
$$;

revoke all on function public.create_and_mint_hrs_schedule(uuid, uuid, date, date, integer, text, uuid, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.create_and_mint_hrs_schedule(uuid, uuid, date, date, integer, text, uuid, timestamptz, text, text)
  to service_role;

-- Approved schedule allocations are immutable snapshots. Revisions create a new
-- schedule_version and compensating release entries; never rewrite old approvals.
create or replace function public.reject_hrs_allocation_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Approved HRS allocations are immutable; create a new schedule version';
end;
$$;
drop trigger if exists hrs_allocations_no_mutation on public.hrs_allocations;
create trigger hrs_allocations_no_mutation
  before update or delete on public.hrs_allocations
  for each row execute function public.reject_hrs_allocation_mutation();
