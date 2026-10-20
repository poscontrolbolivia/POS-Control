insert into public.supers (user_id)
select id from auth.users where lower(email) = lower('admin@tucorreo.com')
on conflict (user_id) do nothing;

select u.email, s.creado_en
from public.supers s join auth.users u on u.id = s.user_id
where lower(u.email) = lower('admin@tucorreo.com');
