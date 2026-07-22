package com.applyflow.backend.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMqConfig {

    @Bean
    DirectExchange tailoringExchange(ApplyFlowProperties properties) {
        return new DirectExchange(properties.rabbitmq().exchange(), true, false);
    }

    @Bean
    DirectExchange tailoringDeadLetterExchange(ApplyFlowProperties properties) {
        return new DirectExchange(properties.rabbitmq().deadLetterExchange(), true, false);
    }

    @Bean
    Queue tailoringQueue(ApplyFlowProperties properties) {
        return QueueBuilderHelper.durableQueue(
                properties.rabbitmq().queue(),
                properties.rabbitmq().deadLetterExchange());
    }

    @Bean
    Queue tailoringDeadLetterQueue(ApplyFlowProperties properties) {
        return new Queue(properties.rabbitmq().deadLetterQueue(), true);
    }

    @Bean
    Binding tailoringBinding(
            @Qualifier("tailoringQueue") Queue tailoringQueue,
            @Qualifier("tailoringExchange") DirectExchange tailoringExchange,
            ApplyFlowProperties properties) {
        return BindingBuilder.bind(tailoringQueue).to(tailoringExchange).with(properties.rabbitmq().routingKey());
    }

    @Bean
    Binding tailoringDeadLetterBinding(
            @Qualifier("tailoringDeadLetterQueue") Queue tailoringDeadLetterQueue,
            @Qualifier("tailoringDeadLetterExchange") DirectExchange tailoringDeadLetterExchange,
            ApplyFlowProperties properties) {
        return BindingBuilder.bind(tailoringDeadLetterQueue)
                .to(tailoringDeadLetterExchange)
                .with(properties.rabbitmq().routingKey());
    }

    @Bean
    MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory, MessageConverter messageConverter) {
        var rabbitTemplate = new RabbitTemplate(connectionFactory);
        rabbitTemplate.setMessageConverter(messageConverter);
        return rabbitTemplate;
    }

}
