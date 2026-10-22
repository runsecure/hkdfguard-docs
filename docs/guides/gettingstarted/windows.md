---
title: Getting started on Windows
sidebar_label: Windows
sidebar_position: 1
description: Install HkdfGuard on Windows, provision a TPM-backed key for your service, and wrap your first data encryption key.
---

# Getting started on Windows

This guide takes one Windows machine from nothing to a working setup:

- the HkdfGuard native library installed;
- a TPM-backed key (KEK) provisioned for your service;
- a first key file your application can read.

New to HkdfGuard? Read the [overview](index.md) first.

:::note Pre-release
Versions `0.9.x` are for pre-release testing. The commands below use `0.9.0`. Substitute the
version you download.
:::

## Requirements

- **64-bit Windows**, x64 or ARM64: Windows 10 or 11, or Windows Server.
- **Administrator rights**, to install and to provision each service's key.
- **A TPM**, ideally. Without one, keys are kept by the Microsoft Software Key Storage Provider
  instead, unless policy requires a TPM (see [Choose where keys are kept](#choose-where-keys-are-kept)).
  To check for one, run `Get-Tpm` in an elevated PowerShell.

Pick the MSI that matches the architecture of the **applications** that will load the
library, not just the machine. An x64 process can't load the ARM64 library, and an ARM64
process can't load the x64 one. 32-bit processes aren't supported.

## What gets installed

| File | Used by | Purpose |
|---|---|---|
| `C:\Program Files\HkdfGuard\v1\HkdfGuard.dll` | Applications | Wraps and unwraps keys. Applications load it at runtime. |
| `C:\Program Files\HkdfGuard\v1\hkdfguard.exe` | Administrators and deployers | Provisions keys, wraps keys into key files, reports and retires keys. |

The installer also:

- records the folder in the registry, at `HKLM\Software\hkdfguard-native-windows`, value
  `InstallPath`;
- registers the event log source `hkdfguard-native-windows`;
- creates two local groups, `HkdfGuardUsers` (applications) and `HkdfGuardDeployers`
  (accounts that write key files).

The folder inherits the Program Files permissions, so only Administrators, SYSTEM and
TrustedInstaller can change it. The location can't be changed.

## 1. Download and verify

Download the MSI and its `.sha256` file from the
[Releases page](https://github.com/runsecure/hkdfguard-native-windows/releases):

- `hkdfguard-native-windows-0.9.0-win-x64.msi` for x64;
- `hkdfguard-native-windows-0.9.0-win-arm64.msi` for ARM64.

Before you install, check the signature and the checksum:

```powershell
$msi = ".\hkdfguard-native-windows-0.9.0-win-x64.msi"

# Status must be "Valid", and TimeStamperCertificate must not be empty.
Get-AuthenticodeSignature $msi | Format-List Status, SignerCertificate, TimeStamperCertificate

# The two values must match.
(Get-FileHash $msi -Algorithm SHA256).Hash.ToLower()
Get-Content "$msi.sha256"
```

If you have the [GitHub CLI](https://cli.github.com), also check the build provenance. This
proves the MSI was built by the project's release workflow:

```powershell
gh attestation verify $msi --repo runsecure/hkdfguard-native-windows
```

:::warning
MSIs from a CI run's "Artifacts" section are **unsigned** and for testing only. Don't deploy
them.
:::

## 2. Install

Double-click the MSI and accept the UAC prompt. Or, from an elevated prompt, install silently:

```powershell
msiexec /i hkdfguard-native-windows-0.9.0-win-x64.msi /qn /l*v install.log
```

The silent command works unchanged in Intune, Configuration Manager or Group Policy. Exit code
`0` means success, and `3010` means success with a restart needed.

Check the install:

```powershell
Get-ItemProperty HKLM:\Software\hkdfguard-native-windows | Select-Object InstallPath
Get-ChildItem "C:\Program Files\HkdfGuard\v1"
net localgroup HkdfGuardUsers
net localgroup HkdfGuardDeployers
& "C:\Program Files\HkdfGuard\v1\hkdfguard.exe" --help
```

## 3. Decide who can use the key

**Do this before you provision.** A key's access list is fixed when the key is created.
Adding a group to the policy later doesn't change keys that already exist.

Windows runs the **production** security model unless an administrator changes it. It has
three roles:

| Role | Can | Who |
|---|---|---|
| **Security admin** | Provision and retire keys | A local administrator, from an elevated prompt |
| **Deployer** | Wrap keys into key files | A member of `HkdfGuardDeployers`. Shouldn't also be a local administrator, or the separation exists only on paper. |
| **Application** | Unwrap key files, and wrap and unwrap keys in memory. Can't write a key file its own service would trust. | The service's account, a member of `HkdfGuardUsers` |

Add your service's account and your deployment account to the groups:

```powershell
net localgroup HkdfGuardUsers "NT SERVICE\MyAppService" /add
net localgroup HkdfGuardDeployers "CONTOSO\deploy-agent" /add
```

- **Add accounts directly to `HkdfGuardDeployers`.** Only user and service accounts added
  directly count. A group added to it, and that group's members, are ignored, so adding a
  broad group can never make everyone a deployer.
- **Restart the service after changing its groups.** A running service only picks up new
  group membership when it restarts. A signed-in user must sign out and in again.
- **Never delete and recreate these groups.** A recreated group gets a new SID, and its
  members silently lose access to every key created before.

:::tip Developer machines
On a development machine, where one account does everything, set the developer model.
Under it, the library also trusts key files that the reading account wrote itself:

```powershell
reg add HKLM\Software\Policies\HkdfGuard /v SecurityModel /t REG_DWORD /d 1 /f
```

Never set this on a production machine. Each process that reads a key file under the
developer model logs event 1005.
:::

### Choose where keys are kept

By default, keys go in the TPM when one is available, and in the software key store
otherwise. To require a TPM, set `KeyStoragePolicy` to `1` **before** provisioning:

```powershell
reg add HKLM\Software\Policies\HkdfGuard /v KeyStoragePolicy /t REG_DWORD /d 1 /f
```

| Value | Behavior |
|---|---|
| absent or `0` | Use the TPM if available, otherwise the software key store |
| `1` | TPM only. Fails rather than falling back. |
| `2` | Software key store only |

This setting also decides where an existing key is *looked for*. Changing it after keys exist
can make them unreachable. Any value other than `0`, `1` or `2` makes every call fail.

In production, set these values through Group Policy, Intune or Configuration Manager. The
installer never sets any policy.

## 4. Provision the key

From an **elevated** PowerShell, once per service:

```powershell
& "C:\Program Files\HkdfGuard\v1\hkdfguard.exe" provision --service-name com.example.myapp
```

`provision` creates the key if it is missing. If it already exists, `provision` checks its
properties and access list and changes nothing, so it is safe to run on every deployment. It
takes about two seconds: setup calls are deliberately slowed so a misbehaving program can't
hammer the TPM.

It prints the key's **fingerprint**, 64 hex characters. **Record it** with your deployment
records:

- `retire` requires it before it will delete the key;
- if a later `provision` prints a different fingerprint, the key under that name has been
  replaced. Investigate before wrapping anything new.

Check the key at any time, from any account that can use it:

```powershell
& "C:\Program Files\HkdfGuard\v1\hkdfguard.exe" status --service-name com.example.myapp
```

`status` reports the following, and changes nothing:

- whether the key is `present`, `absent`, `corrupt` or `unusable`;
- whether the TPM or the software key store holds it;
- its fingerprint;
- the security model in force;
- whether your account may write key files.

## 5. Prepare a folder for key files

The library only reads a key file from a folder that no untrusted account can change. That
rules out more places than you might expect:

- **`C:\ProgramData` and everything under it.** It lets Users create files and folders, so a
  key file anywhere below it is refused, whatever the permissions of its own folder.
- **`C:\Windows\Temp`**, for the same reason.
- **A folder created directly under `C:\` with default permissions.** It inherits
  `Authenticated Users: Modify`.
- **Network drives, mapped or `SUBST` drives, symbolic links and junctions.** Also OneDrive or
  Dropbox placeholders and deduplicated volumes.
- **Paths that use an 8.3 short name**, such as `PROGRA~1`. Spell every folder in full.

Use a folder of its own directly under the drive root, with inherited permissions removed.
From an elevated prompt:

```powershell
New-Item -ItemType Directory -Force C:\HkdfGuardKeys\myapp | Out-Null

# Remove inherited permissions. Grant SYSTEM and Administrators full control,
# deployers Modify (to write key files) and Users read.
icacls C:\HkdfGuardKeys /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" "HkdfGuardDeployers:(OI)(CI)M"
icacls C:\HkdfGuardKeys /setowner "*S-1-5-32-544" /T

# Check: SYSTEM, Administrators, Users (RX) and HkdfGuardDeployers (M), none inherited from C:\.
icacls C:\HkdfGuardKeys
```

The SIDs make the commands work in any display language. `S-1-5-18` is SYSTEM,
`S-1-5-32-544` is Administrators, and `S-1-5-32-545` is Users.

Then create a local group for the account that will read the key file. Its only member
should be the service's account:

```powershell
net localgroup App_MyApp /add
net localgroup App_MyApp "NT SERVICE\MyAppService" /add
```

`wrap` never creates a missing folder, and it checks all of this before it reads the DEK. If
it refuses a folder, its message names the folder and the account, and prints the `icacls`
commands that fix it.

## 6. Wrap a DEK into a key file

Run `wrap` as a **deployer**, a member of `HkdfGuardDeployers`, or as an elevated
administrator. Under the production model, any other account is refused before anything is
written. `wrap` reads the DEK as base64 from standard input, so the key never appears on a
command line:

```powershell
$exe = "C:\Program Files\HkdfGuard\v1\hkdfguard.exe"

# Generate a random 32-byte DEK and wrap it.
$dek = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($dek)
try {
    [Convert]::ToBase64String($dek) | & $exe wrap `
        --key-file-path C:\HkdfGuardKeys\myapp\myapp.v1.key `
        --service-name com.example.myapp --dek-stdin --group App_MyApp
} finally {
    [Array]::Clear($dek, 0, $dek.Length)
}
```

- The key file is always 132 bytes. Its access list lets its owner read and write it, and
  gives `--group` read access.
- `--force` replaces an existing key file.
- `wrap` uses an existing key and never creates one. If the service isn't provisioned, it fails
  and tells you to run `provision`.

:::warning Where the DEK comes from
This example makes a new DEK only to show the steps. In a real deployment, the DEK comes from
your release pipeline: it is the key your pipeline encrypted the application's secrets with.
For example, the language libraries' pipeline data protector generates one in memory. Pass
it to `wrap` straight from a byte buffer you can zero afterwards. A PowerShell string, like the
base64 text above, can't be cleared from memory.
:::

Protect the key file. Anyone who can replace it can put back an older key file for the same
service, and it would still unwrap.

## 7. Use the key from your application

Your application unwraps the key file through `HkdfGuard.dll`. The tool has no unwrap command.

**With an HkdfGuard language library** (.NET, Java, Go, Node or Python), configure the
following, and the library does the rest:

- the service name, `com.example.myapp`;
- the key file's full path, `C:\HkdfGuardKeys\myapp\myapp.v1.key`.

It loads `HkdfGuard.dll` from the install location and verifies its signature first.

**Calling the C API directly**, load the DLL by its full path, read from the registry. Never
load it by bare file name, which lets Windows search other folders:

```csharp
using var hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
using var key = hklm.OpenSubKey(@"Software\hkdfguard-native-windows")
    ?? throw new InvalidOperationException("hkdfguard-native-windows is not installed");
string dir = (string)key.GetValue("InstallPath")!;
IntPtr lib = NativeLibrary.Load(Path.Combine(dir, "HkdfGuard.dll"));
```

Then:

1. Call `hkdfguard_open_file` to read the key file.
2. Call `hkdfguard_unwrap_dek` with the service name to recover the 32-byte DEK.

Do both once at startup, and zero the DEK when you're done.

Always configure the key file's **full long path**. If you build it from `%TEMP%` or another
environment variable, expand it with `GetLongPathNameW` first. Windows can set those variables
with 8.3 short names, and the library refuses a path that contains one.

The application's account needs to be in `HkdfGuardUsers` (to use the key), and to be able to
read the key file (through `--group`).

## Monitor it

Every key operation is logged to the Windows **Application** log, source
`hkdfguard-native-windows`:

```powershell
Get-WinEvent -LogName Application -FilterXPath "*[System[Provider[@Name='hkdfguard-native-windows']]]" -MaxEvents 50 |
    Format-Table TimeCreated, Id, LevelDisplayName, UserId, Message -Wrap
```

Good events to alert on:

| ID | Meaning |
|---|---|
| 1001 | A key went to the software key store because the TPM couldn't be used. It isn't hardware-protected. |
| 1004 | A key was retired. |
| 1005 | A process read a key file under the developer model. Investigate on any production machine. |
| 2002 | An existing key has an access list this library would never create. Investigate. |
| 2003 | Unwrap rejected a tampered, corrupted or misdirected key file. |
| 2006 | Something asked the library to read a file that looks like a plaintext key. Treat that key as exposed. |

Any local user can write to the Application log, so forward these events to your SIEM rather
than treating them as tamper-proof evidence.

## Retire a key

:::danger
Retiring a key deletes it, and **every DEK wrapped under it becomes permanently
unrecoverable.**
:::

Retire a key only after every application has moved to a new, versioned service name, and no
key file wrapped under the old one is still needed. From an elevated prompt:

```powershell
& "C:\Program Files\HkdfGuard\v1\hkdfguard.exe" retire --service-name com.example.myapp --fingerprint 3f1c...e09a
```

Pass the full 64-character fingerprint. `retire` deletes nothing unless it matches.
Applications can't delete a key: the library has no delete function.

## Troubleshooting

`hkdfguard.exe` exits `0` on success, `1` when the operation failed and `2` for a usage error.
On failure, it prints an `error:` line.

| Message contains | Likely cause | Fix |
|---|---|---|
| `no KEK is provisioned for this service` | `wrap` ran before `provision`, or the service name differs | Run `provision` elevated, with the same service name |
| `this account is not authorized to use it` | `provision` wasn't elevated, or the account isn't in a group on the key's access list | Run `provision` elevated. For `wrap` or unwrap, add the account to `HkdfGuardUsers` and restart the service. |
| `this account may not persist key files` | `wrap` ran as an account that isn't a deployer or an elevated administrator | Add the account to `HkdfGuardDeployers`, then sign in again |
| `hkdfguard_open_file would refuse to read a key file there` | The key folder can be changed by another account, for example anywhere under `C:\ProgramData` | Prepare a folder as in [step 5](#5-prepare-a-folder-for-key-files) |
| `KEK provider/key open or create failed` | Under `RequireTpm`, there is no usable TPM | Check `Get-Tpm`, and event 2005 for details |
| `invalid machine policy` | `KeyStoragePolicy` or `SecurityModel` has an invalid value | Correct or remove the value |
| `service name is missing or malformed` | The name breaks the service-name rules | Use ASCII letters, digits and dots only |

If an application reports status **-39** (`FILE_UNTRUSTED`), the library refused the key
file's path or its folder. Common causes:

- the path uses a short name or a link;
- the file is on a network drive;
- the file is in a folder another account can change.

Move the file to a folder prepared as in [step 5](#5-prepare-a-folder-for-key-files), and
wrap it again there.

An application that can't load the DLL usually has an architecture mismatch, or is loading it
by bare file name instead of from `InstallPath`.

## Next steps

- The [Installation and Administration Guide](https://github.com/runsecure/hkdfguard-native-windows/blob/main/docs/admin-guide.md)
  covers the rest:
  - every policy setting, including `KeyUseGroups`, `DeployerGroups`, `AuditUnwrapSuccess`
    and `SetupMinDelayMs`;
  - every event ID;
  - upgrades and uninstalling.
- The [hkdfguard-native-windows README](https://github.com/runsecure/hkdfguard-native-windows)
  documents the C API and the design.
- [SecurityAssumptions.md](https://github.com/runsecure/hkdfguard-native-windows/blob/main/SecurityAssumptions.md)
  covers what the design relies on, and known TPM vendor behavior.
