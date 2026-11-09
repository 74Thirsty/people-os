-- Supabase application onboarding and private tenant-scoped document storage.
-- Tenant creation is performed by the authenticated database identity, never by
-- accepting an arbitrary owner UUID from a browser request.

create table if not exists public.tenant_creation_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  request_hash text not null check (length(request_hash) = 64),
  tenant_id uuid references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);
alter table public.tenant_creation_requests enable row level security;
revoke all on public.tenant_creation_requests from public, anon, authenticated;

create or replace function public.has_tenant_role(target_tenant uuid, allowed_roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = target_tenant
      and m.user_id = (select auth.uid())
      and m.role = any(allowed_roles)
  );
$$;
revoke all on function public.has_tenant_role(uuid, text[]) from public, anon;
grant execute on function public.has_tenant_role(uuid, text[]) to authenticated;

create or replace function public.create_tenant_for_current_user(
  p_legal_name text,
  p_display_name text,
  p_timezone text,
  p_request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_existing_hash text;
  v_request_hash text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_legal_name is null or length(trim(p_legal_name)) not between 2 and 200
     or p_display_name is null or length(trim(p_display_name)) not between 2 and 120
     or p_timezone is null or length(trim(p_timezone)) not between 1 and 100
     or p_request_key is null then
    raise exception 'Invalid tenant setup details' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown IANA time zone' using errcode = '22023';
  end if;

  v_request_hash := encode(
    public.digest(convert_to(jsonb_build_array(trim(p_legal_name), trim(p_display_name), p_timezone)::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.tenant_creation_requests(user_id, request_key, request_hash)
  values (v_user_id, p_request_key, v_request_hash)
  on conflict (user_id, request_key) do nothing;

  select tenant_id, request_hash into v_tenant_id, v_existing_hash
  from public.tenant_creation_requests
  where user_id = v_user_id and request_key = p_request_key
  for update;

  if v_existing_hash <> v_request_hash then
    raise exception 'Request key was already used with different tenant details' using errcode = '23505';
  end if;
  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  insert into public.tenants(legal_name, display_name, timezone, status)
  values (trim(p_legal_name), trim(p_display_name), p_timezone, 'active')
  returning id into v_tenant_id;

  insert into public.tenant_memberships(tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  insert into public.audit_events(
    tenant_id, actor_user_id, actor_type, event_type, subject_type, subject_id,
    source_channel, payload
  ) values (
    v_tenant_id, v_user_id, 'administrator', 'tenant.created', 'tenant', v_tenant_id,
    'web', jsonb_build_object('display_name', trim(p_display_name))
  );

  update public.tenant_creation_requests
  set tenant_id = v_tenant_id
  where user_id = v_user_id and request_key = p_request_key;

  return v_tenant_id;
end;
$$;
revoke all on function public.create_tenant_for_current_user(text, text, text, uuid) from public, anon;
grant execute on function public.create_tenant_for_current_user(text, text, text, uuid) to authenticated;

-- Safe tenant-folder policy helpers. Validate before casting arbitrary object paths to UUID.
create or replace function public.storage_object_tenant_member(object_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant_folder text := (storage.foldername(object_name))[1];
begin
  if v_tenant_folder is null or v_tenant_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_tenant_member(v_tenant_folder::uuid);
end;
$$;

create or replace function public.storage_object_tenant_role(object_name text, allowed_roles text[])
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant_folder text := (storage.foldername(object_name))[1];
begin
  if v_tenant_folder is null or v_tenant_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.has_tenant_role(v_tenant_folder::uuid, allowed_roles);
end;
$$;
revoke all on function public.storage_object_tenant_member(text) from public, anon;
revoke all on function public.storage_object_tenant_role(text, text[]) from public, anon;
grant execute on function public.storage_object_tenant_member(text) to authenticated;
grant execute on function public.storage_object_tenant_role(text, text[]) to authenticated;

-- Private document bucket. Object names must begin with the tenant UUID folder.
insert into storage.buckets(id, name, public, file_size_limit)
values ('peopleos-documents', 'peopleos-documents', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "tenant members read PeopleOS documents" on storage.objects;
create policy "tenant members read PeopleOS documents"
on storage.objects for select to authenticated
using (bucket_id = 'peopleos-documents' and public.storage_object_tenant_member(name));

drop policy if exists "tenant managers upload PeopleOS documents" on storage.objects;
create policy "tenant managers upload PeopleOS documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'peopleos-documents'
  and public.storage_object_tenant_role(name, array['owner','administrator','manager'])
);

drop policy if exists "tenant managers update PeopleOS documents" on storage.objects;
create policy "tenant managers update PeopleOS documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'peopleos-documents'
  and public.storage_object_tenant_role(name, array['owner','administrator','manager'])
)
with check (
  bucket_id = 'peopleos-documents'
  and public.storage_object_tenant_role(name, array['owner','administrator','manager'])
);

drop policy if exists "tenant owners delete PeopleOS documents" on storage.objects;
create policy "tenant owners delete PeopleOS documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'peopleos-documents'
  and public.storage_object_tenant_role(name, array['owner','administrator'])
);

comment on function public.create_tenant_for_current_user(text, text, text, uuid) is
  'Atomically creates a tenant and assigns the authenticated caller as owner. Idempotent per request key.';
