alter table job_applications
    add column owner_user_id varchar(255) not null default 'development-user';

alter table resume_versions
    add column owner_user_id varchar(255) not null default 'development-user';

create index idx_job_applications_owner_user_id on job_applications(owner_user_id);
create index idx_job_applications_owner_id on job_applications(owner_user_id, id);
create index idx_resume_versions_owner_job_application_id on resume_versions(owner_user_id, job_application_id);
create index idx_resume_versions_owner_id on resume_versions(owner_user_id, id);
