package com.applyflow.backend.repository;

import com.applyflow.backend.entity.ResumeVersion;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ResumeVersionRepository extends JpaRepository<ResumeVersion, UUID> {
}
