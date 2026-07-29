package com.applyflow.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "resume_versions")
@Getter
@Setter
@NoArgsConstructor
public class ResumeVersion {

    @Id
    private UUID id;

    @Column(nullable = false)
    private UUID jobApplicationId;

    @Column(nullable = false)
    private String originalFileName;

    private String baseResumeName;

    @Column(nullable = false, length = 2048)
    private String storedFilePath;

    @Column(length = 2048)
    private String outputFilePath;

    @Column(nullable = false)
    private Integer versionNumber;

    private String documentServiceId;

    private Integer matchScoreBefore;

    private Integer matchScoreAfter;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TailoringStatus tailoringStatus;

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private TailoringStatus processingStatus;

    @Column(nullable = false)
    private OffsetDateTime createdAt;

    @Column(nullable = false)
    private OffsetDateTime updatedAt;

    @Column(columnDefinition = "text")
    private String failureMessage;

    private String errorCode;

    @Column(columnDefinition = "text")
    private String safeErrorMessage;

    @Column(nullable = false)
    private Integer attemptCount = 0;

    private OffsetDateTime processingStartedAt;

    private OffsetDateTime processingCompletedAt;

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (tailoringStatus == null) {
            tailoringStatus = TailoringStatus.PENDING;
        }
        if (processingStatus == null) {
            processingStatus = tailoringStatus;
        }
        var now = OffsetDateTime.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = OffsetDateTime.now();
    }
}
