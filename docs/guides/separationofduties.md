---
title: Separation of duties
sidebar_position: 2
description: How HkdfGuard's production and developer modes split key administration, deployment and use between separate accounts on Windows, macOS and Linux.
---

# Separation of duties: production and developer modes

HkdfGuard protects a data encryption key (DEK) by wrapping it under a key encryption key (KEK)
that the TPM, Secure Enclave or HSM holds. That protects the key from being *read*. Separation
of duties protects it from being *replaced*: it decides who may create a KEK, who may write
the key files an application trusts, and who may only use them.

Every platform has two modes:

- **Production**, the default. Three roles, held by different accounts.
- **Developer.** One account does everything, which is what you want on a development machine
  and never on a production one.

## Why it matters

A key file is ciphertext, so anyone may read it. The danger is someone *writing* one.

Suppose an attacker controls your application's account. If that account could write a key
file its own service would trust, the attacker could wrap a DEK they know, and plant it. From
then on, everything the application encrypts would be readable by them. They could also
plant an older, genuine key file to roll the application back to an earlier DEK. Neither
attack needs the KEK to leave the hardware.

Production mode closes that path by giving the work to three roles:

| Role | Does | Can't |
|---|---|---|
| **Security admin** | Creates (provisions) and retires KEKs | (Holds the most power: keep this role small) |
| **Deployer** | Wraps each release's DEK into a key file the application will trust | Create or retire a KEK |
| **Application** | Reads key files and unwraps them. May wrap and unwrap keys in memory. | Create a KEK, or (on Windows and Linux) write a key file its own service would trust |

