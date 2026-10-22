---
title: Getting started
sidebar_label: Overview
sidebar_position: 0
description: Install HkdfGuard on Windows, macOS or Linux, provision a key for your service, and wrap your first data encryption key.
---

# Getting started with HkdfGuard

HkdfGuard keeps your application's data encryption keys wrapped under a key that the
operating system's security hardware holds: a TPM on Windows and Linux, the Secure Enclave on
a Mac. These guides take one machine from nothing to a working setup: the native library
installed, a key provisioned for your service, and a first key file your application can
read.

Pick your operating system:

- **[Windows](windows.md):** Windows 10, 11 or Server, x64 or ARM64. The key lives in the TPM, or in
  the Windows software key store when there is no TPM.
- **[macOS](macos.md):** Apple silicon, macOS 14 or later. The key lives in the Secure Enclave.
- **[Linux](linux.md):** Debian 13, Ubuntu 24.04, RHEL 10, Amazon Linux 2023 or SLES 16, x86_64 or
  arm64. The key lives in the TPM, an HSM, or a secret your platform mounts.

Each guide takes about 20 to 30 minutes.

Then pick your language. Each guide checks the setup with an in-memory key, then uses a key file,
encrypts configuration secrets in a deployment pipeline, and reads them back at runtime:

- **[.NET](dotnet.md):** .NET 10, with `IConfiguration` and dependency injection support.
- **[Java](java.md):** Java 21, or 25 for the native key wrapper, with a Spring Boot starter.
- **[Go](go.md):** Go 1.27, with cgo on macOS and Linux.
- **[Node.js](node.md):** Node.js 22, in TypeScript.
- **[Python](python.md):** Python 3.12.

Values are byte-compatible between the languages: a secret encrypted by the .NET library decrypts
in Java, Go, Node.js or Python.

## The two keys

HkdfGuard never asks you to store a master key. There are two keys, and only one of them ever
reaches your application:

| Key | What it is | Where it lives |
|---|---|---|
| **KEK** (key encryption key) | A P-256 key, one per service | Inside the TPM, Secure Enclave or HSM. It can be used there, but never read out. |
| **DEK** (data encryption key) | 32 random bytes that encrypt your data | On disk only *wrapped*, encrypted under the KEK, in a **key file**. Your application unwraps it into memory at startup. |

Each KEK is named by a **service name**, such as `com.example.orders`. Service names are 1 to
128 ASCII letters, digits and dots, can't start with a dot or contain `..`, and are
case-insensitive. Hyphens and underscores aren't allowed. Treat a service name as a public
identifier, not a secret.

## The workflow

Every platform follows the same four steps, with the same command-line tool, `hkdfguard`:

1. **Install, once per machine.** Install the native package for your OS. It puts the
   library and the `hkdfguard` tool in a fixed, administrator-only location.
2. **Provision, once per service.** A security administrator runs
   `hkdfguard provision --service-name com.example.orders`. This creates the service's KEK
   and prints its **fingerprint**. Record the fingerprint: retiring the key later requires it,
   and a later `provision` prints it again so you can confirm the key hasn't been replaced.
3. **Wrap, every release.** A deployer pipes the release's DEK into
   `hkdfguard wrap`, which writes the wrapped key file. The plaintext DEK is then discarded.
4. **Unwrap, at runtime.** Your application reads the key file and asks the library to unwrap
   it. The HkdfGuard language libraries (.NET, Java, Go, Node and Python) do this for you.

Under the default **production** security model these are three separate roles: a security
administrator provisions and retires keys, a deployer writes key files, and the application
only reads and unwraps them. An application can't write a key file that its own service would
trust.

## What is the same everywhere, and what isn't

The three native libraries share one C API, one table of status codes, one set of
service-name rules and one command-line contract, so a pipeline and an application work the
same way on each.

What they don't share is the wrapped bytes. A KEK never leaves the machine that created it, so
**a key file is only ever read on the machine that wrote it.** You can't wrap a DEK on a build
server and ship the key file to production. Deliver the DEK to the target machine, and wrap it
there.

| | Windows | macOS | Linux |
|---|---|---|---|
| KEK held by | TPM, or the Windows software key store | Secure Enclave | TPM, PKCS#11 HSM, or a mounted secret |
| Library | `C:\Program Files\HkdfGuard\v1\HkdfGuard.dll` | `/Library/Application Support/HkdfGuard/v1/libhkdfguard.dylib` | `libhkdfguard.so.1` |
| Tool | `C:\Program Files\HkdfGuard\v1\hkdfguard.exe` | `/usr/local/bin/hkdfguard` | `/usr/bin/hkdfguard` |
| Installed by | Signed MSI | Signed, notarized `.pkg` | `.deb` or `.rpm` packages |
| Key file size | 132 bytes | 125 bytes | 132 to 276 bytes |
| `hkdfguard` commands | `provision`, `wrap`, `status`, `retire` | `provision`, `wrap`, `status`, `retire` | `provision`, `wrap`, `retire` |

## Rules that apply on every platform

- **Never put a DEK on a command line or in an environment variable.** Process listings, shell
  history, CI logs and crash dumps record both. `hkdfguard wrap` reads the DEK only from
  standard input (`--dek-stdin`) or from a locked-down file (`--dek-file`), and refuses an
  interactive terminal.
- **Keep key files where only trusted accounts can write.** A key file is ciphertext, so anyone
  may read it. But anyone who can *replace* it can put back an older key file for the same
  service, and the library can't tell. Each platform refuses key files in folders other users
  can write to.
- **Never retire a key that is still needed.** Retiring a KEK makes every DEK wrapped under it
  unrecoverable. To move to a new key, provision a new, versioned service name (for example
  `com.example.orders.v2`), wrap new DEKs under it, and retire the old one only when nothing
  needs it.
- **Load the library only from its install location.** Never load it by bare file name, from
  your application folder, or from a path taken from configuration. The language libraries
  verify the installed library's location, ownership and signature before loading it.

See the [glossary](../glossary.md) for the terms used in these guides.
