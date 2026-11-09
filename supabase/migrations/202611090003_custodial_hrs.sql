-- PeopleOS custodial HRS token foundation.
-- HRS wallets are controlled by PeopleOS; employees receive no signing or access capability.
-- This migration stores internal custody/accounting records only. It does not deploy a chain token.

create table if not exists public.hrs_wallets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id uuid not null,
  custody_mode text not null default 'peopleos_custody'
    check (custody_mode = 'peopleos_custody'),
  custodian text not null default 'peopleos' check (custodian = 'peopleos'),
  employee_access boolean not null default false check (employee_access = false),
  signing_key_reference text not null
    check (length(trim(signing_key_reference)) between 8 and 300),
  status text not null default 'active' check (status in ('active','frozen','closed')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, employee_id)
    references public.employees(tenant_id, id) on delete restrict,
  unique (tenant_id, employee_id),
  unique (tenant_id, id)
);

create table if not exists public.hrs_token_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  wallet_id uuid not null,
  allocation_id uuid not null,
  entry_type text not null check (entry_type in ('mint','consume','release','correction')),
  units bigint not null check (units > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) between 8 and 200),
  source_reference text not null check (length(trim(source_reference)) between 1 and 300),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('manager','administrator','agent','system','provider')),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, wallet_id) references public.hrs_wallets(tenant_id, id) on delete restrict,
  unique (tenant_id, idempotency_key)
);

create table if not exists public.hrs_valuation_observations (
  id uuid primary key default gen_random_uuid(),
  token_symbol text not null default 'HRS' check (token_symbol = 'HRS'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3,8}$'),
  price_micros_per_hrs bigint not null check (price_micros_per_hrs >= 0),
  source text not null check (source in ('internal_model','external_market_observation')),
  methodology_version text not null check (length(trim(methodology_version)) between 1 and 80),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  evidence_reference text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists hrs_wallets_employee_idx
  on public.hrs_wallets(tenant_id, employee_id);
create index if not exists hrs_token_ledger_wallet_time_idx
  on public.hrs_token_ledger(tenant_id, wallet_id, recorded_at desc);
create index if not exists hrs_valuation_observations_time_idx
  on public.hrs_valuation_observations(token_symbol, quote_currency, observed_at desc);

alter table public.hrs_wallets enable row level security;
alter table public.hrs_token_ledger enable row level security;
alter table public.hrs_valuation_observations enable row level security;

-- No authenticated/anon client access. A future server-side custody service must
-- enforce tenant RBAC, wallet state, idempotency, balance locks, and audit logging.
revoke all on public.hrs_wallets from anon, authenticated;
revoke all on public.hrs_token_ledger from anon, authenticated;
revoke all on public.hrs_valuation_observations from anon, authenticated;

-- Ledger history is immutable; use compensating entries for corrections.
create or replace function public.reject_hrs_token_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'HRS token ledger is immutable; append a compensating correction';
end;
$$;

drop trigger if exists hrs_token_ledger_no_mutation on public.hrs_token_ledger;
create trigger hrs_token_ledger_no_mutation
  before update or delete on public.hrs_token_ledger
  for each row execute function public.reject_hrs_token_ledger_mutation();

-- Wallet ownership is an attribution link, not an employee-controlled wallet.
-- Do not store private keys here; signingKeyReference resolves only inside the custody service.
