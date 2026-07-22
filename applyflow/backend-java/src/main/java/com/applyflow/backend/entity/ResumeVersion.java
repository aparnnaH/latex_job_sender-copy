package com.applyflow.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
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

    @Column(nullable = false, length = 2048)
    private String storedFilePath;

    @Column(nullable = false)
    private Integer versionNumber;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TailoringStatus tailoringStatus;

    @Column(nullable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (tailoringStatus == null) {
            tailoringStatus = TailoringStatus.PENDING;
        }
        createdAt = OffsetDateTime.now();
    }
}
