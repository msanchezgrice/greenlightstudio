create table if not exists public.project_chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_clerk_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);

create index if not exists idx_project_chat_messages_project_created
  on public.project_chat_messages(project_id, created_at desc);

alter table public.project_chat_messages enable row level security;

drop policy if exists project_chat_messages_select_own on public.project_chat_messages;
create policy project_chat_messages_select_own on public.project_chat_messages
  for select using (owner_clerk_id = auth.jwt() ->> 'sub');

drop policy if exists project_chat_messages_insert_own on public.project_chat_messages;
create policy project_chat_messages_insert_own on public.project_chat_messages
  for insert with check (
    owner_clerk_id = auth.jwt() ->> 'sub'
    and exists (
      select 1
      from public.projects p
      where p.id = project_id
      and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );
