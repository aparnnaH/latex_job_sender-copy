package com.applyflow.backend.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.applyflow.backend.dto.JobApplicationResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
@AutoConfigureMockMvc
@Testcontainers
class JobApplicationControllerIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void configurePostgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void applicationLifecycleEndpointsWork() throws Exception {
        var createdJson = mockMvc.perform(post("/api/applications")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "company", "Acme",
                                "jobTitle", "Backend Engineer",
                                "jobDescription", "Build Java and Spring Boot services",
                                "jobUrl", "https://example.com/job",
                                "location", "Toronto, ON",
                                "source", "LinkedIn",
                                "dateFound", "2026-07-28T09:30:00Z",
                                "notes", "Track closely",
                                "resumeUsed", "backend-resume.tex"
                        ))))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.status").value("SAVED"))
                .andExpect(jsonPath("$.location").value("Toronto, ON"))
                .andExpect(jsonPath("$.source").value("LinkedIn"))
                .andExpect(jsonPath("$.dateFound").value("2026-07-28T09:30:00Z"))
                .andExpect(jsonPath("$.notes").value("Track closely"))
                .andExpect(jsonPath("$.resumeUsed").value("backend-resume.tex"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        var created = objectMapper.readValue(createdJson, JobApplicationResponse.class);
        assertThat(created.id()).isNotNull();

        mockMvc.perform(get("/api/applications/{id}", created.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.company").value("Acme"));

        mockMvc.perform(patch("/api/applications/{id}", created.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "jobTitle", "Senior Backend Engineer",
                                "location", "Remote",
                                "source", "Referral",
                                "dateApplied", "2026-07-29T14:00:00Z",
                                "notes", "Updated notes",
                                "resumeUsed", "senior-backend-resume.tex"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.company").value("Acme"))
                .andExpect(jsonPath("$.jobTitle").value("Senior Backend Engineer"))
                .andExpect(jsonPath("$.dateApplied").value("2026-07-29T14:00:00Z"));

        mockMvc.perform(put("/api/applications/{id}", created.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "company", "Acme Corp",
                                "jobTitle", "Senior Backend Engineer",
                                "jobDescription", "Own Java APIs",
                                "jobUrl", "https://example.com/senior",
                                "location", "Remote",
                                "source", "Referral",
                                "dateFound", "2026-07-27T09:30:00Z",
                                "dateApplied", "2026-07-29T14:00:00Z",
                                "notes", "Updated notes",
                                "resumeUsed", "senior-backend-resume.tex"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.company").value("Acme Corp"));

        mockMvc.perform(patch("/api/applications/{id}/status", created.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("status", "INTERVIEW"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INTERVIEW"));

        mockMvc.perform(get("/api/applications")
                        .param("status", "INTERVIEW")
                        .param("company", "acme")
                        .param("source", "Referral")
                        .param("dateFrom", "2026-07-01T00:00:00Z")
                        .param("dateTo", "2026-07-30T00:00:00Z")
                        .param("page", "0")
                        .param("size", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.totalElements").value(1));

        mockMvc.perform(delete("/api/applications/{id}", created.id()))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/applications/{id}", created.id()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").exists());
    }

    @Test
    void validationErrorsReturnJsonDetails() throws Exception {
        mockMvc.perform(post("/api/applications")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "company", "",
                                "jobTitle", "",
                                "jobDescription", ""
                        ))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Request validation failed."))
                .andExpect(jsonPath("$.details.company").exists())
                .andExpect(jsonPath("$.details.jobTitle").exists())
                .andExpect(jsonPath("$.details.jobDescription").exists());
    }

    @Test
    void invalidResumeUploadReturnsBadRequest() throws Exception {
        var createdJson = mockMvc.perform(post("/api/applications")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "company", "Globex",
                                "jobTitle", "Java Engineer",
                                "jobDescription", "Build event-driven services",
                                "jobUrl", "https://example.com/java",
                                "source", "Indeed"
                        ))))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        var created = objectMapper.readValue(createdJson, JobApplicationResponse.class);

        var file = new MockMultipartFile("resume", "resume.txt", "text/plain", "not latex".getBytes());

        mockMvc.perform(multipart("/api/applications/{id}/tailor", created.id()).file(file))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Only LaTeX .tex resume files are supported."));
    }

    @Test
    void resumeVersionsEndpointReturnsEmptyListForApplication() throws Exception {
        var createdJson = mockMvc.perform(post("/api/applications")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "company", "Initech",
                                "jobTitle", "Platform Engineer",
                                "jobDescription", "Build platform services"
                        ))))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        var created = objectMapper.readValue(createdJson, JobApplicationResponse.class);

        mockMvc.perform(get("/api/applications/{id}/resume-versions", created.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(0));
    }
}
