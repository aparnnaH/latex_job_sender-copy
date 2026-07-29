FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY applyflow/backend-java/pom.xml applyflow/backend-java/pom.xml
WORKDIR /workspace/applyflow/backend-java
RUN mvn -B -DskipTests dependency:go-offline
WORKDIR /workspace
COPY applyflow/backend-java applyflow/backend-java
WORKDIR /workspace/applyflow/backend-java
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /workspace/applyflow/backend-java/target/backend-java-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