Each step of the [deployment workflow](gettingstarted/index.md#the-workflow) then belongs to a
different account:

```text
security admin           deployer                       application
--------------           --------                       -----------
provision the KEK  -->   wrap the release's DEK   -->   read the key file
(once per service)       into a key file                unwrap the DEK
record fingerprint       (every release)                (every start)
```

Compromising the application gives an attacker the DEK it already holds, but not the
ability to choose the next one. Compromising a deployer lets an attacker write key files, but
not create or retire keys.

## Developer mode

In developer mode one account may provision, wrap a key file and read it back. That makes a
development machine usable without three accounts, and it is exactly the shortcut production
mode exists to prevent. On every platform:

- **Use it on development machines only.**
- Treat any production machine found in developer mode as a security event. Windows and Linux
  log event **1005** the first time each process reads a key file under it.

## How each platform implements it

The roles are the same on every platform. How they are enforced follows each operating
system's own security model.

### Windows

Set by the `REG_DWORD` value `HKLM\Software\Policies\HkdfGuard\SecurityModel`:

| Value | Mode |
|---|---|
| absent or `0` | **Production** (the default) |
| `1` | **Developer** |

Any other value, or a value of the wrong type, makes every key-file read and every `wrap`
fail. It isn't treated as the default.

| Role | Production |
|---|---|
| Security admin | A local administrator, from an elevated prompt. Creating a KEK always needs elevation, in either mode. |
| Deployer | A member of the `HkdfGuardDeployers` group (created by the installer), or of a group listed in the `DeployerGroups` policy. Only user and service accounts added *directly* count: a group nested inside it is ignored. |
| Application | The service's account, a member of `HkdfGuardUsers` |

Under production, the library trusts a key file only if the file, and every folder above it,
is owned by one of:

- SYSTEM, Administrators or TrustedInstaller;
- a deployer group, or a direct member of one.

No other account may change them. `hkdfguard.exe wrap` refuses to write a key file for any
account that isn't a deployer or an elevated administrator. The key folder's permissions
(deployers Modify, applications Read) stop an application overwriting a deployed file.

Under developer, the library also trusts key files that the reading account owns.

```powershell
reg add HKLM\Software\Policies\HkdfGuard /v SecurityModel /t REG_DWORD /d 1 /f   # developer machines only
& "C:\Program Files\HkdfGuard\v1\hkdfguard.exe" status --service-name com.example.myapp   # shows the model in force
```

Deployer membership is checked every time a key file is opened. Remove someone from
`HkdfGuardDeployers`, and the key files they own stop being trusted: redeploy them under a
current deployer first. See [Getting started on Windows](gettingstarted/windows.md#3-decide-who-can-use-the-key).

### Linux

Set by `security_model` at the top of `/etc/hkdfguard/policy.toml`, above the first
`[section]`:

```toml
security_model = "production"            # the default, with or without a policy file
deployer_groups = ["payments-deployers"] # optional, besides hkdfguard-deployers
```

Any other value (`"development"` included) makes the policy invalid, and every call fails.

| Role | Production |
|---|---|
| Security admin | root. Only root creates a KEK that doesn't exist yet, or retires one. |
| Deployer | root, or a direct member of `hkdfguard-deployers` (created by the packages) or of a group in `deployer_groups` |
| Application | Any other account the provider lets use the KEK |

Under production, the library trusts a key file only under these conditions:

- The file, and every folder above it up to `/`, is owned by root or a deployer.
- It is writable only by its owner, or through a deployer group.

So a key file the application's own account wrote is refused, and `hkdfguard wrap` refuses
anyone who isn't root or a deployer before it reads the DEK.

Under developer, anyone who can reach the provider may create a KEK, and key files owned by root
or the reading account are trusted.

On a **TPM** host, "only root creates a KEK" depends on `tpm.require_pinned_names = true`. The
TPM otherwise derives a key for any service name on demand. With it, a service has a key only
once root has provisioned it and added its TPM Name to the root-owned policy. **Set it on every
production TPM host.** On PKCS#11 the rule is enforced directly. An external secret is
provisioned by whoever delivers the file.

Group membership is looked up on every call, through NSS, so LDAP and sssd groups count.
See [Getting started on Linux](gettingstarted/linux.md#5-prepare-a-folder-for-key-files).

### macOS

macOS draws the line differently, because its keychains are per user:

| Mode | When | KEK | Roles |
|---|---|---|---|
| **Development** (user-scoped) | No policy, or a service the policy doesn't list | In one user's keychain, invisible to every other user | One user provisions, wraps and unwraps |
| **Production** (machine-scoped) | Services listed under `MachineServices` in the policy | A system key, usable only by LaunchDaemons running as the service's `RunnerGroup` | Split, as below |

The production policy is a configuration profile for the preference domain `com.hkdfguard`,
or the file `/Library/Application Support/HkdfGuard/policy.plist`:

| Role | Production | Set by |
|---|---|---|
| Security admin | Runs `sudo hkdfguard provision` and `retire` | `SecurityAdminGroup` |
| Deployer | Runs `sudo hkdfguard wrap` | `DeploymentAdminGroup` |
| Application | A LaunchDaemon running as a member of the service's runner group | `RunnerGroup`, per service |

The roles are checked against the administrator *behind* `sudo`: the account signed in to the
session. Leave a group out, and any administrator who can `sudo` may act in that role.

Some differences from Windows and Linux:

- **Using a machine-scoped key is limited to LaunchDaemons.** A process in a login session
  (Terminal, `sudo`, SSH, a GUI app) gets status -18, and so does an account outside the runner
  group.
- **There is no deployer group for key files.** The library trusts a key file owned by the
  reading account or by root. Keep the service's key folder owned by root (for example
  `/Library/Application Support/MyApp`, `root:wheel 0755`), and the file written by
  `sudo hkdfguard wrap`, so the service's own account can't replace it.
- **Root is trusted.** An administrator who can `sudo` can ultimately use any key, as with every
  secret store on macOS. If administrators reaching a Mac over SSH is a concern, turn off Remote
  Login through MDM.

See [Getting started on macOS](gettingstarted/macos.md#production-mode-machine-scoped-keys).

## Side by side

| | Windows | Linux | macOS |
|---|---|---|---|
| Switch | `SecurityModel` registry value | `security_model` in `policy.toml` | `MachineServices` in the policy, per service |
| Default | Production | Production | Development (user-scoped) until a policy lists the service |
| Security admin | Elevated local administrator | root | `SecurityAdminGroup`, through `sudo` |
| Deployer | `HkdfGuardDeployers`, `DeployerGroups` | root, `hkdfguard-deployers`, `deployer_groups` | `DeploymentAdminGroup`, through `sudo` |
| Application | `HkdfGuardUsers` | The provider's own access (`tss`, the derivation secret's group) | LaunchDaemon in the `RunnerGroup` |
| Key files trusted from | SYSTEM, Administrators, TrustedInstaller, deployers | root, deployers | root, or the reading account |
| Developer mode | `SecurityModel` = `1` | `security_model = "developer"` | No policy for the service |
| Invalid setting | Every key-file read and `wrap` fails | Every call fails | Every call fails |

## Recommendations

1. **Leave production mode on in production.** Developer mode exists so a developer can work
   with one account. Check for it with `hkdfguard status` (Windows and macOS) or by reading the
   policy (Linux), and alert on event 1005.
2. **Keep the three roles in three accounts.** A deployer shouldn't be a local administrator or
   a member of `wheel`. An application's account should be neither. If one account holds two
   roles, the separation exists only on paper.
3. **Run deployments from a dedicated deployer account,** such as your CI agent's service
   account, rather than a person's account.
4. **Record every KEK's fingerprint at provisioning**, and pass it to `wrap --fingerprint` where
   the platform supports it. A changed fingerprint means the KEK under that name was replaced.
5. **Keep key folders owned by root or administrators,** writable only by deployers, and never
   under shared folders such as `C:\ProgramData` or `/tmp`.
6. **Removing a deployer untrusts their key files** on Windows and Linux. Redeploy those files
   under a current deployer first.
7. **Forward audit events to your SIEM.** Every platform logs the same event IDs. Retirement
   (1004), developer-mode reads (1005), unexpected access lists (2002) and plaintext keys on
   disk (2006) are good alerts.
