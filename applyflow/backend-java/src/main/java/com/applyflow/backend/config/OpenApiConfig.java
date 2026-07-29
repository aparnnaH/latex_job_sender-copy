package com.applyflow.backend.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI applyFlowOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("ApplyFlow Java Backend API")
                        .version("v1")
                        .description("REST API for job applications, resume versions, and application tracking status."));
    }
}
