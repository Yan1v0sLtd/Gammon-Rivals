-- Hardening — pin search_path on the two mission helper functions the advisor
-- flagged (function_search_path_mutable). Both are plain (not SECURITY DEFINER)
-- and already fully-qualify their table references, so risk is low, but a mutable
-- search_path is still a lint/best-practice gap. ALTER (not CREATE OR REPLACE) so
-- the bodies are untouched.
alter function public.mp_render_mission_text(text, integer, text) set search_path = public, pg_temp;
alter function public.mp_cashback_reward(public.mission_templates, integer) set search_path = public, pg_temp;
