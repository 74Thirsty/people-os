-- One versioned, tenant-isolated JSON configuration document per company.
-- Operational ledgers remain normalized; this document owns company setup,
-- people/role assignments, permissions, policies, and integration references.

create table if not exists public.tenant_configurations (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  schema_version text not null default '1.0.0',
  revision bigint not null default 1 check (revision > 0),
  configuration jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_configuration_object check (jsonb_typeof(configuration) = 'object'),
  constraint tenant_configuration_size check (pg_column_size(configuration) <= 10485760)
);

alter table public.tenant_configurations enable row level security;
revoke all on public.tenant_configurations from public, anon;
grant select on public.tenant_configurations to authenticated;
create policy "tenant members read company configuration"
  on public.tenant_configurations for select to authenticated
  using (public.is_tenant_member(tenant_id));
-- No direct INSERT/UPDATE/DELETE grants or client write policies.

create or replace function public.default_company_configuration(
  p_tenant_id uuid,
  p_legal_name text,
  p_display_name text,
  p_timezone text
) returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version','1.0.0',
    'tenant_id',p_tenant_id,
    'company',jsonb_build_object(
      'legal_name',p_legal_name,'display_name',p_display_name,
      'business_type',null,'industry',null,'website',null,
      'address',jsonb_build_object('street',null,'suite',null,'city',null,'state',null,'postal_code',null,'country','US'),
      'timezone',p_timezone,'jurisdictions',jsonb_build_array()
    ),
    'contact',jsonb_build_object(
      'primary_email',null,'primary_phone',null,'hr_email',null,'hr_phone',null,
      'payroll_email',null,'payroll_phone',null,'emergency_phone',null,
      'communication_preferences',jsonb_build_object('email',true,'sms',false,'voice',false)
    ),
    'administrators',jsonb_build_array(),
    'managers',jsonb_build_array(),
    'employees',jsonb_build_array(),
    'permissions',jsonb_build_object('roles',jsonb_build_array(
      jsonb_build_object('name','owner','permissions',jsonb_build_array('*')),
      jsonb_build_object('name','administrator','permissions',jsonb_build_array('company.read','company.update','people.manage','policies.manage','payroll.manage')),
      jsonb_build_object('name','manager','permissions',jsonb_build_array('company.read','people.read','schedule.manage','time.approve')),
      jsonb_build_object('name','auditor','permissions',jsonb_build_array('company.read','audit.read'))
    ),'custom_permissions',jsonb_build_array(),'approval_hierarchy',jsonb_build_array()),
    'policies',jsonb_build_object(
      'employee_handbook',jsonb_build_object('version',null,'document_reference',null),
      'attendance',jsonb_build_object(),'scheduling',jsonb_build_object(),
      'overtime',jsonb_build_object(),'leave',jsonb_build_object(),
      'holidays',jsonb_build_object(),'breaks',jsonb_build_object(),
      'disciplinary',jsonb_build_object(),'termination',jsonb_build_object()
    ),
    'payroll',jsonb_build_object('frequency',null,'workweek_start',null,'currency','USD','provider_reference',null,'tax_configuration_reference',null),
    'integrations',jsonb_build_object('email',jsonb_build_object(),'sms',jsonb_build_object(),'voice',jsonb_build_object(),'accounting',jsonb_build_object(),'payroll',jsonb_build_object()),
    'agents',jsonb_build_object('hr_manager',jsonb_build_object(),'payroll_agent',jsonb_build_object(),'scheduling_agent',jsonb_build_object(),'employee_support_agent',jsonb_build_object()),
    'hrs',jsonb_build_object('enabled',false,'custody_mode','peopleos_custody','employee_wallet_access',false),
    'audit',jsonb_build_object('configuration_version',1)
  );
$$;

create or replace function public.seed_tenant_configuration()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.tenant_configurations(tenant_id, configuration)
  values (new.id, public.default_company_configuration(new.id,new.legal_name,new.display_name,new.timezone))
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;
revoke all on function public.seed_tenant_configuration() from public, anon, authenticated;
drop trigger if exists tenants_seed_company_configuration on public.tenants;
create trigger tenants_seed_company_configuration
  after insert on public.tenants
  for each row execute function public.seed_tenant_configuration();

-- Backfill tenants created before this migration.
insert into public.tenant_configurations(tenant_id,configuration)
select t.id, public.default_company_configuration(t.id,t.legal_name,t.display_name,t.timezone)
from public.tenants t
on conflict (tenant_id) do nothing;

