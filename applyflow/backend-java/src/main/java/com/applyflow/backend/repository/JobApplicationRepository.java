package com.applyflow.backend.repository;

import com.applyflow.backend.entity.JobApplication;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface JobApplicationRepository extends JpaRepository<JobApplication, UUID>, JpaSpecificationExecutor<JobApplication> {
    Optional<JobApplication> findByIdAndOwnerUserId(UUID id, String ownerUserId);

    boolean existsByIdAndOwnerUserId(UUID id, String ownerUserId);
}
