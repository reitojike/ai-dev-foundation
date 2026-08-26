create table public."Users" (id int primary key);
grant select on public."Users" to authenticated;
grant trigger on public."Users" to authenticated;
