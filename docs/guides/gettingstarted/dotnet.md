---
title: Getting started with .NET
sidebar_label: .NET
sidebar_position: 4
description: Use HkdfGuard from C# to encrypt data and configuration secrets under a TPM- or Secure Enclave-protected key.
---

# Getting started with .NET

This guide takes a C# application from nothing to encrypting and decrypting data under a key the
platform protects. It first checks the setup with an in-memory key. Then it moves to a durable
key file, encrypts configuration secrets in a deployment pipeline, and reads them back at
runtime.

`hkdfguard-dotnet` is the reference design. Every other language port reads and writes the same
values.

## Before you start

You need:

- **The .NET 10 SDK.**
- **The HkdfGuard native library, installed on the machine, with a service provisioned.** Follow
  the guide for your OS first: [Windows](windows.md), [macOS](macos.md) or [Linux](linux.md).
  This guide uses the service name `com.example.myapp`.
- **An account that may use the key.** Your application must run as an account the service's
  key allows:
  - Windows: a member of `HkdfGuardUsers`.
  - Linux: in `tss` and `hkdfguard`.
  - macOS (user-scoped): the user who provisioned it.

The .NET library loads the native library only from its install location, and only after
checking the folder's permissions and the library's signature. It never searches `PATH` or your
application folder.

## 1. Add the packages

| Package | What it gives you |
|---|---|
| `HkdfGuard.DataEncryptionKey` | `KeyRing`, `KeyRingBuilder`, data protectors and the `enc::v1::...` format |
| `HkdfGuard.CryptoProvider.AesGcm256` | The AES-256-GCM cipher, and `AesGcmPipelineDataProtector` for pipelines |
| `HkdfGuard.KeyWrapping.V1` | `NativeHkdfKeyWrapperV1`, which calls the native library |
| `HkdfGuard.EncryptedConfiguration` | `ProtectedConfigurationRoot`, which reads encrypted secrets from `IConfiguration` |
| `HkdfGuard.Options` | `HkdfGuardOptions`, to configure the ring from `appsettings.json` |
| `HkdfGuard.DependencyInjection` | `AddKeyRingAsync`, to register the ring in an `IServiceCollection` |
| `HkdfGuard.Cache` | `ProtectedCache`, an in-memory cache that holds only ciphertext |

