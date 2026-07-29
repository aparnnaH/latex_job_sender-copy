using System.Text.Json;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<DocumentProcessingOptions>(
    builder.Configuration.GetSection(DocumentProcessingOptions.SectionName));
builder.Services.Configure<PythonServiceOptions>(
    builder.Configuration.GetSection(PythonServiceOptions.SectionName));
builder.Services.Configure<TectonicOptions>(
    builder.Configuration.GetSection(TectonicOptions.SectionName));
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});
builder.Services.AddSingleton<IDocumentStorage, LocalFileDocumentStorage>();
builder.Services.AddSingleton<ICurrentUserProvider, DevelopmentCurrentUserProvider>();
builder.Services.AddSingleton<ICompilerProcessRunner, SystemCompilerProcessRunner>();
builder.Services.AddSingleton<ITectonicCompiler, TectonicCompiler>();

var pythonServiceOptions = builder.Configuration
    .GetSection(PythonServiceOptions.SectionName)
    .Get<PythonServiceOptions>() ?? new PythonServiceOptions();
if (pythonServiceOptions.UseMock)
{
    builder.Services.AddSingleton<IPythonTailoringClient, PlaceholderPythonTailoringClient>();
}
else
{
    builder.Services.AddHttpClient<IPythonTailoringClient, HttpPythonTailoringClient>(client =>
        {
            client.BaseAddress = new Uri(pythonServiceOptions.BaseUrl);
            client.Timeout = TimeSpan.FromSeconds(pythonServiceOptions.RequestTimeoutSeconds);
        })
        .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
        {
            ConnectTimeout = TimeSpan.FromSeconds(pythonServiceOptions.ConnectTimeoutSeconds)
        });
}

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new HealthResponse("ok")));

app.MapGet("/openapi.json", () => Results.Json(OpenApiDocumentFactory.Create()));

app.MapPost("/api/documents/tailor", async (
    HttpRequest request,
    IDocumentStorage storage,
    ICurrentUserProvider currentUserProvider,
    IPythonTailoringClient pythonTailoringClient,
    CancellationToken cancellationToken) =>
{
    var validation = await DocumentRequestValidator.ValidateTailorFormAsync(request, cancellationToken);
    if (!validation.IsValid)
    {
        return ApiResults.Error(validation.Error!, validation.StatusCode);
    }

    var command = validation.Command!;
    var ownerUserId = currentUserProvider.CurrentUserId;
    var document = await storage.CreateAsync(ownerUserId, command.ResumeFileName, command.ResumeContent, cancellationToken);
    var result = await pythonTailoringClient.TailorAsync(
        new PythonTailoringRequest(document.Id, document.OriginalTexContent, command.JobDescription, command.Evidence),
        cancellationToken);

    var updated = document with
    {
        Status = result.Status,
        TailoredTexContent = result.TailoredTexContent,
        Report = result.Report,
        Error = result.Error,
        UpdatedAt = DateTimeOffset.UtcNow
    };
    await storage.SaveAsync(updated, cancellationToken);

    return Results.Json(DocumentResponses.FromDocument(updated));
});

app.MapPost("/api/documents/compile", async (
    CompileDocumentRequest request,
    IDocumentStorage storage,
    ICurrentUserProvider currentUserProvider,
    ITectonicCompiler compiler,
    CancellationToken cancellationToken) =>
{
    if (request.DocumentId == Guid.Empty)
    {
        return ApiResults.Error(Errors.ValidationFailed("documentId is required."), StatusCodes.Status400BadRequest);
    }

    var document = await storage.FindAsync(request.DocumentId, currentUserProvider.CurrentUserId, cancellationToken);
    if (document is null)
    {
        return ApiResults.Error(Errors.NotFound("Document was not found."), StatusCodes.Status404NotFound);
    }

    var result = await compiler.CompileAsync(document, cancellationToken);
    var updated = document with
    {
        Status = result.Status,
        CompiledPdfReference = result.CompiledPdfReference,
        CompilerLog = result.CompilerLog,
        Error = result.Error,
        UpdatedAt = DateTimeOffset.UtcNow
    };
    await storage.SaveAsync(updated, cancellationToken);

    return Results.Json(DocumentResponses.FromDocument(updated));
});

