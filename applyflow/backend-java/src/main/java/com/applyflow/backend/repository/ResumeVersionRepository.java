package com.applyflow.backend.repository;

import com.applyflow.backend.entity.ResumeVersion;
import com.applyflow.backend.entity.TailoringStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ResumeVersionRepository extends JpaRepository<ResumeVersion, UUID> {

    long countByJobApplicationId(UUID jobApplicationId);

    List<ResumeVersion> findByJobApplicationIdOrderByVersionNumberDesc(UUID jobApplicationId);

    @Modifying
    @Query("""
            update ResumeVersion rv
            set rv.tailoringStatus = :nextStatus,
                rv.processingStatus = :nextStatus,
                rv.processingStartedAt = CURRENT_TIMESTAMP,
                rv.attemptCount = rv.attemptCount + 1,
                rv.failureMessage = null,
                rv.errorCode = null,
                rv.safeErrorMessage = null
            where rv.id = :id and rv.tailoringStatus = :expectedStatus
            """)
    int transitionStatus(
            @Param("id") UUID id,
            @Param("expectedStatus") TailoringStatus expectedStatus,
            @Param("nextStatus") TailoringStatus nextStatus);
}
