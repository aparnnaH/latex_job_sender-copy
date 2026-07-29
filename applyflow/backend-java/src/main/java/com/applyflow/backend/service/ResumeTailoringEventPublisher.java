package com.applyflow.backend.service;

import com.applyflow.backend.config.ApplyFlowProperties;
import com.applyflow.backend.event.ResumeTailoringRequestedEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ResumeTailoringEventPublisher {

    private final RabbitTemplate rabbitTemplate;
    private final ApplyFlowProperties properties;

    public void publish(ResumeTailoringRequestedEvent event) {
        rabbitTemplate.convertAndSend(
                properties.rabbitmq().exchange(),
                properties.rabbitmq().routingKey(),
                event,
                message -> {
                    message.getMessageProperties().setCorrelationId(event.requestId().toString());
                    message.getMessageProperties().setHeader("requestId", event.requestId().toString());
                    message.getMessageProperties().setHeader("applicationId", event.jobApplicationId().toString());
                    message.getMessageProperties().setHeader("resumeVersionId", event.resumeVersionId().toString());
                    return message;
                });
    }
}
