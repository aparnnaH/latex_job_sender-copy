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
@Table(name = "job_applications")
@Getter
@Setter
@NoArgsConstructor
public class JobApplication {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String ownerUserId;

    @Column(nullable = false)
    private String company;

    @Column(nullable = false)
    private String jobTitle;

    @Column(nullable = false, columnDefinition = "text")
    private String jobDescription;

    @Column(length = 2048)
    private String jobUrl;

    private String location;

    private String source;

    private OffsetDateTime dateFound;

    private OffsetDateTime dateApplied;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private JobApplicationStatus status;

    @Column(columnDefinition = "text")
    private String notes;

    private String resumeUsed;

    @Column(nullable = false)
    private OffsetDateTime createdAt;

    @Column(nullable = false)
    private OffsetDateTime updatedAt;

    @PrePersist
    void onCreate() {
        var now = OffsetDateTime.now();
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (status == null) {
            status = JobApplicationStatus.SAVED;
        }
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = OffsetDateTime.now();
    }
}
