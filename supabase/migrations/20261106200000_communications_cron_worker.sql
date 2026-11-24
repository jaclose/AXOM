-- Install a fail-closed, environment-neutral AXOM communications worker schedule.
-- The scheduler never sends until BOTH secrets exist in Supabase Vault:
--   axom_communications_project_url = https://<project-ref>.supabase.co
--   axom_communications_cron_secret = exact AXOM_COMMUNICATIONS_CRON_SECRET
-- Secret values are NEVER embedded in this migration or in cron.job.command.
-- PostgreSQL cron calls the existing communications Edge Function; that function
-- independently enforces its authentication, consent, delivery mode and allowlist.
-- In PGlite and other non-Supabase environments without these extensions, skip.
do $axom_cron_setup$
declare
  worker_command text := $axom_worker$
    select net.http_post(
      url := rtrim(origin.decrypted_secret, '/') || '/functions/v1/communications?action=worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || credential.decrypted_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    )
    from vault.decrypted_secrets as origin
    cross join vault.decrypted_secrets as credential
    where origin.name = 'axom_communications_project_url'
      and credential.name = 'axom_communications_cron_secret'
      and origin.decrypted_secret ~ '^https://[a-z0-9-]+\.supabase\.co/?$'
      and length(credential.decrypted_secret) >= 32;
  $axom_worker$;
begin
  if not exists(select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists(select 1 from pg_available_extensions where name = 'pg_net')
     or not exists(select 1 from pg_available_extensions where name = 'supabase_vault') then
    raise notice 'AXOM communications schedule skipped: Supabase scheduling extensions unavailable';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute 'create extension if not exists pg_net';
  -- cron.schedule(jobname, schedule, command) creates or updates a named job.
  -- Its SQL performs no HTTP request when either Vault value is unavailable.
  execute format(
    'select cron.schedule(%L, %L, %L)',
    'axom-communications-worker-5m',
    '*/5 * * * *',
    worker_command
  );
end
$axom_cron_setup$;

-- Rollback of the scheduled invocation (keep extensions for unrelated owners):
-- select cron.unschedule('axom-communications-worker-5m');
