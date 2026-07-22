package com.applyflow.backend.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;

final class QueueBuilderHelper {

    private QueueBuilderHelper() {
    }

    static Queue durableQueue(String queueName, String deadLetterExchange) {
        return QueueBuilder.durable(queueName)
                .deadLetterExchange(deadLetterExchange)
                .build();
    }
}