app.MapGet("/api/documents/{id}", async (
    string id,
    IDocumentStorage storage,
    ICurrentUserProvider currentUserProvider,
    CancellationToken cancellationToken) =>
{
    if (!Guid.TryParse(id, out var documentId))
    {
        return ApiResults.Error(Errors.ValidationFailed("Document id must be a UUID."), StatusCodes.Status400BadRequest);
    }

    var document = await storage.FindAsync(documentId, currentUserProvider.CurrentUserId, cancellationToken);
    if (document is null)
    {
        return ApiResults.Error(Errors.NotFound("Document was not found."), StatusCodes.Status404NotFound);
    }

    return Results.Json(DocumentResponses.FromDocument(document));
});

// Legacy endpoint retained for compatibility with the existing README.
app.MapPost("/api/resumes/tailor", async (
    HttpRequest request,
    IPythonTailoringClient pythonTailoringClient,
    CancellationToken cancellationToken) =>
{
    var validation = await DocumentRequestValidator.ValidateTailorFormAsync(request, cancellationToken);
    if (!validation.IsValid)
    {
        return ApiResults.Error(validation.Error!, validation.StatusCode);
    }

    var command = validation.Command!;
    var result = await pythonTailoringClient.TailorAsync(
        new PythonTailoringRequest(Guid.NewGuid(), command.ResumeContent, command.JobDescription, command.Evidence),
        cancellationToken);

    if (result.Status == DocumentStatus.FAILED)
    {
        return ApiResults.Error(result.Error ?? Errors.Internal("Tailoring failed."), StatusCodes.Status502BadGateway);
    }

    return Results.File(
        System.Text.Encoding.UTF8.GetBytes(result.TailoredTexContent),
        "application/x-tex",
        "tailored-resume.tex");
});

app.Run();

public partial class Program;

public enum DocumentStatus
{
    PENDING,
    PROCESSING,
    COMPLETED,
    FAILED
}

public sealed record HealthResponse(string Status);

public sealed record ContractError(
    string Code,
    string Message,
    object? InternalDetails,
    bool Retryable);

public sealed record ErrorEnvelope(ContractError Error);

public sealed record TailorDocumentCommand(
    string ResumeFileName,
    string ResumeContent,
    string JobDescription,
    JsonElement? Evidence);

public sealed record ValidationResult(
    bool IsValid,
    int StatusCode,
    ContractError? Error,
    TailorDocumentCommand? Command)
{
    public static ValidationResult Success(TailorDocumentCommand command) =>
        new(true, StatusCodes.Status200OK, null, command);

    public static ValidationResult Failure(ContractError error, int statusCode) =>
        new(false, statusCode, error, null);
}

public sealed record CompileDocumentRequest(Guid DocumentId);

public sealed record DocumentProcessingOptions
{
    public const string SectionName = "DocumentProcessing";

    public string StorageRoot { get; init; } = Path.Combine(Path.GetTempPath(), "tailortex-documents");
    public long MaxUploadBytes { get; init; } = 1_048_576;
    public string DevelopmentUserId { get; init; } = "development-user";
}

public sealed record PythonServiceOptions
{
    public const string SectionName = "PythonService";

    public bool UseMock { get; init; } = true;
    public string BaseUrl { get; init; } = "http://127.0.0.1:8000";
    public int ConnectTimeoutSeconds { get; init; } = 5;
    public int RequestTimeoutSeconds { get; init; } = 30;
    public int RetryAttempts { get; init; } = 2;
}

public sealed record TectonicOptions
{
    public const string SectionName = "Tectonic";

    public string ExecutablePath { get; init; } = "tectonic";
    public int TimeoutSeconds { get; init; } = 45;
}

