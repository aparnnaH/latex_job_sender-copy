package com.applyflow.backend.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class DevelopmentCurrentUserProvider implements CurrentUserProvider {

    private final String developmentUserId;

    public DevelopmentCurrentUserProvider(
            @Value("${applyflow.auth.development-user-id:development-user}") String developmentUserId) {
        this.developmentUserId = developmentUserId;
    }

    @Override
    public String currentUserId() {
        return developmentUserId;
    }
}
