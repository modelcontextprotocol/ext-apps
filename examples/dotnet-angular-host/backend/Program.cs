using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

var hostPort = builder.Configuration.GetValue("HostPort", 8080);
var sandboxPort = builder.Configuration.GetValue("SandboxPort", 8081);

// Kestrel: listen on two ports for separate origins (security requirement)
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenLocalhost(hostPort);
    options.ListenLocalhost(sandboxPort);
});

builder.Services.AddCors(o =>
    o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
app.UseCors();

// Resolve Angular dist directory
var distRelPath = builder.Configuration["FrontendDistPath"] ?? "../frontend/dist/browser";
var distPath = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, distRelPath));

// ── Sandbox server (port 8081) ──────────────────────────────────────────────
// Must run before static files middleware so it intercepts all sandbox-port requests.
app.Use(async (context, next) =>
{
    if (context.Connection.LocalPort != sandboxPort)
    {
        await next();
        return;
    }

    var path = context.Request.Path.Value ?? "/";

    if (path is "/" or "/sandbox.html")
    {
        McpUiResourceCsp? csp = null;
        if (context.Request.Query.TryGetValue("csp", out var cspJson))
        {
            try
            {
                csp = JsonSerializer.Deserialize<McpUiResourceCsp>(
                    cspJson!,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (JsonException ex)
            {
                Console.Error.WriteLine($"[Sandbox] Invalid CSP query param: {ex.Message}");
            }
        }

        context.Response.Headers.ContentSecurityPolicy = BuildCspHeader(csp);
        context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        context.Response.Headers.Pragma = "no-cache";
        context.Response.Headers.Expires = "0";
        context.Response.ContentType = "text/html";
        await context.Response.SendFileAsync(Path.Combine(distPath, "sandbox.html"));
    }
    else if (path == "/sandbox.js")
    {
        context.Response.ContentType = "application/javascript";
        await context.Response.SendFileAsync(Path.Combine(distPath, "sandbox.js"));
    }
    else
    {
        context.Response.StatusCode = 404;
        await context.Response.WriteAsync("Only sandbox files are served on this port");
    }
});

// ── Host server (port 8080) ─────────────────────────────────────────────────

// Block sandbox files on host port — they must come from the sandbox origin.
app.Use(async (context, next) =>
{
    if (context.Request.Path.Value is "/sandbox.html" or "/sandbox.js")
    {
        context.Response.StatusCode = 404;
        await context.Response.WriteAsync("Sandbox is served on a different port");
        return;
    }

    await next();
});

// /api/servers — configuration required, no hardcoded fallback
var servers = builder.Configuration.GetSection("Servers").Get<string[]>()
    ?? throw new InvalidOperationException("'Servers' configuration is required in appsettings.json");

app.MapGet("/api/servers", () => Results.Json(servers));

// Angular SPA static files
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(distPath),
});

// SPA fallback — serve index.html for unknown routes (client-side routing)
app.MapFallback(async context =>
{
    context.Response.ContentType = "text/html";
    await context.Response.SendFileAsync(Path.Combine(distPath, "index.html"));
});

Console.WriteLine($"Host server:    http://localhost:{hostPort}");
Console.WriteLine($"Sandbox server: http://localhost:{sandboxPort}");
Console.WriteLine($"Frontend dist:  {distPath}");
Console.WriteLine();

app.Run();

// ── CSP helpers ──────────────────────────────────────────────────────────────

static string BuildCspHeader(McpUiResourceCsp? csp)
{
    var rd = string.Join(" ", SanitizeCspDomains(csp?.ResourceDomains));
    var cd = string.Join(" ", SanitizeCspDomains(csp?.ConnectDomains));
    var frame = csp?.FrameDomains?.Length > 0
        ? $"frame-src {string.Join(" ", SanitizeCspDomains(csp.FrameDomains))}"
        : "frame-src 'none'";
    var baseUri = csp?.BaseUriDomains?.Length > 0
        ? $"base-uri {string.Join(" ", SanitizeCspDomains(csp.BaseUriDomains))}"
        : "base-uri 'none'";

    return string.Join("; ", new[]
    {
        "default-src 'self' 'unsafe-inline'",
        $"script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: {rd}".TrimEnd(),
        $"style-src 'self' 'unsafe-inline' blob: data: {rd}".TrimEnd(),
        $"img-src 'self' data: blob: {rd}".TrimEnd(),
        $"font-src 'self' data: blob: {rd}".TrimEnd(),
        $"media-src 'self' data: blob: {rd}".TrimEnd(),
        $"connect-src 'self' {cd}".TrimEnd(),
        $"worker-src 'self' blob: {rd}".TrimEnd(),
        frame,
        "object-src 'none'",
        baseUri,
    });
}

static string[] SanitizeCspDomains(string[]? domains) =>
    domains?
        .Where(d => !string.IsNullOrEmpty(d)
            && !d.Any(c => c is ';' or '\r' or '\n' or '\'' or '"' or ' '))
        .ToArray() ?? [];

record McpUiResourceCsp(
    [property: JsonPropertyName("resourceDomains")] string[]? ResourceDomains,
    [property: JsonPropertyName("connectDomains")] string[]? ConnectDomains,
    [property: JsonPropertyName("frameDomains")] string[]? FrameDomains,
    [property: JsonPropertyName("baseUriDomains")] string[]? BaseUriDomains
);