-- Recursively reject credentials and regulated identifiers, including in nested
-- integration, policy, and agent configuration. Safe opaque references remain valid.
create or replace function public.company_configuration_has_forbidden_keys(p_value jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $function$
declare
  v_key text;
  v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value) loop
      if regexp_replace(lower(v_key), '[^a-z0-9]', '', 'g') ~
        '^(password|passwd|secret|clientsecret|apikey|apitoken|accesstoken|refreshtoken|authorization|privatekey|seedphrase|mnemonic|bankaccount(number)?|routing(number)?|taxid|ssn|socialsecurity(number)?)$'
      then
        return true;
      end if;
      if public.company_configuration_has_forbidden_keys(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value) loop
      if public.company_configuration_has_forbidden_keys(v_child) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$function$;
revoke all on function public.company_configuration_has_forbidden_keys(jsonb) from public, anon, authenticated;

create or replace function public.update_company_configuration(
  p_tenant_id uuid,
  p_configuration jsonb,
  p_expected_revision bigint
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_revision bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if not public.has_tenant_role(p_tenant_id,array['owner','administrator']) then
    raise exception 'Company administrator permission required' using errcode='42501';
  end if;
  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object'
     or pg_column_size(p_configuration) > 10485760
     or p_configuration->>'tenant_id' is distinct from p_tenant_id::text
     or p_configuration->>'schema_version' is distinct from '1.0.0'
     or coalesce(jsonb_typeof(p_configuration->'company'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'contact'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'administrators'),'') <> 'array'
     or coalesce(jsonb_typeof(p_configuration->'managers'),'') <> 'array'
     or coalesce(jsonb_typeof(p_configuration->'employees'),'') <> 'array'
     or coalesce(jsonb_typeof(p_configuration->'permissions'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'policies'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'payroll'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'integrations'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'agents'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'hrs'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration->'audit'),'') <> 'object'
     or coalesce(jsonb_typeof(p_configuration #> '{permissions,roles}'),'') <> 'array'
     or coalesce(jsonb_typeof(p_configuration #> '{permissions,custom_permissions}'),'') <> 'array'
     or coalesce(jsonb_typeof(p_configuration #> '{permissions,approval_hierarchy}'),'') <> 'array'
     or (p_configuration - array['schema_version','tenant_id','company','contact','administrators','managers','employees','permissions','policies','payroll','integrations','agents','hrs','audit']) <> '{}'::jsonb
     or length(coalesce(p_configuration #>> '{company,legal_name}','')) not between 2 and 200
     or length(coalesce(p_configuration #>> '{company,display_name}','')) not between 2 and 120
     or not exists (
       select 1 from pg_catalog.pg_timezone_names
       where name = p_configuration #>> '{company,timezone}'
     ) then
    raise exception 'Invalid company configuration envelope' using errcode='22023';
  end if;
  if coalesce(p_configuration #>> '{hrs,employee_wallet_access}','false') <> 'false' then
    raise exception 'Employee wallet access is prohibited' using errcode='22023';
  end if;

  update public.tenant_configurations
  set configuration=p_configuration,
      revision=revision+1,
      updated_by=auth.uid(),
      updated_at=now()
  where tenant_id=p_tenant_id and revision=p_expected_revision
  returning revision into v_revision;

  if v_revision is null then
    raise exception 'Configuration revision conflict; reload before saving' using errcode='40001';
  end if;

  update public.tenants
  set legal_name=p_configuration #>> '{company,legal_name}',
      display_name=p_configuration #>> '{company,display_name}',
      timezone=p_configuration #>> '{company,timezone}',
      updated_at=now()
  where id=p_tenant_id;

  insert into public.audit_events(
    tenant_id,actor_user_id,actor_type,event_type,subject_type,subject_id,source_channel,payload
  ) values (
    p_tenant_id,auth.uid(),'administrator','company.configuration.updated',
    'tenant_configuration',p_tenant_id,'web',
    jsonb_build_object('revision',v_revision,'schema_version',p_configuration->>'schema_version')
  );
  return v_revision;
end;
$$;
revoke all on function public.update_company_configuration(uuid,jsonb,bigint) from public,anon;
grant execute on function public.update_company_configuration(uuid,jsonb,bigint) to authenticated;

comment on table public.tenant_configurations is
  'Single versioned company configuration JSON document. Sensitive secrets and raw tax/bank identifiers must be stored in dedicated protected systems, never here.';
