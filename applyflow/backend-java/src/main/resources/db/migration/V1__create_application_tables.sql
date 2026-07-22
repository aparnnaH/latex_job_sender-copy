create table job_applications (
    id uuid primary key,
    company varchar(255) not null,
    job_title varchar(255) not null,
    job_description text not null,
    job_url varchar(2048),
    status varchar(32) not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create table resume_versions (
    id uuid primary key,
    job_application_id uuid not null references job_applications(id) on delete cascade,
    original_file_name varchar(255) not null,
    stored_file_path varchar(2048) not null,
    version_number integer not null,
    tailoring_status varchar(32) not null,
    created_at timestamptz not null
);

create index idx_resume_versions_job_application_id on resume_versions(job_application_id);
