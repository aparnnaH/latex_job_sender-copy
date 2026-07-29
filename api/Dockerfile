FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY api/ResumeTailoring.Api.csproj api/
RUN dotnet restore api/ResumeTailoring.Api.csproj
COPY api api
RUN dotnet publish api/ResumeTailoring.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "ResumeTailoring.Api.dll"]
