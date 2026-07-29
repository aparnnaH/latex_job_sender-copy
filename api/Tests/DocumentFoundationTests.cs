using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public sealed class DocumentFoundationTests
{
    [Fact]
    public async Task TailorValidationRejectsNonTexUpload()
    {
        var context = CreateMultipartContext("resume.pdf", "content", "Build software.");

        var result = await DocumentRequestValidator.ValidateTailorFormAsync(context.Request, CancellationToken.None);

        Assert.False(result.IsValid);
        Assert.Equal("VALIDATION_FAILED", result.Error?.Code);
        Assert.Contains(".tex", result.Error?.Message);
    }

    [Fact]
    public async Task TailorValidationRejectsEmptyJobDescription()
    {
        var context = CreateMultipartContext("resume.tex", "\\documentclass{article}", " ");

        var result = await DocumentRequestValidator.ValidateTailorFormAsync(context.Request, CancellationToken.None);

        Assert.False(result.IsValid);
        Assert.Equal("VALIDATION_FAILED", result.Error?.Code);
        Assert.Contains("Job description", result.Error?.Message);
    }

    [Fact]
    public async Task TailorValidationRejectsInvalidEvidenceJson()
    {
        var context = CreateMultipartContext("resume.tex", "\\documentclass{article}", "Build software.", "{not-json");

        var result = await DocumentRequestValidator.ValidateTailorFormAsync(context.Request, CancellationToken.None);

        Assert.False(result.IsValid);
        Assert.Equal("VALIDATION_FAILED", result.Error?.Code);
        Assert.Contains("valid JSON", result.Error?.Message);
    }

    [Fact]
    public async Task LocalStorageUsesGeneratedDocumentIdsAndSafePaths()
    {
        using var tempRoot = new TempDirectory();
        var storage = CreateStorage(tempRoot.Path);

        var document = await storage.CreateAsync("../resume.tex", "\\documentclass{article}", CancellationToken.None);
        var directory = storage.GetSafeDocumentDirectory(document.Id);

        Assert.Equal("resume.tex", document.OriginalFileName);
        Assert.StartsWith(tempRoot.Path, directory, StringComparison.Ordinal);
        Assert.DoesNotContain("..", System.IO.Path.GetRelativePath(tempRoot.Path, directory));
        Assert.True(Guid.TryParse(document.Id.ToString(), out _));
    }

    [Fact]
    public async Task HttpPythonClientMapsSuccessfulResponse()
    {
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent(
                """
                {
                  "report": { "status": "COMPLETED", "matchedKeywords": ["python"] },
                  "tailoredTex": "\\documentclass{article}"
                }
                """,
                Encoding.UTF8,
                "application/json")
        });
        var client = CreatePythonClient(handler);

        var result = await client.TailorAsync(
            new PythonTailoringRequest(Guid.NewGuid(), "\\documentclass{article}", "Python role", null),
            CancellationToken.None);

        Assert.Equal(DocumentStatus.COMPLETED, result.Status);
        Assert.Equal("\\documentclass{article}", result.TailoredTexContent);
        Assert.Null(result.Error);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task HttpPythonClientMapsValidationFailureWithoutRetry()
    {
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(System.Net.HttpStatusCode.BadRequest)
        {
            Content = new StringContent(
                """
                {
                  "error": {
                    "code": "INVALID_EVIDENCE_JSON",
                    "message": "Evidence JSON is not valid.",
                    "internalDetails": { "path": "/tmp/private" },
                    "retryable": false
                  }
                }
                """,
                Encoding.UTF8,
                "application/json")
        });
        var client = CreatePythonClient(handler);

        var result = await client.TailorAsync(
            new PythonTailoringRequest(Guid.NewGuid(), "\\documentclass{article}", "Python role", JsonSerializer.SerializeToElement(new { })),
            CancellationToken.None);

        Assert.Equal(DocumentStatus.FAILED, result.Status);
        Assert.Equal("VALIDATION_FAILED", result.Error?.Code);
        Assert.Equal("Evidence JSON is not valid.", result.Error?.Message);
        Assert.Null(result.Error?.InternalDetails);
        Assert.False(result.Error!.Retryable);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task HttpPythonClientRetriesTemporaryConnectionFailure()
    {
        var handler = new FakeHttpMessageHandler(call =>
        {
            if (call == 1)
            {
                throw new HttpRequestException("Connection failed.");
            }

            return new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """
                    {
                      "report": { "status": "COMPLETED" },
                      "tailoredTex": "\\documentclass{article}"
                    }
                    """,
                    Encoding.UTF8,
                    "application/json")
            };
        });
        var client = CreatePythonClient(handler, retryAttempts: 1);

        var result = await client.TailorAsync(
            new PythonTailoringRequest(Guid.NewGuid(), "\\documentclass{article}", "Python role", null),
            CancellationToken.None);

        Assert.Equal(DocumentStatus.COMPLETED, result.Status);
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task TectonicCompilerStoresSuccessfulPdf()
    {
        using var tempRoot = new TempDirectory();
        var storage = CreateStorage(tempRoot.Path);
        var document = await storage.CreateAsync("resume.tex", "\\documentclass{article}", CancellationToken.None);
        var runner = new FakeCompilerProcessRunner((_, _, workingDirectory, _, _) =>
        {
            var outDir = System.IO.Path.Combine(workingDirectory, "out");
            Directory.CreateDirectory(outDir);
            File.WriteAllBytes(System.IO.Path.Combine(outDir, "main.pdf"), Encoding.UTF8.GetBytes("%PDF mock"));
            return Task.FromResult(new CompilerProcessResult(0, "compiled", "", TimedOut: false));
        });
        var compiler = CreateCompiler(storage, runner);

        var result = await compiler.CompileAsync(document, CancellationToken.None);

        Assert.Equal(DocumentStatus.COMPLETED, result.Status);
        Assert.Equal($"documents/{document.Id:N}/compiled.pdf", result.CompiledPdfReference);
        Assert.Contains("compiled", result.CompilerLog);
        Assert.True(File.Exists(System.IO.Path.Combine(storage.GetSafeDocumentDirectory(document.Id), "compiled.pdf")));
        Assert.Equal(new[] { "--keep-logs", "--outdir", System.IO.Path.Combine(runner.WorkingDirectory!, "out"), "main.tex" }, runner.Arguments);
    }

    [Fact]
    public async Task TectonicCompilerReportsTimeout()
    {
        using var tempRoot = new TempDirectory();
        var storage = CreateStorage(tempRoot.Path);
        var document = await storage.CreateAsync("resume.tex", "\\documentclass{article}", CancellationToken.None);
        var runner = new FakeCompilerProcessRunner((_, _, _, _, _) =>
            Task.FromResult(new CompilerProcessResult(-1, "", "timeout", TimedOut: true)));
        var compiler = CreateCompiler(storage, runner);

        var result = await compiler.CompileAsync(document, CancellationToken.None);

        Assert.Equal(DocumentStatus.FAILED, result.Status);
        Assert.Equal("LATEX_COMPILE_FAILED", result.Error?.Code);
        Assert.True(result.Error!.Retryable);
        Assert.Contains("timed out", result.Error?.Message);
    }

    [Fact]
    public async Task TectonicCompilerReportsCompilerFailure()
    {
        using var tempRoot = new TempDirectory();
        var storage = CreateStorage(tempRoot.Path);
        var document = await storage.CreateAsync("resume.tex", "\\documentclass{article}", CancellationToken.None);
        var runner = new FakeCompilerProcessRunner((_, _, _, _, _) =>
            Task.FromResult(new CompilerProcessResult(1, "", "Undefined control sequence", TimedOut: false)));
        var compiler = CreateCompiler(storage, runner);

        var result = await compiler.CompileAsync(document, CancellationToken.None);

        Assert.Equal(DocumentStatus.FAILED, result.Status);
        Assert.Equal("LATEX_COMPILE_FAILED", result.Error?.Code);
        Assert.False(result.Error!.Retryable);
        Assert.Contains("Undefined control sequence", result.CompilerLog);
    }

    [Fact]
    public async Task TectonicCompilerReportsMissingSource()
    {
        using var tempRoot = new TempDirectory();
        var storage = CreateStorage(tempRoot.Path);
        var document = new StoredDocument(
            Guid.NewGuid(),
            DocumentStatus.PENDING,
            "resume.tex",
            "",
            null,
            null,
            null,
            null,
            null,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow);
        var runner = new FakeCompilerProcessRunner((_, _, _, _, _) =>
            Task.FromResult(new CompilerProcessResult(0, "", "", TimedOut: false)));
        var compiler = CreateCompiler(storage, runner);

        var result = await compiler.CompileAsync(document, CancellationToken.None);

        Assert.Equal(DocumentStatus.FAILED, result.Status);
        Assert.Equal("VALIDATION_FAILED", result.Error?.Code);
        Assert.Equal(0, runner.Calls);
    }

    private static DefaultHttpContext CreateMultipartContext(
        string fileName,
        string resumeContent,
        string jobDescription,
        string evidence = "")
    {
        var services = new ServiceCollection()
            .AddSingleton<IConfiguration>(
                new ConfigurationBuilder()
                    .AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["DocumentProcessing:MaxUploadBytes"] = "1048576"
                    })
                    .Build())
            .BuildServiceProvider();

        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.ContentType = "multipart/form-data";

        var bytes = Encoding.UTF8.GetBytes(resumeContent);
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "resume", fileName);
        context.Request.Form = new FormCollection(
            new Dictionary<string, Microsoft.Extensions.Primitives.StringValues>
            {
                ["jobDescription"] = jobDescription,
                ["evidence"] = evidence
            },
            new FormFileCollection { file });

        return context;
    }

    private static LocalFileDocumentStorage CreateStorage(string root)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DocumentProcessing:StorageRoot"] = root
            })
            .Build();

        return new LocalFileDocumentStorage(configuration);
    }

    private static HttpPythonTailoringClient CreatePythonClient(FakeHttpMessageHandler handler, int retryAttempts = 2)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PythonService:BaseUrl"] = "http://python-service.test",
                ["PythonService:RetryAttempts"] = retryAttempts.ToString()
            })
            .Build();
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://python-service.test") };
        return new HttpPythonTailoringClient(httpClient, configuration);
    }

    private static TectonicCompiler CreateCompiler(LocalFileDocumentStorage storage, ICompilerProcessRunner runner)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Tectonic:ExecutablePath"] = "tectonic",
                ["Tectonic:TimeoutSeconds"] = "5"
            })
            .Build();

        return new TectonicCompiler(configuration, runner, storage);
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"tailortex-api-tests-{Guid.NewGuid():N}");

        public TempDirectory()
        {
            Directory.CreateDirectory(Path);
        }

        public void Dispose()
        {
            if (Directory.Exists(Path))
            {
                Directory.Delete(Path, recursive: true);
            }
        }
    }

    private sealed class FakeHttpMessageHandler : HttpMessageHandler
    {
        private readonly Func<int, HttpResponseMessage> _handler;

        public int Calls { get; private set; }

        public FakeHttpMessageHandler(Func<int, HttpResponseMessage> handler)
        {
            _handler = handler;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls += 1;
            return Task.FromResult(_handler(Calls));
        }
    }

    private sealed class FakeCompilerProcessRunner : ICompilerProcessRunner
    {
        private readonly Func<string, IReadOnlyList<string>, string, TimeSpan, CancellationToken, Task<CompilerProcessResult>> _handler;

        public int Calls { get; private set; }
        public string? WorkingDirectory { get; private set; }
        public IReadOnlyList<string>? Arguments { get; private set; }

        public FakeCompilerProcessRunner(
            Func<string, IReadOnlyList<string>, string, TimeSpan, CancellationToken, Task<CompilerProcessResult>> handler)
        {
            _handler = handler;
        }

        public Task<CompilerProcessResult> RunAsync(
            string executablePath,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            Calls += 1;
            WorkingDirectory = workingDirectory;
            Arguments = arguments;
            return _handler(executablePath, arguments, workingDirectory, timeout, cancellationToken);
        }
    }
}
