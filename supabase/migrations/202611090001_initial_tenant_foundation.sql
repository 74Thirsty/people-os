-- PeopleOS tenant foundation. Review and apply only to a fresh Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) between 2 and 200),
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  timezone text not null,
  status text not null default 'provisioning' check (status in ('provisioning','active','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','administrator','manager','auditor')),
  created_at timestamptz not null default now(),
  primary key (tenant_id,user_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  employee_number text not null,
  legal_first_name text not null,
  legal_last_name text not null,
  preferred_name text,
  work_email text,
  mobile_phone text,
  employment_status text not null default 'pending' check (employment_status in ('pending','active','leave','terminated')),
  hire_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,employee_number),
  unique (tenant_id,id)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('employee','manager','administrator','agent','system','provider')),
  event_type text not null,
  subject_type text not null,
  subject_id uuid,
  source_channel text check (source_channel in ('sms','voice','email','web','system','provider')),
  source_reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenant_memberships_user_id_idx on public.tenant_memberships(user_id, tenant_id);
create index if not exists employees_tenant_status_idx on public.employees(tenant_id,employment_status);
create index if not exists audit_events_tenant_created_idx on public.audit_events(tenant_id,created_at desc);
create index if not exists audit_events_subject_idx on public.audit_events(tenant_id,subject_type,subject_id);

create or replace function public.is_tenant_member(target_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_memberships m where m.tenant_id=target_tenant and m.user_id=(select auth.uid()));
$$;
revoke all on function public.is_tenant_member(uuid) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.employees enable row level security;
alter table public.audit_events enable row level security;

create policy "members can read their tenants" on public.tenants for select to authenticated using (public.is_tenant_member(id));
create policy "members can read tenant memberships" on public.tenant_memberships for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "members can read employees" on public.employees for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "members can read audit events" on public.audit_events for select to authenticated using (public.is_tenant_member(tenant_id));

-- Explicit least-privilege table grants; RLS remains the tenant boundary.
revoke all on public.tenants, public.tenant_memberships, public.employees, public.audit_events from anon;
grant select on public.tenants, public.tenant_memberships, public.employees, public.audit_events to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.tenants, public.tenant_memberships, public.employees, public.audit_events from authenticated;

-- Intentionally no client-side write policies yet. Add writes only with
-- server-side authorization, permission checks, idempotency, and audit logging.
