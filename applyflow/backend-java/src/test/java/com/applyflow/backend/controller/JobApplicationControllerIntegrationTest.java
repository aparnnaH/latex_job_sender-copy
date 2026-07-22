package com.applyflow.backend.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
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
                                "jobUrl", "https://example.com/job"
                        ))))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.status").value("SAVED"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        var created = objectMapper.readValue(createdJson, JobApplicationResponse.class);
        assertThat(created.id()).isNotNull();

        mockMvc.perform(get("/api/applications/{id}", created.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.company").value("Acme"));

        mockMvc.perform(put("/api/applications/{id}", created.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "company", "Acme Corp",
                                "jobTitle", "Senior Backend Engineer",
                                "jobDescription", "Own Java APIs",
                                "jobUrl", "https://example.com/senior"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.company").value("Acme Corp"));

        mockMvc.perform(patch("/api/applications/{id}/status", created.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("status", "INTERVIEW"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INTERVIEW"));

        mockMvc.perform(get("/api/applications"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));

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
}
