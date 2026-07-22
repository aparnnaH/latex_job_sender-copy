alter table resume_versions
    add column output_file_path varchar(2048),
    add column failure_message text,
    add column attempt_count integer not null default 0,
    add column processing_started_at timestamptz,
    add column processing_completed_at timestamptz,
    add column updated_at timestamptz;

update resume_versions set updated_at = created_at where updated_at is null;

alter table resume_versions
    alter column updated_at set not null;
