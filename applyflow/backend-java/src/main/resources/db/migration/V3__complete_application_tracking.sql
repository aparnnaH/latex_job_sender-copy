alter table job_applications
    add column location varchar(255),
    add column source varchar(255),
    add column date_found timestamptz,
    add column date_applied timestamptz,
    add column notes text,
    add column resume_used varchar(255);

update job_applications
set status = case status
    when 'ANALYZING' then 'PREPARING_RESUME'
    when 'RESUME_READY' then 'READY_TO_REVIEW'
    else status
end
where status in ('ANALYZING', 'RESUME_READY');

alter table resume_versions
    add column base_resume_name varchar(255),
    add column processing_status varchar(32),
    add column document_service_id varchar(255),
    add column error_code varchar(255),
    add column safe_error_message text;

update resume_versions
set base_resume_name = original_file_name
where base_resume_name is null;

update resume_versions
set processing_status = tailoring_status
where processing_status is null;

update resume_versions
set safe_error_message = failure_message
where safe_error_message is null and failure_message is not null;

alter table resume_versions
    alter column base_resume_name set not null,
    alter column processing_status set not null;