:::note Where the packages come from
Releases are published on the
[GitHub Releases page](https://github.com/runsecure/hkdfguard-dotnet/releases) as `.nupkg` files.
They aren't on nuget.org yet. Every assembly inside them is Authenticode-signed. Download them to
a folder, and add that folder as a package source:

```sh
dotnet nuget add source ./hkdfguard-packages --name hkdfguard
```
:::

```sh
dotnet new console -n HkdfGuardDemo
cd HkdfGuardDemo
dotnet add package HkdfGuard.DataEncryptionKey
dotnet add package HkdfGuard.CryptoProvider.AesGcm256
dotnet add package HkdfGuard.KeyWrapping.V1
```

## 2. Check the setup with an in-memory key

Replace `Program.cs` with:

```csharp
using HkdfGuard.CryptoProvider.AesGcm256;
using HkdfGuard.DataEncryptionKey;
using HkdfGuard.KeyWrapping.V1;

await using var ring = await new KeyRingBuilder()
    .WithServiceName("com.example.myapp")
    .WithKeyWrapper(new NativeHkdfKeyWrapperV1("com.example.myapp"))
    .WithCryptoProviderFactory(new AesGcmCryptoProviderFactory())
    .WithKeyRefreshInterval(60)
    .WithEphemeralKey(version: 1)
    .BuildAsync();

var protector = ring.CreateProtector("customer-notes");
string encrypted = protector.Encrypt("The launch code is 0000");
Console.WriteLine(encrypted);

Span<char> buffer = stackalloc char[protector.GetMaxDecryptedLength(encrypted)];
int written = protector.Decrypt(encrypted, buffer);
Console.WriteLine(buffer[..written].ToString());
```

Run it with `dotnet run`:

```text
enc::v1::35zt4fIdLUCinFy3S6/8N1yf53CaMBiU+eRmC2PyVVIJV+LwFzm7Q3xf2sU/JmatNCgp
The launch code is 0000
```

What happened:

- `BuildAsync` asked the native library to generate a DEK and wrap it under your service's key,
  then unwrapped it into pinned memory. The plaintext DEK never touched disk.
- `enc::v1::...` is the stored form. `v1` is the key version, and the rest is the AES-GCM
  ciphertext.
- `"customer-notes"` is the protector's **purpose**. It is bound into every value, so a value
  encrypted by one protector never decrypts under another.
- `WithKeyRefreshInterval(60)` re-checks the key every 60 seconds. If it stops being available,
  encryption stops after three failed checks, until access returns.

On macOS, the first run shows a keychain prompt for `dotnet`: choose **Always Allow**. See
[the first unwrap asks for permission](macos.md#the-first-unwrap-asks-for-permission) for why a
production service should be published as its own executable.

An **ephemeral key** lives only as long as the process, which suits short-lived data such as
session tokens. Data you store needs a key file.

## 3. Use a key file

In a deployment, a deployer wraps each release's DEK into a **key file** with
`hkdfguard wrap`, as the OS guides show. Your application registers it by version:

```csharp
await using var ring = await new KeyRingBuilder()
    .WithServiceName("com.example.myapp")
    .WithKeyWrapper(new NativeHkdfKeyWrapperV1("com.example.myapp"))
    .WithCryptoProviderFactory(new AesGcmCryptoProviderFactory())
    .WithKeyRefreshInterval(60)
    .WithKeyFile(version: 1, pathToFile: @"C:\HkdfGuardKeys\myapp\myapp.v1.key")
    .BuildAsync();
```

Use the path your OS guide prepared:

| OS | Example key file |
|---|---|
| Windows | `C:\HkdfGuardKeys\myapp\myapp.v1.key` (never under `C:\ProgramData`) |
| Linux | `/etc/myapp/keys/myapp.v1.key` |
| macOS | `~/Library/Application Support/MyApp/keys/myapp.v1.key`, or a root-owned folder in production |

The key file is read through the native library, which refuses one that another account could
have written or replaced.

**To rotate,** wrap a new DEK as `myapp.v2.key` and add `.WithKeyFile(version: 2, ...)`. New values
use the highest version. Older values still decrypt for as long as their key file stays
registered.

**Mixing key files and ephemeral keys.** A ring can hold both. Ephemeral keys rotate (every 24
hours by default), and each rotation adds a key at the current version + 1. So give the ephemeral
key a version above every key file, or turn ephemeral rotation off. Otherwise the first rotation
would replace the key file as the current key, and values encrypted after it would be lost on a
restart.

## 4. Encrypt configuration secrets in your pipeline

Your release pipeline creates the DEK and encrypts the application's secrets under it. Then, on
the target machine, it hands the same DEK to `hkdfguard wrap`. Each secret is bound to the
configuration key it is stored under, so a value moved to another key fails to decrypt:

```csharp
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using HkdfGuard.CryptoProvider.AesGcm256;
using HkdfGuard.DataEncryptionKey.FormatProvider;

using var pipeline = new AesGcmPipelineDataProtector(new DefaultFormatProvider(), keyVersion: 1);

// Encrypt each secret for the configuration key it will be stored under.
string connectionString = pipeline.Encrypt("Server=db;Password=s3cret", "ConnectionStrings:Admin");
// ...write "enc::v1::..." into appsettings.json as ConnectionStrings:Admin...

// On the target machine, wrap the same key into the release's key file.
var start = new ProcessStartInfo(toolPath) { RedirectStandardInput = true, UseShellExecute = false };
foreach (var arg in new[] { "wrap", "--service-name", "com.example.myapp",
                            "--key-file-path", keyFilePath, "--dek-stdin" })
    start.ArgumentList.Add(arg);
// Add "--group", "App_MyApp" (Windows) or the service's group (Linux) so the application can read it.

using var tool = Process.Start(start)!;
var base64Key = pipeline.GetKeyAsBase64();
Span<byte> ascii = stackalloc byte[base64Key.Length];
try
{
    Encoding.ASCII.GetBytes(base64Key, ascii);
    tool.StandardInput.BaseStream.Write(ascii);
    tool.StandardInput.BaseStream.Flush();
}
finally
{
    CryptographicOperations.ZeroMemory(ascii);
}
tool.StandardInput.Close();
tool.WaitForExit();
if (tool.ExitCode != 0)
    throw new InvalidOperationException($"hkdfguard wrap failed with exit code {tool.ExitCode}.");
```

`toolPath` is `C:\Program Files\HkdfGuard\v1\hkdfguard.exe` on Windows, `/usr/bin/hkdfguard` on
Linux, and `/usr/local/bin/hkdfguard` on macOS. Run this step as a deployer, as your OS guide
describes.

:::warning
Pass the DEK only on standard input, from a byte buffer you then zero, as above. Never pass it
as a command-line argument or an environment variable. Never copy `GetKeyAsBase64()` into a
`string`: strings can't be cleared from memory. Disposing the pipeline protector zeroes the key.
:::

## 5. Read the secrets back at runtime

`ProtectedConfigurationRoot` wraps your `IConfigurationRoot`. Configuration only ever holds the
ciphertext, and `Decrypt` reads it fresh on every call, so a reload takes effect at once:

```csharp
using HkdfGuard.EncryptedConfiguration;

var secrets = new ProtectedConfigurationRoot(configurationRoot, ring);

if (secrets.TryGetMaxDecryptedLength("ConnectionStrings:Admin", out int maxLength))
{
    char[] value = new char[maxLength];
    try
    {
        int length = secrets.Decrypt("ConnectionStrings:Admin", value);
        // use value[..length]
    }
    finally
    {
        Array.Clear(value);
    }
}
```

The key ring must have the release's key file registered at the version the pipeline used,
here `1`.

## 6. Configure the ring from appsettings.json

`HkdfGuard.Options` binds the ring's settings from configuration, with the same field names every
port reads:

```json
{
  "HkdfGuard": {
    "ServiceName": "com.example.myapp",
    "KeyRefreshInterval": 60,
    "KeyFiles": [ { "Version": 1, "Path": "C:\\HkdfGuardKeys\\myapp\\myapp.v1.key" } ]
  }
}
```

```csharp
using HkdfGuard.DependencyInjection;
using HkdfGuard.Options;
using Microsoft.Extensions.Options;

var options = builder.Configuration.GetSection("HkdfGuard").Get<HkdfGuardOptions>()
    ?? throw new InvalidOperationException("The HkdfGuard configuration section is missing.");
var result = new HkdfGuardOptionsValidator().Validate(null, options);
if (result.Failed)
    throw new OptionsValidationException("HkdfGuard", typeof(HkdfGuardOptions), result.Failures);

await builder.Services.AddKeyRingAsync(ring => options.ApplyTo(ring)
    .WithKeyWrapper(new NativeHkdfKeyWrapperV1(options.ServiceName!))
    .WithCryptoProviderFactory(new AesGcmCryptoProviderFactory()));
```

`AddKeyRingAsync` builds the ring at registration, before the container exists, and registers it
as a singleton that the container disposes at shutdown.

## 7. Harden the process

DEKs pass through your process's memory. Opt in to process hardening once, early in startup, so
crash dumps and other processes of the same user can't read it:

```csharp
NativeProcessHardening.Apply(ProcessHardeningOptions.RequireProtectedSignature); // Windows services
NativeProcessHardening.Apply();                                                  // elsewhere
```

It throws if it fails; don't start without it. On Windows, use `RequireProtectedSignature`: the
.NET runtime starts threads before `Main`, and the strict form also closes the threads it starts
later. Debuggers and `dotnet-dump` stop working for the process.

## Troubleshooting

Every native error message includes the status code and what it means.

| You see | Cause | Fix |
|---|---|---|
| `DllNotFoundException` | The native library isn't installed | Follow your OS guide's install step |
| `SecurityException` | The installed library, or a folder above it, failed verification | Reinstall the native package; don't change that folder's permissions |
| `CryptographicException`, status -17 | No key is provisioned for this service name | Provision it, with the same service name |
| `CryptographicException`, status -18 | The key exists, but this account may not use it | Windows: add the account to `HkdfGuardUsers`. macOS: run as the user who provisioned it, in a logged-in session. |
| `CryptographicException`, status -16 or -11 | The key file was wrapped under another service's key, or altered | Use the right service name, or redeploy the key file |
| `UnauthorizedAccessException`, status -39 | The key file's location isn't trusted | Move it to a folder prepared as your OS guide shows |
| `InvalidDataException`, status -37 | The "key file" holds an *unwrapped* key | Treat that key as exposed: replace it, and create the file with `wrap` |
| `ArgumentException` about the service name | The name breaks the service-name rules | Use ASCII letters, digits and dots only |

## Next steps

- The [hkdfguard-dotnet README](https://github.com/runsecure/hkdfguard-dotnet) covers:
  - key rotation and ephemeral-key rotation;
  - `ProtectedCache`;
  - diagnostics with OpenTelemetry and `ILogger`;
  - verifying a release's signatures.
- [Separation of duties](../separationofduties.md) explains who should run each step in
  production.
