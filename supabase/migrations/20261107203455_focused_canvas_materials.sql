-- Prefer the chosen owned file before keyword ranking. Old cross-course papers
-- cannot outrank the actual course file merely by repeating 'midterm'.
create function public.canvas_search_materials(p_course text,p_query text,p_file text)returns table(file_id text,chunk_index integer,title text,page integer,text text,extracted_at timestamptz,truncated boolean)language sql stable security invoker set search_path=''as $$
 select d.canvas_file_id,c.chunk_index,d.title,c.page,c.text,d.extracted_at,d.truncated
 from public.canvas_document_chunks c join public.canvas_documents d using(user_id,course_canvas_id,canvas_file_id)
 where d.user_id=auth.uid()and public.is_approved_user()and d.state='ready'and d.course_canvas_id=p_course and d.canvas_file_id=p_file
 order by ts_rank(c.search,websearch_to_tsquery('english',left(p_query,1000)))desc,c.chunk_index limit 4
$$;
revoke all on function public.canvas_search_materials(text,text,text)from public,anon;
grant execute on function public.canvas_search_materials(text,text,text)to authenticated;
