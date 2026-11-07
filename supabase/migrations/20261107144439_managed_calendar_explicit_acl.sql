-- Override hosted default table grants. Only the approved server may mutate reconciliation state.
revoke all on public.managed_calendar_state from public,anon,authenticated;
grant select on public.managed_calendar_state to authenticated;
grant all on public.managed_calendar_state to service_role;
