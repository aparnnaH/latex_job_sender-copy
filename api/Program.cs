using System.Diagnostics;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<PythonTailoringOptions>(
    builder.Configuration.GetSection(PythonTailoringOptions.SectionName));

var app = builder.Build();

app.MapPost("/api/resumes/tailor", async (
    HttpRequest request,
    IConfiguration configuration,
    IWebHostEnvironment environment,
    CancellationToken cancellationToken) =>
{
    var options = configuration
        .GetSection(PythonTailoringOptions.SectionName)
        .Get<PythonTailoringOptions>() ?? new PythonTailoringOptions();

    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new ApiError("invalid_request", "Submit multipart/form-data with a .tex resume file and jobDescription text."));
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var resume = form.Files.GetFile("resume");
    var jobDescription = form["jobDescription"].ToString();

    if (resume is null)
    {
        return Results.BadRequest(new ApiError("missing_resume", "The resume file field is required."));
    }

    if (string.IsNullOrWhiteSpace(jobDescription))
    {
        return Results.BadRequest(new ApiError("missing_job_description", "The jobDescription field is required."));
    }

    if (!Path.GetExtension(resume.FileName).Equals(".tex", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new ApiError("invalid_file_type", "Only LaTeX .tex resume files are supported."));
    }

    if (resume.Length <= 0)
    {
        return Results.BadRequest(new ApiError("empty_file", "The uploaded resume file is empty."));
    }

    if (resume.Length > options.MaxUploadBytes)
    {
        return Results.BadRequest(new ApiError("file_too_large", $"The resume file must be {options.MaxUploadBytes} bytes or smaller."));
    }

    var scriptPath = ResolvePath(environment.ContentRootPath, options.ScriptPath);
    if (!File.Exists(scriptPath))
    {
        return Results.Problem(
            title: "Python tailoring script was not found.",
            detail: $"Configure {PythonTailoringOptions.SectionName}:ScriptPath to point at the existing Python entry point.",
            statusCode: StatusCodes.Status500InternalServerError,
            extensions: new Dictionary<string, object?> { ["scriptPath"] = scriptPath });
    }

    var workDir = Path.Combine(Path.GetTempPath(), "resume-tailoring-api", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(workDir);

    var inputPath = Path.Combine(workDir, "resume.tex");
    var outputPath = Path.Combine(workDir, "tailored-resume.tex");

    try
    {
        await using (var inputStream = File.Create(inputPath))
        {
            await resume.CopyToAsync(inputStream, cancellationToken);
        }

        PythonProcessResult result;
        try
        {
            result = await RunPythonTailoringAsync(
                options.PythonExecutable,
                scriptPath,
                inputPath,
                jobDescription,
                outputPath,
                cancellationToken);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return Results.Json(
                new ApiError("python_start_failed", $"Could not start the Python tailoring process: {ex.Message}"),
                statusCode: StatusCodes.Status500InternalServerError);
        }

        if (result.ExitCode != 0)
        {
            return Results.Json(
                new PythonProcessError("python_failed", "The Python tailoring process failed.", result.ExitCode, result.Stdout, result.Stderr),
                statusCode: StatusCodes.Status502BadGateway);
        }

        if (!File.Exists(outputPath))
        {
            return Results.Json(
                new PythonProcessError("missing_output", "The Python tailoring process completed but did not create an output file.", result.ExitCode, result.Stdout, result.Stderr),
                statusCode: StatusCodes.Status502BadGateway);
        }

        var outputBytes = await File.ReadAllBytesAsync(outputPath, cancellationToken);
        return Results.File(outputBytes, "application/x-tex", "tailored-resume.tex");
    }
    finally
    {
        if (Directory.Exists(workDir))
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
});

app.Run();

static string ResolvePath(string contentRootPath, string configuredPath)
{
    return Path.IsPathRooted(configuredPath)
        ? Path.GetFullPath(configuredPath)
        : Path.GetFullPath(Path.Combine(contentRootPath, configuredPath));
}

static async Task<PythonProcessResult> RunPythonTailoringAsync(
    string pythonExecutable,
    string scriptPath,
    string inputPath,
    string jobDescription,
    string outputPath,
    CancellationToken cancellationToken)
{
    var startInfo = new ProcessStartInfo
    {
        FileName = pythonExecutable,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false
    };

    startInfo.ArgumentList.Add(scriptPath);
    startInfo.ArgumentList.Add(inputPath);
    startInfo.ArgumentList.Add(jobDescription);
    startInfo.ArgumentList.Add(outputPath);

    using var process = new Process { StartInfo = startInfo };

    process.Start();

    var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
    var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);

    await process.WaitForExitAsync(cancellationToken);

    return new PythonProcessResult(
        process.ExitCode,
        await stdoutTask,
        await stderrTask);
}

sealed class PythonTailoringOptions
{
    public const string SectionName = "PythonTailoring";

    public string PythonExecutable { get; init; } = "python3";
    public string ScriptPath { get; init; } = "../tailor_resume.py";
    public long MaxUploadBytes { get; init; } = 1_048_576;
}

sealed record ApiError(string Code, string Message);

sealed record PythonProcessResult(int ExitCode, string Stdout, string Stderr);

sealed record PythonProcessError(
    string Code,
    string Message,
    int ExitCode,
    string Stdout,
    string Stderr);
