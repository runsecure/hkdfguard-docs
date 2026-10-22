---
slug: introducing-hkdfguard
title: Introducing HkdfGuard
authors: [runsecure]
tags: [hkdfguard]
---

## The secret that protects your secrets

Every application that encrypts its configuration hits the same wall: the decryption key has to live somewhere. Usually it ends up in an environment variable, a file next to the app, or a vault token that is itself a secret. Encrypted config with a plaintext key beside it only moves the problem.

HkdfGuard is our answer. It is a set of open-source libraries that keep your application's data encryption keys wrapped under a key the operating system's security hardware holds: a TPM on Linux and Windows, the Secure Enclave on macOS. The key that protects your keys never enters your process. No master key, no shared secret, and nothing usable on disk.

<!-- truncate -->

## What's in the box

HkdfGuard has two layers. A small native library on each OS talks to the security hardware. Language libraries on top give developers a familiar API for encrypting configuration, caches and in-process values.

| Layer | Library | Built on |
| --- | --- | --- |
| Native | [hkdfguard-native-linux](https://github.com/runsecure/hkdfguard-native-linux) | Rust; TPM 2.0, PKCS#11 HSMs, or a root-owned mounted secret |
| Native | [hkdfguard-native-windows](https://github.com/runsecure/hkdfguard-native-windows) | TPM via the Microsoft Platform Crypto Provider |
| Native | [hkdfguard-native-mac](https://github.com/runsecure/hkdfguard-native-mac) | Apple Secure Enclave |
| Language | [hkdfguard-dotnet](https://github.com/runsecure/hkdfguard-dotnet) | The reference design; DI and `IConfiguration` integration |
| Language | [hkdfguard-java](https://github.com/runsecure/hkdfguard-java) | Java 21+, with a Spring Boot starter |
| Language | [hkdfguard-go](https://github.com/runsecure/hkdfguard-go) | Go |
| Language | [hkdfguard-node](https://github.com/runsecure/hkdfguard-node) | TypeScript |
| Language | [hkdfguard-python](https://github.com/runsecure/hkdfguard-python) | Python 3.12+ |

Every native library exposes the same plain C API and the same wire format. Every language port uses the same `enc::v<version>::<base64>` value format. A value encrypted by the .NET library decrypts in Java, Go, Node or Python, so a mixed fleet shares one deployment process. All of it is licensed under MPL 2.0.

## How it works

HkdfGuard uses a classic two-key hierarchy. A **data encryption key (DEK)** is a random 256-bit AES key that encrypts your data. A **key encryption key (KEK)** is a P-256 key, one per service, that lives in the TPM, Secure Enclave or HSM. The KEK wraps the DEK, and only the wrapped DEK ever touches disk.

A deployment works in three steps:

1. **Provision.** A security admin creates a KEK for the service once per host, e.g. `hkdfguard provision -sn com.company.orders`. The service name is a public identifier, not a secret.
2. **Encrypt and wrap.** The pipeline generates a fresh DEK for this deployment and encrypts the app's secrets with it. On the target host, the DEK is wrapped under the KEK into a key file, and the plaintext DEK is discarded.
3. **Run.** At startup the app asks the native library to unwrap the key file. The hardware does the private-key operation, and the DEK is held in pinned memory and zeroed when no longer needed.

![Deployment flow: the pipeline encrypts config with a fresh DEK, the DEK is wrapped under the KEK on the host, and the application unwraps it at start. The KEK never leaves the security hardware; only the wrapped DEK touches disk.](/img/blog/hkdfguard-deployment-flow.svg)

Under the hood, each wrap derives a one-time wrapping key: an ECDH between the KEK and a point hashed from a random per-payload salt, fed through HKDF-SHA512, then AES-256-GCM. That is where the name comes from.

## For the security team

The design choices worth knowing:

- **Key files are useless off the host.** A stolen key file, backup or container image can't be unwrapped anywhere except on the machine whose hardware holds the KEK.
- **Payloads can't be forged from the public key.** We deliberately avoided ECIES. With ECIES, anyone who knows the KEK's public key could mint a key file that unwraps to a DEK they chose, then read everything the app encrypts afterward. Wrapping against a hashed point means creating a valid payload needs the private key, just like opening one. The [design note](https://github.com/runsecure/hkdfguard-native-linux/blob/main/docs/why-ecdh.md) walks through the attack and the trade-offs.
- **A leaked intermediate secret opens one payload, not all.** Each payload has its own ECDH point, so a shared secret captured from a core dump or a TPM bus is good for that payload alone.
- **Everything is bound.** Service name, provider, KEK fingerprint and payload version are all covered by the AEAD and the HKDF info. A payload can't be replayed under another service or relabelled to a weaker provider. In the language libraries, each configuration value is bound to its setting name, so an attacker who can edit a config file can't move an admin connection string into a less privileged setting.
- **Fails closed.** The libraries re-check KEK access on a timer. If the TPM grant or HSM access is revoked, a running process stops decrypting within a few refresh intervals rather than running on indefinitely. A provider that is present but misconfigured is an error, never a silent fallback to something weaker.
- **Separation of duties.** On Linux, only root provisions KEKs, only root or a member of `hkdfguard-deployers` writes key files the library trusts, and the application only unwraps. Key files anyone else could have replaced are refused.
- **Process hardening.** Opt-in calls disable core dumps and block same-user debugger attach. On Linux, an audit trail goes to syslog's authpriv facility.

What it does not do: it can't protect you from code that is already allowed to use the KEK. On a host, that boundary is who can reach the TPM or HSM, so keep that group small.

## For developers

Application code never sees the KEK and rarely sees the DEK. You build a `KeyRing` from a service name and one or more key files, then ask it for protectors. In .NET:

```csharp
var ring = await new KeyRingBuilder()
    .WithServiceName("com.company.orders")
    .WithKeyRefreshInterval(60) // seconds between KEK access checks
    .WithKeyWrapper(new NativeHkdfKeyWrapperV1("com.company.orders"))
    .WithCryptoProviderFactory(new AesGcmCryptoProviderFactory(logger))
    .WithKeyFile(version: 1, pathToFile: "/var/lib/orders/dek.wrapped")
    .BuildAsync(cancellationToken);

IDataProtector protector = ring.CreateProtector("session-tokens");
string encrypted = protector.Encrypt("secret value".AsSpan()); // "enc::v1::..."
```

The protector name is bound into every ciphertext as associated data, so a value encrypted for one purpose won't decrypt under another. Beyond raw protectors, the libraries include:

- **Encrypted configuration.** Drop-in wrappers for `IConfiguration` in .NET and the Spring `Environment` in Java decrypt `enc::` values on read.
- **Protected caches.** In-memory caches that keep values encrypted at rest in RAM.
- **Runtime keys.** `WithEphemeralKey` generates a key at startup that never touches disk, for values that don't need to outlive the process.
- **Observability.** OpenTelemetry spans and metrics with the same names in every language.

The Java, Go, Node and Python APIs follow the same shape in their own idioms. The [getting-started guides](/docs/guides/gettingstarted) take one machine, and each language, from nothing to a hardware-protected key file.

## Encrypt before you persist

The deployment pipeline is where secrets are most exposed: they have to be written into configuration somewhere, and the key that protects them has to come from somewhere too. HkdfGuard's **pipeline data protector** closes that gap. Nothing secret reaches a disk or a volume unencrypted, and the key that encrypted it reaches one only after it has been wrapped.

1. **Generate the key in memory.** The pipeline data protector creates a random 32-byte DEK in the pipeline's own memory. It is never written to a file, a variable store or a log.
2. **Encrypt every secret before it is persisted.** Each secret is encrypted under that DEK and bound to the configuration key it will be stored under, such as `ConnectionStrings:Admin`. Only the `enc::v1::...` ciphertext is ever written into configuration, a volume or a repository. A value later moved to a different setting fails to decrypt.
3. **Wrap the DEK before it is persisted.** On the target host, the pipeline hands the same 32 bytes to `hkdfguard wrap` on standard input: never as an argument or an environment variable, where process listings and CI logs would record it. The tool wraps it under the host's KEK, and only the wrapped key file is written.
4. **Zero the DEK.** The protector zeroes the key, and its base64 form, as soon as the wrap completes. From then on, the only copy is the wrapped one.

In .NET:

```csharp
using var pipeline = new AesGcmPipelineDataProtector(new DefaultFormatProvider(), keyVersion: 1);

// 1-2. Encrypt each secret for the setting it will be stored under; persist only the ciphertext.
string adminConnection = pipeline.Encrypt("Server=db;Password=s3cret", "ConnectionStrings:Admin");

// 3. Hand the same key to the native tool on standard input, from a buffer that is zeroed afterwards.
var start = new ProcessStartInfo("hkdfguard") { RedirectStandardInput = true, UseShellExecute = false };
foreach (var arg in new[] { "wrap", "--service-name", "com.company.orders",
                            "--key-file-path", "/etc/orders/keys/orders.v1.key", "--dek-stdin" })
    start.ArgumentList.Add(arg);

using var tool = Process.Start(start)!;
var base64Key = pipeline.GetKeyAsBase64();
Span<byte> ascii = stackalloc byte[base64Key.Length];
try
{
    Encoding.ASCII.GetBytes(base64Key, ascii);
    tool.StandardInput.BaseStream.Write(ascii);
}
finally
{
    CryptographicOperations.ZeroMemory(ascii);
}
tool.StandardInput.Close();
tool.WaitForExit();
// 4. Disposing the pipeline protector zeroes the key.
```

At runtime the application registers that key file at version 1, and its encrypted configuration decrypts as usual. Every language port has the same pipeline protector.

One caveat: a key can only be wrapped on the machine that holds the KEK, so the plaintext DEK has to reach that machine. "Never persisted unwrapped" holds end to end when the pipeline step runs on the target host, or hands the key to it over a protected channel. If your pipeline encrypts on a build server, treat the hop to the host as carrying a secret.

## What's next: cloud key management

The native libraries keep the KEK in hardware on each host. Not every workload has a host of its own, though: containers, serverless functions and autoscaled fleets come and go. For those, the KEK belongs in a managed key service.

The key wrapper is a swappable part of every language library. The rest of the stack (key rings, the AES-256-GCM cipher, encrypted configuration, caches and telemetry) talks to it only through one small interface, and that interface is asynchronous so a key service over the network fits it. So a cloud key wrapper slots in without changing application code.

- **AWS KMS:** work is in progress on a key wrapper that uses an AWS KMS key as the KEK.
- **Azure Key Vault, Google Cloud KMS and HashiCorp Vault:** similar key wrappers are planned.

With a cloud key wrapper, the KEK's protection becomes the key service's: its access policies, audit logs and HSMs, rather than a single host's TPM. We'll write up the trade-offs, and how the security properties above carry over, as each one lands.

## Try it

The code is on GitHub under [runsecure](https://github.com/runsecure). For a first look, start with [hkdfguard-dotnet](https://github.com/runsecure/hkdfguard-dotnet) or the native library for your OS. The Linux library ships `.deb` and `.rpm` packages and a container overlay image.

If you protect credentials for a living, we'd especially like your eyes on the key-wrapping construction. Issues, design questions and pull requests are all welcome.