public sealed record StoredDocument(
    Guid Id,
    string OwnerUserId,
    DocumentStatus Status,
    string OriginalFileName,
    string OriginalTexContent,
    string? TailoredTexContent,
    JsonElement? Report,
    string? CompiledPdfReference,
    string? CompilerLog,
    ContractError? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record DocumentResponse(
    Guid DocumentId,
    DocumentStatus Status,
    string OriginalFileName,
    string? TailoredTex,
    JsonElement? Report,
    string? CompiledPdfReference,
    string? CompilerLog,
    ContractError? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record PythonTailoringRequest(
    Guid DocumentId,
    string ResumeTexContent,
    string JobDescription,
    JsonElement? Evidence);

public sealed record PythonTailoringResult(
    DocumentStatus Status,
    string TailoredTexContent,
    JsonElement Report,
    ContractError? Error);

public sealed record CompileResult(
    DocumentStatus Status,
    string? CompiledPdfReference,
    string? CompilerLog,
    ContractError? Error);

public sealed record CompilerProcessResult(
    int ExitCode,
    string Stdout,
    string Stderr,
    bool TimedOut);

public interface IPythonTailoringClient
{
    Task<PythonTailoringResult> TailorAsync(PythonTailoringRequest request, CancellationToken cancellationToken);
}

public interface ITectonicCompiler
{
    Task<CompileResult> CompileAsync(StoredDocument document, CancellationToken cancellationToken);
}

public interface ICompilerProcessRunner
{
    Task<CompilerProcessResult> RunAsync(
        string executablePath,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        TimeSpan timeout,
        CancellationToken cancellationToken);
}

public interface IDocumentStorage
{
    Task<StoredDocument> CreateAsync(string ownerUserId, string originalFileName, string originalTexContent, CancellationToken cancellationToken);
    Task SaveAsync(StoredDocument document, CancellationToken cancellationToken);
    Task<StoredDocument?> FindAsync(Guid id, string ownerUserId, CancellationToken cancellationToken);
    Task<string> StoreCompiledPdfAsync(Guid id, string ownerUserId, byte[] pdfBytes, CancellationToken cancellationToken);
}

public interface ICurrentUserProvider
{
    string CurrentUserId { get; }
}

public sealed class DevelopmentCurrentUserProvider : ICurrentUserProvider
{
    public DevelopmentCurrentUserProvider(IConfiguration configuration)
    {
        CurrentUserId = configuration
            .GetSection(DocumentProcessingOptions.SectionName)
            .Get<DocumentProcessingOptions>()?
            .DevelopmentUserId ?? "development-user";
    }

    public string CurrentUserId { get; }
}

public sealed class PlaceholderPythonTailoringClient : IPythonTailoringClient
{
    public Task<PythonTailoringResult> TailorAsync(PythonTailoringRequest request, CancellationToken cancellationToken)
    {
        var report = JsonSerializer.SerializeToElement(new
        {
            status = DocumentStatus.COMPLETED.ToString(),
            matchScoreBefore = 0,
            matchScoreAfter = 0,
            matchedKeywords = Array.Empty<string>(),
            missingKeywords = Array.Empty<string>(),
            sectionsChanged = Array.Empty<string>(),
            suggestions = Array.Empty<object>(),
            warnings = new[] { "Placeholder tailoring client copied the resume unchanged. Python is not connected yet." },
            errors = Array.Empty<string>(),
            unsupportedClaimsRejected = Array.Empty<object>()
        });

        return Task.FromResult(new PythonTailoringResult(
            DocumentStatus.COMPLETED,
            request.ResumeTexContent,
            report,
            null));
    }
}

public sealed class HttpPythonTailoringClient : IPythonTailoringClient
{
    private readonly HttpClient _httpClient;
    private readonly PythonServiceOptions _options;

    public HttpPythonTailoringClient(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _options = configuration
            .GetSection(PythonServiceOptions.SectionName)
            .Get<PythonServiceOptions>() ?? new PythonServiceOptions();
    }

    public async Task<PythonTailoringResult> TailorAsync(PythonTailoringRequest request, CancellationToken cancellationToken)
    {
        var attempts = Math.Max(1, _options.RetryAttempts + 1);
        for (var attempt = 1; attempt <= attempts; attempt += 1)
        {
            try
            {
                using var httpRequest = BuildRequest(request);
                using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
                return await MapResponseAsync(response, cancellationToken);
            }
            catch (HttpRequestException) when (attempt < attempts)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(150 * attempt), cancellationToken);
            }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested && attempt < attempts)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(150 * attempt), cancellationToken);
            }
            catch (HttpRequestException)
            {
                return Failed("DOCUMENT_SERVICE_UNAVAILABLE", "The Python tailoring service is unavailable.", retryable: true);
            }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return Failed("PYTHON_PROCESS_TIMEOUT", "The Python tailoring service timed out.", retryable: true);
            }
        }

        return Failed("DOCUMENT_SERVICE_UNAVAILABLE", "The Python tailoring service is unavailable.", retryable: true);
    }

    private static HttpRequestMessage BuildRequest(PythonTailoringRequest request)
    {
        var content = new MultipartFormDataContent();
        content.Add(new StringContent(request.ResumeTexContent), "resume", "resume.tex");
        content.Add(new StringContent(request.JobDescription), "jobDescription");
        if (request.Evidence is not null)
        {
            content.Add(new StringContent(JsonSerializer.Serialize(request.Evidence.Value, JsonDefaults.Options)), "evidence");
        }

        return new HttpRequestMessage(HttpMethod.Post, "/api/tailor") { Content = content };
    }

    private static async Task<PythonTailoringResult> MapResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var content = await response.Content.ReadAsStringAsync(cancellationToken);
        JsonDocument? document = null;
        try
        {
            document = string.IsNullOrWhiteSpace(content) ? null : JsonDocument.Parse(content);
        }
        catch (JsonException)
        {
            return Failed("PYTHON_RESULT_INVALID", "The Python tailoring service returned invalid JSON.", retryable: false);
        }

        using (document)
        {
            if (!response.IsSuccessStatusCode)
            {
                return MapErrorResponse(response, document);
            }

            var root = document?.RootElement;
            if (root is null ||
                !root.Value.TryGetProperty("report", out var report) ||
                !root.Value.TryGetProperty("tailoredTex", out var tailoredTex) ||
                tailoredTex.ValueKind != JsonValueKind.String)
            {
                return Failed("PYTHON_RESULT_INVALID", "The Python tailoring service response was missing required fields.", retryable: false);
            }

            return new PythonTailoringResult(
                DocumentStatus.COMPLETED,
                tailoredTex.GetString() ?? "",
                report.Clone(),
                null);
        }
    }

    private static PythonTailoringResult MapErrorResponse(HttpResponseMessage response, JsonDocument? document)
    {
        var statusCode = (int)response.StatusCode;
        var retryable = statusCode >= 500;
        var code = statusCode >= 500 ? "DOCUMENT_SERVICE_UNAVAILABLE" : "VALIDATION_FAILED";
        var message = statusCode >= 500
            ? "The Python tailoring service failed."
            : "The Python tailoring request was rejected.";

        if (document?.RootElement.TryGetProperty("error", out var error) == true)
        {
            if (error.TryGetProperty("code", out var errorCode) && errorCode.ValueKind == JsonValueKind.String)
            {
                code = NormalizePythonErrorCode(errorCode.GetString(), code);
            }
            if (error.TryGetProperty("message", out var errorMessage) && errorMessage.ValueKind == JsonValueKind.String)
            {
                message = errorMessage.GetString() ?? message;
            }
            if (error.TryGetProperty("retryable", out var retryableElement) &&
                (retryableElement.ValueKind == JsonValueKind.True || retryableElement.ValueKind == JsonValueKind.False))
            {
                retryable = retryableElement.GetBoolean();
            }
        }

        return Failed(code, message, retryable);
    }

    private static string NormalizePythonErrorCode(string? pythonCode, string fallback) =>
        pythonCode switch
        {
            "INVALID_FILE_TYPE" or "EMPTY_RESUME" or "EMPTY_JOB_DESCRIPTION" or "INVALID_EVIDENCE_JSON" or "INVALID_MULTIPART" => "VALIDATION_FAILED",
            "FILE_TOO_LARGE" => "RESUME_UPLOAD_REJECTED",
            "INVALID_LATEX" => "PYTHON_RESULT_INVALID",
            "REQUEST_TOO_LARGE" => "RESUME_UPLOAD_REJECTED",
            null or "" => fallback,
            _ => pythonCode
        };

    private static PythonTailoringResult Failed(string code, string message, bool retryable)
    {
        var report = JsonSerializer.SerializeToElement(new
        {
            status = DocumentStatus.FAILED.ToString(),
            warnings = Array.Empty<string>(),
            errors = new[] { message }
        });

        return new PythonTailoringResult(
            DocumentStatus.FAILED,
            "",
            report,
            new ContractError(code, message, null, retryable));
    }
}

