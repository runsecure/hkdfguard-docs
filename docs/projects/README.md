---
title: Projects
description: Every HkdfGuard repository on GitHub - the native key wrappers for each operating system, and the libraries for each language.
---

# Projects

HkdfGuard is eight open-source repositories under [github.com/runsecure](https://github.com/runsecure),
all licensed under the Mozilla Public License 2.0. They come in two layers:

- **A native key wrapper per operating system** holds the key encryption key (KEK) in the platform's
  security hardware, and wraps and unwraps data encryption keys under it. Install one on every
  machine that runs an HkdfGuard application.
- **A library per language** gives your application key rings, data protectors, encrypted
  configuration and protected caches. Each one calls the native key wrapper installed on the
  machine.

Every native wrapper exposes the same C API and the same `hkdfguard` command-line tool. Every
language library writes the same `enc::v<version>::<base64>` values, so a secret encrypted in one
language decrypts in any other.

## Native key wrappers

| Project | Platform | Keeps the KEK in | Ships as | Get started |
| --- | --- | --- | --- | --- |
| [hkdfguard-native-windows](https://github.com/runsecure/hkdfguard-native-windows) | Windows 10, 11 and Server, x64 and ARM64 | The TPM, through the Microsoft Platform Crypto Provider, or the Windows software key store | Signed MSI | [Windows guide](../guides/gettingstarted/windows.md) |
| [hkdfguard-native-mac](https://github.com/runsecure/hkdfguard-native-mac) | macOS 14 or later, Apple silicon | The Secure Enclave | Signed, notarized `.pkg` | [macOS guide](../guides/gettingstarted/macos.md) |
| [hkdfguard-native-linux](https://github.com/runsecure/hkdfguard-native-linux) | Debian 13, Ubuntu 24.04, RHEL 10, Amazon Linux 2023, SLES 16; x86_64 and arm64 | A TPM 2.0, a PKCS#11 HSM, or a secret your platform mounts | `.deb` and `.rpm` packages, a tarball, and a container overlay image | [Linux guide](../guides/gettingstarted/linux.md) |

How each one wraps keys, byte for byte, is in [Cryptography](../guides/cryptography/index.md).

## Language libraries

| Project | Language | Ships as | Highlights | Get started |
| --- | --- | --- | --- | --- |
| [hkdfguard-dotnet](https://github.com/runsecure/hkdfguard-dotnet) | .NET 10 | NuGet packages on GitHub Releases, with Authenticode-signed assemblies | The reference design; `IConfiguration` and dependency injection support | [.NET guide](../guides/gettingstarted/dotnet.md) |
| [hkdfguard-java](https://github.com/runsecure/hkdfguard-java) | Java 21, or 25 for the native key wrapper | Signed jars on GitHub Releases, under `io.github.runsecure` | A Spring Boot starter, with a protected `Environment` and a health indicator | [Java guide](../guides/gettingstarted/java.md) |
| [hkdfguard-go](https://github.com/runsecure/hkdfguard-go) | Go 1.27 | Go modules, released by tag | Three modules, so the cipher and the key wrapper swap independently | [Go guide](../guides/gettingstarted/go.md) |
| [hkdfguard-node](https://github.com/runsecure/hkdfguard-node) | Node.js 22, in TypeScript | npm packages on GitHub Releases, with build provenance | Native calls run on libuv's thread pool, so a TPM never blocks the event loop | [Node.js guide](../guides/gettingstarted/node.md) |
| [hkdfguard-python](https://github.com/runsecure/hkdfguard-python) | Python 3.12 | Wheels on GitHub Releases, with Sigstore provenance | A synchronous API, with every closable type a context manager | [Python guide](../guides/gettingstarted/python.md) |

Releases numbered `0.x` are pre-releases. Each guide says how to install from its project's
current releases.

## Where to start

1. Install the native key wrapper for your operating system, and provision a key for your service,
   with the [getting-started guide](../guides/gettingstarted/index.md) for your OS.
2. Follow the guide for your language.
3. Read [Separation of duties](../guides/separationofduties.md) before going to production.
