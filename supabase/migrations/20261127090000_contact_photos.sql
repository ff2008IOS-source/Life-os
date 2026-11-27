-- Profile pictures for people in Growth → Career. Stored as a small,
-- client-resized image (data URL) on the owner's contact row, so row-level
-- security keeps it in their account. Rollback: drop column photo.
alter table public.contacts
  add column photo text
    check (photo is null or (photo ~ '^data:image/(jpeg|png|webp);base64,' and length(photo) <= 200000));
