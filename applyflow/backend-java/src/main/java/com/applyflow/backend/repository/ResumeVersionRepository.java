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

    long countByJobApplicationIdAndOwnerUserId(UUID jobApplicationId, String ownerUserId);

    List<ResumeVersion> findByJobApplicationIdAndOwnerUserIdOrderByVersionNumberDesc(UUID jobApplicationId, String ownerUserId);

    java.util.Optional<ResumeVersion> findByIdAndOwnerUserId(UUID id, String ownerUserId);

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
            where rv.id = :id and rv.ownerUserId = :ownerUserId and rv.tailoringStatus = :expectedStatus
            """)
    int transitionStatus(
            @Param("id") UUID id,
            @Param("ownerUserId") String ownerUserId,
            @Param("expectedStatus") TailoringStatus expectedStatus,
            @Param("nextStatus") TailoringStatus nextStatus);
}