public sealed class TectonicCompiler : ITectonicCompiler
{
    private readonly TectonicOptions _options;
    private readonly ICompilerProcessRunner _processRunner;
    private readonly IDocumentStorage _storage;

    public TectonicCompiler(IConfiguration configuration, ICompilerProcessRunner processRunner, IDocumentStorage storage)
    {
        _options = configuration
            .GetSection(TectonicOptions.SectionName)
            .Get<TectonicOptions>() ?? new TectonicOptions();
        _processRunner = processRunner;
        _storage = storage;
    }

    public async Task<CompileResult> CompileAsync(StoredDocument document, CancellationToken cancellationToken)
    {
        var source = document.TailoredTexContent ?? document.OriginalTexContent;
        if (string.IsNullOrWhiteSpace(source))
        {
            return Failed("No LaTeX source is available to compile.", "VALIDATION_FAILED", retryable: false);
        }

        var workDirectory = Path.Combine(Path.GetTempPath(), "tailortex-compile", Guid.NewGuid().ToString("N"));
        var outputDirectory = Path.Combine(workDirectory, "out");
        try
        {
            Directory.CreateDirectory(outputDirectory);
            await File.WriteAllTextAsync(Path.Combine(workDirectory, "main.tex"), source, cancellationToken);

            var processResult = await _processRunner.RunAsync(
                _options.ExecutablePath,
                new[] { "--keep-logs", "--outdir", outputDirectory, "main.tex" },
                workDirectory,
                TimeSpan.FromSeconds(Math.Max(1, _options.TimeoutSeconds)),
                cancellationToken);

            var compilerLog = SanitizeCompilerLog($"{processResult.Stdout}\n{processResult.Stderr}");
            if (processResult.TimedOut)
            {
                return Failed("The LaTeX compiler timed out.", "LATEX_COMPILE_FAILED", compilerLog, retryable: true);
            }

            if (processResult.ExitCode != 0)
            {
                return Failed("The LaTeX compiler could not compile this document.", "LATEX_COMPILE_FAILED", compilerLog, retryable: false);
            }

            var pdfPath = Path.Combine(outputDirectory, "main.pdf");
            if (!File.Exists(pdfPath))
            {
                return Failed("The LaTeX compiler completed but did not produce a PDF.", "LATEX_COMPILE_FAILED", compilerLog, retryable: false);
            }

            var pdfReference = await _storage.StoreCompiledPdfAsync(
                document.Id,
                document.OwnerUserId,
                await File.ReadAllBytesAsync(pdfPath, cancellationToken),
                cancellationToken);

            return new CompileResult(DocumentStatus.COMPLETED, pdfReference, compilerLog, null);
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            return Failed("The LaTeX compiler could not be started.", "LATEX_COMPILE_FAILED", retryable: false);
        }
        finally
        {
            if (Directory.Exists(workDirectory))
            {
                Directory.Delete(workDirectory, recursive: true);
            }
        }
    }

