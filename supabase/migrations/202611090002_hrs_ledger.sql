-- HRS is an internal hour-accounting unit, not money or a transferable crypto asset.
-- Quantities are integer minutes (60 minutes = 1 HRS) to avoid floating-point drift.
-- No authenticated client write policies are defined in this migration.

create table if not exists public.hrs_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id uuid not null,
  schedule_period_start date not null,
  schedule_period_end date not null,
  scheduled_minutes integer not null check (scheduled_minutes > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, employee_id)
    references public.employees(tenant_id, id) on delete restrict,
  check (schedule_period_end >= schedule_period_start),
  unique (tenant_id, id)
);

create table if not exists public.hrs_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id uuid not null,
  allocation_id uuid not null,
  entry_type text not null check (
    entry_type in ('schedule_mint','work_consumption','schedule_release','correction')
  ),
  minutes integer not null check (minutes > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) between 8 and 200),
  source_reference text not null check (length(trim(source_reference)) between 1 and 200),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('employee','manager','administrator','agent','system','provider')),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, employee_id)
    references public.employees(tenant_id, id) on delete restrict,
  foreign key (tenant_id, allocation_id)
    references public.hrs_allocations(tenant_id, id) on delete restrict,
  unique (tenant_id, idempotency_key)
);

create index if not exists hrs_allocations_employee_period_idx
  on public.hrs_allocations(tenant_id, employee_id, schedule_period_start, schedule_period_end);
create index if not exists hrs_ledger_employee_time_idx
  on public.hrs_ledger_entries(tenant_id, employee_id, occurred_at desc);
create index if not exists hrs_ledger_allocation_idx
  on public.hrs_ledger_entries(tenant_id, allocation_id, recorded_at);

alter table public.hrs_allocations enable row level security;
alter table public.hrs_ledger_entries enable row level security;

create policy "members can read HRS allocations"
  on public.hrs_allocations for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members can read HRS ledger"
  on public.hrs_ledger_entries for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- Ledger history is append-only. Corrections must be compensating entries.
create or replace function public.reject_hrs_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'HRS ledger entries are immutable; append a compensating correction';
end;
$$;

drop trigger if exists hrs_ledger_no_update on public.hrs_ledger_entries;
create trigger hrs_ledger_no_update
  before update or delete on public.hrs_ledger_entries
  for each row execute function public.reject_hrs_ledger_mutation();

-- Writes are intentionally absent until a server-side posting function exists
-- that locks allocations, enforces mint/consume/release limits, checks RBAC,
-- validates clock evidence, and appends an audit event in the same transaction.
-- Never allow an LLM or browser client to write these tables directly.
