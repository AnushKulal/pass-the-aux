create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer set search_path = public, extensions
as $fn$
declare base text; candidate text;
begin
  base := lower(regexp_replace(split_part(new.email,'@',1),'[^a-z0-9_]','','g'));
  if length(base) < 3 then base := 'user'; end if;
  base := left(base,14);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    candidate := base || '_' || substr(encode(gen_random_bytes(3),'hex'),1,5);
  end loop;
  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, candidate,
          coalesce(new.raw_user_meta_data->>'full_name', candidate),
          new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$fn$;

create or replace function public.new_invite_code()
returns text language sql volatile
security definer set search_path = public, extensions
as $fn$ select upper(substr(encode(gen_random_bytes(6),'hex'),1,8)); $fn$;

alter table public.lounges alter column invite_code set default public.new_invite_code();

select public.new_invite_code() as proof_it_works;
