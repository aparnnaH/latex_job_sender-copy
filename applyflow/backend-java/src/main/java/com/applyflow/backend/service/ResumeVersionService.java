package com.applyflow.backend.service;

import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.entity.ResumeVersion;
import com.applyflow.backend.entity.TailoringStatus;
import com.applyflow.backend.event.ResumeTailoringRequestedEvent;
import com.applyflow.backend.exception.InvalidRequestException;
import com.applyflow.backend.exception.ResourceNotFoundException;
import com.applyflow.backend.repository.JobApplicationRepository;
import com.applyflow.backend.repository.ResumeVersionRepository;
import java.nio.file.Path;
import java.nio.file.Files;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
public class ResumeVersionService {

    private final JobApplicationRepository jobApplicationRepository;
    private final ResumeVersionRepository resumeVersionRepository;
    private final ResumeFileStorageService storageService;
    private final ResumeTailoringEventPublisher eventPublisher;
    private final ResumeVersionMapper mapper;

    public ResumeVersionResponse requestTailoring(UUID jobApplicationId, MultipartFile file) {
        var jobApplication = jobApplicationRepository.findById(jobApplicationId)
                .orElseThrow(() -> new ResourceNotFoundException("Job application not found: " + jobApplicationId));

        var resumeVersionId = UUID.randomUUID();
        var storedFiles = storageService.storeInput(jobApplicationId, resumeVersionId, file);

        var version = new ResumeVersion();
        version.setId(resumeVersionId);
        version.setJobApplicationId(jobApplicationId);
        version.setOriginalFileName(file.getOriginalFilename());
        version.setBaseResumeName(file.getOriginalFilename());
        version.setStoredFilePath(storedFiles.inputPath().toString());
        version.setOutputFilePath(storedFiles.outputPath().toString());
        version.setVersionNumber((int) resumeVersionRepository.countByJobApplicationId(jobApplicationId) + 1);
        version.setTailoringStatus(TailoringStatus.PENDING);
        version.setProcessingStatus(TailoringStatus.PENDING);

        var saved = resumeVersionRepository.save(version);
        eventPublisher.publish(new ResumeTailoringRequestedEvent(
                jobApplicationId,
                saved.getId(),
                saved.getStoredFilePath(),
                jobApplication.getJobDescription(),
                saved.getOutputFilePath()));

        return mapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public ResumeVersionResponse findById(UUID id) {
        return mapper.toResponse(findEntity(id));
    }

    @Transactional(readOnly = true)
    public java.util.List<ResumeVersionResponse> findByJobApplicationId(UUID jobApplicationId) {
        if (!jobApplicationRepository.existsById(jobApplicationId)) {
            throw new ResourceNotFoundException("Job application not found: " + jobApplicationId);
        }
        return resumeVersionRepository.findByJobApplicationIdOrderByVersionNumberDesc(jobApplicationId).stream()
                .map(mapper::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public Resource download(UUID id) {
        var version = findEntity(id);
        if (version.getTailoringStatus() != TailoringStatus.COMPLETED || version.getOutputFilePath() == null) {
            throw new InvalidRequestException("Resume version is not ready for download.");
        }
        var resource = new FileSystemResource(Path.of(version.getOutputFilePath()));
        if (!resource.exists() || !resource.isReadable()) {
            throw new ResourceNotFoundException("Generated resume file was not found.");
        }
        return resource;
    }

    @Transactional(readOnly = true)
    public Resource downloadPdf(UUID id) {
        var version = findEntity(id);
        if (version.getTailoringStatus() != TailoringStatus.COMPLETED || version.getDocumentServiceId() == null) {
            throw new InvalidRequestException("Resume PDF is not available for this version.");
        }
        throw new ResourceNotFoundException("Generated PDF download is not available yet.");
    }

    @Transactional
    public ResumeVersionResponse retry(UUID id) {
        var source = findEntity(id);
        if (source.getTailoringStatus() != TailoringStatus.FAILED) {
            throw new InvalidRequestException("Only failed resume versions can be retried.");
        }
        var jobApplication = jobApplicationRepository.findById(source.getJobApplicationId())
                .orElseThrow(() -> new ResourceNotFoundException("Job application not found: " + source.getJobApplicationId()));
        if (source.getStoredFilePath() == null || !Files.isReadable(Path.of(source.getStoredFilePath()))) {
            throw new ResourceNotFoundException("The original resume source is not available for retry.");
        }

        var retryVersionId = UUID.randomUUID();
        var directory = propertiesResumesDir(source.getJobApplicationId(), retryVersionId);
        var inputPath = directory.resolve("input.tex");
        var outputPath = directory.resolve("tailored.tex");

        try {
            Files.createDirectories(directory);
            Files.copy(Path.of(source.getStoredFilePath()), inputPath);
        } catch (IOException exception) {
            throw new InvalidRequestException("Could not prepare the retry job.");
        }

        var version = new ResumeVersion();
        version.setId(retryVersionId);
        version.setJobApplicationId(source.getJobApplicationId());
        version.setOriginalFileName(source.getOriginalFileName());
        version.setBaseResumeName(source.getBaseResumeName());
        version.setStoredFilePath(inputPath.toString());
        version.setOutputFilePath(outputPath.toString());
        version.setVersionNumber((int) resumeVersionRepository.countByJobApplicationId(source.getJobApplicationId()) + 1);
        version.setTailoringStatus(TailoringStatus.PENDING);
        version.setProcessingStatus(TailoringStatus.PENDING);
        version.setMatchScoreBefore(source.getMatchScoreBefore());

        var saved = resumeVersionRepository.save(version);
        eventPublisher.publish(new ResumeTailoringRequestedEvent(
                source.getJobApplicationId(),
                saved.getId(),
                saved.getStoredFilePath(),
                jobApplication.getJobDescription(),
                saved.getOutputFilePath()));
        return mapper.toResponse(saved);
    }

    @Transactional
    public boolean markProcessing(UUID id) {
        return resumeVersionRepository.transitionStatus(id, TailoringStatus.PENDING, TailoringStatus.PROCESSING) == 1;
    }

    @Transactional
    public Optional<Integer> beginProcessing(UUID id) {
        if (!markProcessing(id)) {
            return Optional.empty();
        }
        return resumeVersionRepository.findById(id).map(ResumeVersion::getAttemptCount);
    }

    @Transactional
    public void markPendingForRetry(UUID id, String errorCode, String safeErrorMessage) {
        var version = findEntity(id);
        version.setTailoringStatus(TailoringStatus.PENDING);
        version.setProcessingStatus(TailoringStatus.PENDING);
        version.setFailureMessage(safeErrorMessage);
        version.setErrorCode(errorCode);
        version.setSafeErrorMessage(safeErrorMessage);
        resumeVersionRepository.save(version);
    }

    @Transactional
    public void markCompleted(UUID id, String outputPath) {
        markCompleted(id, outputPath, null);
    }

    @Transactional
    public void markCompleted(UUID id, String outputPath, String documentServiceId) {
        var version = findEntity(id);
        version.setTailoringStatus(TailoringStatus.COMPLETED);
        version.setProcessingStatus(TailoringStatus.COMPLETED);
        version.setOutputFilePath(outputPath);
        version.setDocumentServiceId(documentServiceId);
        version.setProcessingCompletedAt(OffsetDateTime.now());
        version.setFailureMessage(null);
        version.setErrorCode(null);
        version.setSafeErrorMessage(null);
        resumeVersionRepository.save(version);
    }

    @Transactional
    public void markFailed(UUID id, String message) {
        markFailed(id, null, message);
    }

    @Transactional
    public void markFailed(UUID id, String errorCode, String safeErrorMessage) {
        var version = findEntity(id);
        version.setTailoringStatus(TailoringStatus.FAILED);
        version.setProcessingStatus(TailoringStatus.FAILED);
        version.setFailureMessage(safeErrorMessage);
        version.setErrorCode(errorCode);
        version.setSafeErrorMessage(safeErrorMessage);
        version.setProcessingCompletedAt(OffsetDateTime.now());
        resumeVersionRepository.save(version);
    }

    private ResumeVersion findEntity(UUID id) {
        return resumeVersionRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Resume version not found: " + id));
    }

    private Path propertiesResumesDir(UUID jobApplicationId, UUID resumeVersionId) {
        return storageService.resumeVersionDirectory(jobApplicationId, resumeVersionId);
    }
}
