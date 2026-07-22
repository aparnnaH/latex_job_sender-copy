package com.applyflow.backend;

import com.applyflow.backend.config.ApplyFlowProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(ApplyFlowProperties.class)
public class ApplyFlowBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(ApplyFlowBackendApplication.class, args);
    }
}