    private static CompileResult Failed(string message, string code, string compilerLog = "", bool retryable = false) =>
        new(DocumentStatus.FAILED, null, compilerLog, new ContractError(code, message, null, retryable));

    private static string SanitizeCompilerLog(string log)
    {
        var normalized = log.Replace(Environment.UserName, "user", StringComparison.Ordinal);
        return normalized.Length <= 4000 ? normalized : normalized[^4000..];
    }
}

public sealed class SystemCompilerProcessRunner : ICompilerProcessRunner
{
    public async Task<CompilerProcessResult> RunAsync(
        string executablePath,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var startInfo = new System.Diagnostics.ProcessStartInfo
        {
            FileName = executablePath,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = new System.Diagnostics.Process { StartInfo = startInfo };
        process.Start();

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        try
        {
            await process.WaitForExitAsync(timeoutCts.Token);
            return new CompilerProcessResult(process.ExitCode, await stdoutTask, await stderrTask, TimedOut: false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch
            {
                // Process cleanup is best effort after timeout.
            }

            return new CompilerProcessResult(
                -1,
                await SafeReadAsync(stdoutTask),
                await SafeReadAsync(stderrTask),
                TimedOut: true);
        }
    }

    private static async Task<string> SafeReadAsync(Task<string> task)
    {
        try
        {
            return await task;
        }
        catch
        {
            return "";
        }
    }
}

public sealed class LocalFileDocumentStorage : IDocumentStorage
{
    private readonly string _root;

    public LocalFileDocumentStorage(IConfiguration configuration)
    {
        var options = configuration
            .GetSection(DocumentProcessingOptions.SectionName)
            .Get<DocumentProcessingOptions>() ?? new DocumentProcessingOptions();
        _root = Path.GetFullPath(options.StorageRoot);
        Directory.CreateDirectory(_root);
    }

    public async Task<StoredDocument> CreateAsync(string ownerUserId, string originalFileName, string originalTexContent, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var document = new StoredDocument(
            Guid.NewGuid(),
            ownerUserId,
            DocumentStatus.PENDING,
            Path.GetFileName(originalFileName),
            originalTexContent,
            null,
            null,
            null,
            null,
            null,
            now,
            now);
        await SaveAsync(document, cancellationToken);
        return document;
    }

    public async Task SaveAsync(StoredDocument document, CancellationToken cancellationToken)
    {
        var directory = GetSafeDocumentDirectory(document.Id);
        Directory.CreateDirectory(directory);

        var jsonPath = Path.Combine(directory, "document.json");
        var json = JsonSerializer.Serialize(document, JsonDefaults.Options);
        await File.WriteAllTextAsync(jsonPath, json, cancellationToken);

        await File.WriteAllTextAsync(Path.Combine(directory, "original.tex"), document.OriginalTexContent, cancellationToken);
        if (document.TailoredTexContent is not null)
        {
            await File.WriteAllTextAsync(Path.Combine(directory, "tailored.tex"), document.TailoredTexContent, cancellationToken);
        }
        if (document.Report is not null)
        {
            await File.WriteAllTextAsync(
                Path.Combine(directory, "report.json"),
                JsonSerializer.Serialize(document.Report, JsonDefaults.Options),
                cancellationToken);
        }
    }

    public async Task<StoredDocument?> FindAsync(Guid id, string ownerUserId, CancellationToken cancellationToken)
    {
        var jsonPath = Path.Combine(GetSafeDocumentDirectory(id), "document.json");
        if (!File.Exists(jsonPath))
        {
            return null;
        }

        var json = await File.ReadAllTextAsync(jsonPath, cancellationToken);
        var document = JsonSerializer.Deserialize<StoredDocument>(json, JsonDefaults.Options);
        return document?.OwnerUserId == ownerUserId ? document : null;
    }

    public async Task<string> StoreCompiledPdfAsync(Guid id, string ownerUserId, byte[] pdfBytes, CancellationToken cancellationToken)
    {
        var document = await FindAsync(id, ownerUserId, cancellationToken);
        if (document is null)
        {
            throw new InvalidOperationException("Document was not found for the current owner.");
        }
        var directory = GetSafeDocumentDirectory(id);
        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(Path.Combine(directory, "compiled.pdf"), pdfBytes, cancellationToken);
        return $"documents/{id:N}/compiled.pdf";
    }

    public string GetSafeDocumentDirectory(Guid id)
    {
        var directory = Path.GetFullPath(Path.Combine(_root, id.ToString("N")));
        if (!directory.StartsWith(_root, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Document path escaped the storage root.");
        }
        return directory;
    }
}

public static class DocumentRequestValidator
{
    public static async Task<ValidationResult> ValidateTailorFormAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var options = request.HttpContext.RequestServices
            .GetRequiredService<IConfiguration>()
            .GetSection(DocumentProcessingOptions.SectionName)
            .Get<DocumentProcessingOptions>() ?? new DocumentProcessingOptions();

        if (!request.HasFormContentType)
        {
            return ValidationResult.Failure(Errors.ValidationFailed("Submit multipart/form-data."), StatusCodes.Status400BadRequest);
        }

        var form = await request.ReadFormAsync(cancellationToken);
        var resume = form.Files.GetFile("resume");
        var jobDescription = form["jobDescription"].ToString();
        var evidence = form["evidence"].ToString();

        if (resume is null)
        {
            return ValidationResult.Failure(Errors.ValidationFailed("The resume file field is required."), StatusCodes.Status400BadRequest);
        }

        if (!Path.GetExtension(resume.FileName).Equals(".tex", StringComparison.OrdinalIgnoreCase))
        {
            return ValidationResult.Failure(Errors.ValidationFailed("Only .tex resume uploads are supported."), StatusCodes.Status400BadRequest);
        }

        if (resume.Length <= 0)
        {
            return ValidationResult.Failure(Errors.ValidationFailed("Uploaded resume is empty."), StatusCodes.Status400BadRequest);
        }

        if (resume.Length > options.MaxUploadBytes)
        {
            return ValidationResult.Failure(
                new ContractError("RESUME_UPLOAD_REJECTED", "Uploaded resume exceeds the configured size limit.", null, false),
                StatusCodes.Status413PayloadTooLarge);
        }

        if (string.IsNullOrWhiteSpace(jobDescription))
        {
            return ValidationResult.Failure(Errors.ValidationFailed("Job description is required."), StatusCodes.Status400BadRequest);
        }

        JsonElement? evidenceJson = null;
        if (!string.IsNullOrWhiteSpace(evidence))
        {
            try
            {
                evidenceJson = JsonSerializer.Deserialize<JsonElement>(evidence);
                if (evidenceJson.Value.ValueKind != JsonValueKind.Object)
                {
                    return ValidationResult.Failure(Errors.ValidationFailed("Evidence must be a JSON object."), StatusCodes.Status400BadRequest);
                }
            }
            catch (JsonException exception)
            {
                return ValidationResult.Failure(
                    new ContractError("VALIDATION_FAILED", "Evidence must be valid JSON.", new { exception.Message }, false),
                    StatusCodes.Status400BadRequest);
            }
        }

        await using var stream = resume.OpenReadStream();
        using var reader = new StreamReader(stream);
        var resumeContent = await reader.ReadToEndAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(resumeContent))
        {
            return ValidationResult.Failure(Errors.ValidationFailed("Uploaded resume is empty."), StatusCodes.Status400BadRequest);
        }

        return ValidationResult.Success(new TailorDocumentCommand(
            Path.GetFileName(resume.FileName),
            resumeContent,
            jobDescription,
            evidenceJson));
    }
}

public static class DocumentResponses
{
    public static DocumentResponse FromDocument(StoredDocument document) =>
        new(
            document.Id,
            document.Status,
            document.OriginalFileName,
            document.TailoredTexContent,
            document.Report,
            document.CompiledPdfReference,
            document.CompilerLog,
            document.Error,
            document.CreatedAt,
            document.UpdatedAt);
}

public static class Errors
{
    public static ContractError ValidationFailed(string message) =>
        new("VALIDATION_FAILED", message, null, false);

    public static ContractError NotFound(string message) =>
        new("ARTIFACT_NOT_FOUND", message, null, false);

    public static ContractError Internal(string message) =>
        new("INTERNAL_ERROR", message, null, true);
}

public static class ApiResults
{
    public static IResult Error(ContractError error, int statusCode) =>
        Results.Json(new ErrorEnvelope(error), statusCode: statusCode);
}

public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        WriteIndented = true
    };
}

public static class OpenApiDocumentFactory
{
    public static object Create() => new
    {
        openapi = "3.0.1",
        info = new { title = "TailorTeX Document Processing API", version = "v1" },
        paths = new Dictionary<string, object>
        {
            ["/health"] = new { get = new { summary = "Health check" } },
            ["/api/documents/tailor"] = new { post = new { summary = "Create and tailor a document" } },
            ["/api/documents/compile"] = new { post = new { summary = "Compile a stored document" } },
            ["/api/documents/{id}"] = new { get = new { summary = "Get document processing status" } }
        }
    };
}
