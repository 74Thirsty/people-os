-- Universal company configuration persistence.
-- Configuration snapshots are immutable and tenant-scoped. Credentials are
-- references only; no secret material is stored in these tables.

alter table public.tenants
  add column if not exists config_slug text;
create unique index if not exists tenants_config_slug_uidx
  on public.tenants(config_slug) where config_slug is not null;

create table if not exists public.tenant_config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  status text not null check (status in ('draft','active','superseded','retired')),
  source text not null check (source in ('repository','admin')),
  change_summary text check (change_summary is null or length(change_summary) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (tenant_id, version),
  unique (tenant_id, id),
  check (
    (status = 'active' and activated_at is not null) or
    (status <> 'active')
  )
);
create unique index if not exists tenant_config_versions_one_active_uidx
  on public.tenant_config_versions(tenant_id) where status = 'active';
create index if not exists tenant_config_versions_tenant_created_idx
  on public.tenant_config_versions(tenant_id, created_at desc);

create table if not exists public.tenant_integrations (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider text not null check (provider in ('microsoft','twilio')),
  state text not null check (state in ('not_configured','configured','provisioned','verified','operational','error')),
  credential_references jsonb not null default '{}'::jsonb,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  capabilities jsonb not null default '{}'::jsonb,
  evidence text check (evidence is null or length(evidence) <= 1000),
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider)
);
-- A phone number routes inbound messages to exactly one tenant.
create unique index if not exists tenant_integrations_phone_uidx
  on public.tenant_integrations(phone_e164) where phone_e164 is not null;

create table if not exists public.tenant_messaging_contacts (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  consent_state text not null default 'unknown' check (consent_state in ('unknown','opted_in','opted_out')),
  consent_source text check (consent_source is null or length(consent_source) <= 200),
  consent_updated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone_e164)
);

create table if not exists public.tenant_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider_sid text,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null check (channel in ('sms','mms','voice')),
  from_e164 text check (from_e164 is null or from_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  to_e164 text check (to_e164 is null or to_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  body text check (body is null or length(body) <= 4000),
  media_urls text[] not null default '{}'::text[],
  status text not null check (status in ('queued','sent','delivered','undelivered','failed','received','read')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider_sid)
);
create index if not exists tenant_messages_tenant_created_idx
  on public.tenant_messages(tenant_id, created_at desc);
create index if not exists tenant_messages_contact_idx
  on public.tenant_messages(tenant_id, from_e164, created_at desc);

alter table public.tenant_config_versions enable row level security;
alter table public.tenant_integrations enable row level security;
alter table public.tenant_messaging_contacts enable row level security;
alter table public.tenant_messages enable row level security;

create policy "members can read tenant configuration versions"
  on public.tenant_config_versions for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members can read tenant integrations"
  on public.tenant_integrations for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members can read tenant messaging contacts"
  on public.tenant_messaging_contacts for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members can read tenant messages"
  on public.tenant_messages for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.tenant_config_versions, public.tenant_integrations,
  public.tenant_messaging_contacts, public.tenant_messages from anon, authenticated;
grant select on public.tenant_config_versions, public.tenant_integrations,
  public.tenant_messaging_contacts, public.tenant_messages to authenticated;

-- Configuration snapshots are append-only. Only activation/supersession status
-- may change; content, version, source, and hash are immutable.
create or replace function public.reject_tenant_config_version_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Tenant configuration versions are immutable';
  end if;
  if old.tenant_id is distinct from new.tenant_id
     or old.version is distinct from new.version
     or old.content_hash is distinct from new.content_hash
     or old.config is distinct from new.config
     or old.source is distinct from new.source
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'Tenant configuration version content is immutable';
  end if;
  if old.status = 'active' and new.status = 'superseded' then
    return new;
  end if;
  if old.status = new.status
     and old.activated_at is not distinct from new.activated_at
     and old.change_summary is not distinct from new.change_summary then
    return new;
  end if;
  raise exception 'Only activation status may change on a configuration version';
end;
$$;

drop trigger if exists tenant_config_versions_immutable on public.tenant_config_versions;
create trigger tenant_config_versions_immutable
  before update or delete on public.tenant_config_versions
  for each row execute function public.reject_tenant_config_version_mutation();

-- Atomic version publication. The trusted server must validate and authorize
-- the configuration before calling this service-role-only function.
create or replace function public.publish_tenant_config_version(
  p_tenant_id uuid,
  p_version text,
  p_content_hash text,
  p_config jsonb,
  p_source text,
  p_created_by uuid,
  p_change_summary text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_existing public.tenant_config_versions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_tenant_id is null
     or p_version is null or p_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
     or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
     or p_config is null or jsonb_typeof(p_config) <> 'object'
     or p_source not in ('repository','admin')
     or (p_created_by is not null and not exists (select 1 from auth.users u where u.id = p_created_by)) then
    raise exception 'Invalid tenant configuration version' using errcode = '22023';
  end if;

  select * into v_existing from public.tenant_config_versions
  where tenant_id = p_tenant_id and version = p_version
  for update;
  if found then
    if v_existing.content_hash = p_content_hash
       and v_existing.config = p_config
       and v_existing.source = p_source then
      return v_existing.id;
    end if;
    raise exception 'Configuration version already exists with different content'
      using errcode = '23505';
  end if;

  update public.tenant_config_versions
  set status = 'superseded'
  where tenant_id = p_tenant_id and status = 'active';

  insert into public.tenant_config_versions(
    tenant_id, version, content_hash, config, status, source,
    change_summary, created_by, activated_at
  ) values (
    p_tenant_id, p_version, p_content_hash, p_config, 'active', p_source,
    p_change_summary, p_created_by, now()
  ) returning id into v_version_id;

  insert into public.audit_events(
    tenant_id, actor_user_id, actor_type, event_type, subject_type, subject_id,
    source_channel, payload
  ) values (
    p_tenant_id, p_created_by,
    case when p_created_by is null then 'system' else 'administrator' end,
    'tenant.configuration.version.published', 'tenant_config_version', v_version_id,
    'system', jsonb_build_object('version', p_version, 'hash', p_content_hash, 'source', p_source)
  );

  return v_version_id;
end;
$$;

revoke all on function public.publish_tenant_config_version(uuid, text, text, jsonb, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.publish_tenant_config_version(uuid, text, text, jsonb, text, uuid, text)
  to service_role;

comment on table public.tenant_config_versions is
  'Immutable validated company configuration snapshots. Exactly one active version per tenant.';
comment on table public.tenant_integrations is
  'Provider connectivity state with credential references only, never secret material.';
comment on function public.publish_tenant_config_version(uuid, text, text, jsonb, text, uuid, text) is
  'Atomically supersedes the active configuration version and publishes a new validated snapshot. Service role only.';
