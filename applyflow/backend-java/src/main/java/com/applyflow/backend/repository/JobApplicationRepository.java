package com.applyflow.backend.repository;

import com.applyflow.backend.entity.JobApplication;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface JobApplicationRepository extends JpaRepository<JobApplication, UUID> {
}
