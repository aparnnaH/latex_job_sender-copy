alter table resume_versions
    add column match_score_before integer,
    add column match_score_after integer,
    add column report_json text;
