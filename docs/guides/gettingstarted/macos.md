---
title: Getting started on macOS
sidebar_label: macOS
sidebar_position: 2
description: Install HkdfGuard on an Apple silicon Mac, provision a Secure Enclave key for your service, and wrap your first data encryption key.
---

# Getting started on macOS

This guide takes one Mac from nothing to a working setup: the HkdfGuard native library
installed, a Secure Enclave key (KEK) provisioned for your service, and a first key file your
application can read. It then shows how to move that service to production mode, where it
runs as a LaunchDaemon and the duties are split between administrators.

New to HkdfGuard? Read the [overview](index.md) first.

:::note Pre-release
Versions `0.9.x` are for pre-release testing. The commands below use `0.9.0`; substitute the
version you download.
:::

## Requirements

- **Apple silicon** (M-series). The KEK is a Secure Enclave key, and Intel Macs aren't
  supported.
- **macOS 14 or later.**
- **Administrator rights**, to install the package.
- **A native arm64 runtime for your application.** An x64 .NET, Python, Node or Java runtime
  running under Rosetta can't load the arm64 library.

## What gets installed

The package installs into `/Library/Application Support/HkdfGuard/v1/`, every file owned by
`root:wheel`:

| File | Purpose |
|---|---|
| `libhkdfguard.dylib` | The library applications load |
| `hkdfguard.h` | Its C header |
| `hkdfguard` | The command-line tool (legacy keychain mode; see [Keychain modes](#keychain-modes)) |
| `hkdfguard.app` | The same tool built as an app bundle (data-protection keychain mode) |
| `SHA256SUMS` | Checksums of the files above |
| `uninstall.sh` | Removes all of it |

It also creates the symlink `/usr/local/bin/hkdfguard`, pointing at the tool, so `hkdfguard` is
on your `PATH`. It creates the link only when `/usr/local/bin` is owned by root and writable
by root alone. Otherwise, call the tool by its full path.

Every folder from `/` down to `/Library/Application Support` is owned by root and writable
only by root, so no other user can swap in a library of their own.

## 1. Download, verify and install

`sudo installer -pkg` checks nothing on its own: it installs an unsigned or re-signed package
without a warning. So check the package first, and install only if every check passes.

Take the expected SHA-256 from the release's notes on the
[Releases page](https://github.com/runsecure/hkdfguard-native-mac/releases), not from a
`.sha256` file downloaded beside the package. Whoever could replace the package could replace
that file too.

```sh
set -e
VERSION=v0.9.0
TEAM_ID=MFW3T8R8J3                      # the Team that signs HkdfGuard releases
EXPECTED=paste-the-sha256-from-the-release-notes
PKG="hkdfguard-native-macos-${VERSION#v}-osx-arm64.pkg"

gh release download "$VERSION" --repo runsecure/hkdfguard-native-mac --pattern "$PKG"
echo "$EXPECTED  $PKG" | shasum -a 256 -c                                     # the bytes released
pkgutil --check-signature "$PKG" | grep -q "Developer ID Installer: .* ($TEAM_ID)$"  # signed by that Team
spctl --assess --type install -v "$PKG"                                       # notarized, not revoked
sudo installer -pkg "$PKG" -target /
pkgutil --pkg-info com.hkdfguard.native                                       # the installed version
```

Each check exits non-zero on failure, and `set -e` stops before `installer` runs.

Double-clicking the package in Finder also works. For a fleet, upload it to your MDM (Jamf,
Intune, Kandji and others) and scope it to Apple silicon Macs; MDM tools check the installer
signature themselves.

Check the install:

```sh
ls -l "/Library/Application Support/HkdfGuard/v1"
hkdfguard --help
```

## Keychain modes

On macOS the KEK's keychain item lives in one of two keychains. The library picks one from the
**calling program's own code signature**, never from configuration:

| Mode | Used by | How access is decided |
|---|---|---|
| **legacy** | Any plain executable: the `hkdfguard` tool, and a `node`, `python3`, `java` or `dotnet` process, or your own binary, that loads the library | The user's login keychain. Each key's access list names the program that created it. Any other program gets a one-time "Always Allow" prompt in a logged-in session. |
| **data-protection** | A Team-signed **app bundle** with a `keychain-access-groups` entitlement and a provisioning profile | Decided by macOS from the app's signed identity: no prompts. |

The two keychains don't see each other. **Provision a service in the same mode its
applications run in**, or they report status -17 (no KEK). For a service written in .NET, Java,
Go, Node or Python, that is legacy mode, and the plain `hkdfguard` tool is the one to use.
Every command prints the mode it used.

## 2. Provision the key

There are two ways to run HkdfGuard on a Mac:

- **User-scoped** (development mode, and the default): one macOS user provisions, wraps and
  unwraps.
- **Machine-scoped** (production mode): administrators provision and wrap, and only a
  LaunchDaemon can unwrap. See [Production mode](#production-mode-machine-scoped-keys).

Start user-scoped. As **the account your application runs as**, without `sudo`:

```sh
hkdfguard provision --service-name com.example.myapp
```

```text
KEK provisioned for service "com.example.myapp" (keychain: legacy)
fingerprint: 3f1c...e09a -- record this; retire requires it
```

`provision` creates the key in the Secure Enclave, and stores the enclave's reference to it in
that user's login keychain. Running it again is safe: it verifies the existing key and changes
nothing.

**Record the fingerprint.** `wrap` can be told to insist on it, `retire` requires it, and a
later `provision` prints it again, so you can confirm the key hasn't been replaced.

:::warning One user does everything
A user-scoped key is visible only to the user who provisioned it. `provision`, `wrap` and the
application that unwraps must all run as that same user, in the same keychain mode. Another
user gets status -17, and running `provision` as them silently creates a second, unrelated key
under the same name. `sudo` doesn't bridge users.
:::

Check the key at any time. `status` never creates or deletes anything:

```sh
hkdfguard status --service-name com.example.myapp
```

```text
service: com.example.myapp
scope: user
keychain: legacy
kek: present
fingerprint: 3f1c...e09a
```

## 3. Wrap a DEK into a key file

`wrap` reads the DEK as base64 from standard input, so it never appears on a command line,
wraps it under the service's key, and writes a 125-byte key file. It never creates a key, and
fails if the service isn't provisioned.

The key file's folder must be owned by you or root and writable by no one else, all the way up
to `/`. Your home folder qualifies; `/tmp` and `/Applications` don't.

```sh
mkdir -p -m 0700 ~/Library/Application\ Support/MyApp/keys

head -c 32 /dev/urandom | base64 | hkdfguard wrap \
    --key-file-path ~/Library/Application\ Support/MyApp/keys/myapp.v1.key \
    --service-name com.example.myapp --dek-stdin \
    --fingerprint 3f1c...e09a
```

- `--fingerprint` makes `wrap` refuse to write the file unless the DEK was sealed to the key you
  recorded at `provision`. Use it in every scripted pipeline.
- The key file is written `0600`. Add `--group name` to make it `0640` and readable by that
  group.
- `--force` securely overwrites an existing key file.
- `--dek-file path` reads the DEK from a file instead: a regular file, owned by you or root,
  mode `0400` or `0600`. Prefer standard input; a file leaves the key on disk until you delete
  it.

:::warning Where the DEK comes from
This example makes a new DEK only to show the steps. In a real deployment the DEK comes from
your release pipeline: it is the key your pipeline encrypted the application's secrets with,
for example with a language library's pipeline data protector. Never pass a DEK as a
command-line argument or an environment variable.
:::

## 4. Use the key from your application

**With an HkdfGuard language library** (.NET, Java, Go, Node or Python), configure the service
name and the key file's full path. The library loads `libhkdfguard.dylib` from the install
location, after checking that every folder above it is root-owned and that it carries the
HkdfGuard release signature.

**Calling the C API directly**, load the library only by its absolute path,
`/Library/Application Support/HkdfGuard/v1/libhkdfguard.dylib`, never from a search path or a
path taken from configuration. Check its signature first:

```sh
/usr/bin/codesign --verify --strict -R='=identifier "libhkdfguard" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "MFW3T8R8J3"' \
    "/Library/Application Support/HkdfGuard/v1/libhkdfguard.dylib"
```

Then call `hkdfguard_open_file` to read the key file, and `hkdfguard_unwrap_dek` with the
service name to recover the 32-byte DEK. Do both once at startup, and zero the DEK when you're
done.

### The first unwrap asks for permission

The key's access list names the program that created it: the `hkdfguard` tool. The first time
your application uses the key in a logged-in session, macOS asks whether to allow it. Choose
**Always Allow**. Without a UI session (SSH, a daemon outside a login session), the library
reports status -18 instead. Run user-scoped applications as a LaunchAgent inside a logged-in
session.

That approval belongs to the program's **main executable**, which has a consequence for
interpreted languages:

- Run as `node app.js`, `python3 app.py`, `java -jar app.jar` or `dotnet App.dll`, the approved
  program is the shared runtime. Every other script that runtime runs as the same user then
  passes too, with no prompt.
- Run as **its own executable** (a .NET apphost or single-file publish, a Go binary, a
  PyInstaller binary), the approval covers that program alone.

So ship a production consumer as its own executable, signed with your Developer ID. A
Developer ID signature is matched by its Team, so rebuilds keep the approval; an unsigned or
ad-hoc signed program is matched by its hash, so every rebuild asks again. **Never approve a
shared interpreter** for a production key unless every program it may run as that user is
equally trusted.

## Production mode: machine-scoped keys

A user-scoped key suits development, and a service that runs in one user's session. A
production **policy** makes chosen services machine-scoped instead.

HkdfGuard installs no daemon of its own. In production mode, *your application* runs as a
LaunchDaemon, and `hkdfguard` briefly starts a one-off system job of its own while it provisions
or wraps.

The duties split three ways:

| Role | Does | As |
|---|---|---|
| Security admin | `provision`, `retire` | an administrator, with `sudo` |
| Deployment admin | `wrap` | an administrator, with `sudo` |
| Application | unwraps | a LaunchDaemon running as the service's account |

A machine-scoped key works logged out, at the login window, and after an unattended restart,
and survives password resets and account changes, which a user's keychain doesn't. It is
usable only from LaunchDaemons: a process in a login session (Terminal, `sudo`, a GUI app, SSH)
gets status -18.

### 1. Create the service account

Run the service as a dedicated hidden account that can't log in, and make it the only member
of its own group. People must never be members: that group is what can read the key.

```sh
# Pick an unused ID below 500 for both.
sudo dseditgroup -o create -i 450 -r "MyApp service" _myapp
sudo dscl . -create /Users/_myapp
sudo dscl . -create /Users/_myapp UniqueID 450
sudo dscl . -create /Users/_myapp PrimaryGroupID 450
sudo dscl . -create /Users/_myapp UserShell /usr/bin/false
sudo dscl . -create /Users/_myapp NFSHomeDirectory /var/empty
sudo dscl . -create /Users/_myapp IsHidden 1
sudo dseditgroup -o edit -a _myapp -t user _myapp
```

The library refuses a runner group that covers too many accounts, such as `staff`, `everyone`
or `admin`.

### 2. Write the policy

On a managed Mac, deliver the policy as a configuration profile for the preference domain
`com.hkdfguard`, scoped to the device (Jamf "Application & Custom Settings", an Intune custom
profile, and so on). On a Mac without MDM, write the same keys to
`/Library/Application Support/HkdfGuard/policy.plist`, owned by `root:wheel`, mode `0644`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MachineServices</key>
  <dict>
    <key>com.example.myapp</key>
    <dict><key>RunnerGroup</key><string>_myapp</string></dict>
  </dict>
  <key>SecurityAdminGroup</key><string>secadmins</string>
  <key>DeploymentAdminGroup</key><string>deployers</string>
</dict>
</plist>
```

- **`MachineServices`** lists the machine-scoped services, each with the group of the account
  that runs it. Services not listed stay user-scoped.
- **`SecurityAdminGroup`** and **`DeploymentAdminGroup`** name the administrators allowed to
  provision and to wrap. Leave one out, and any administrator who can `sudo` may act in that
  role.

The policy is checked strictly. An unknown key (a misspelling), a wrong type, or a file that
isn't root's makes **every** call fail with status -9 until it is fixed, so a typo can't
quietly leave a production service user-scoped. `hkdfguard status` prints the reason.

### 3. Provision and wrap

```sh
# Security admin, once:
sudo hkdfguard provision --service-name com.example.myapp
#   machine KEK provisioned for service "com.example.myapp" at
#     /Library/Application Support/HkdfGuard/keks/com.example.myapp.kek (runner group: _myapp)
#   fingerprint: 3f1c...e09a -- record this; retire requires it

# A root-owned folder for the key file:
sudo install -d -o root -g wheel -m 0755 "/Library/Application Support/MyApp"

# Deployment admin, every release:
head -c 32 /dev/urandom | base64 | sudo hkdfguard wrap \
    --key-file-path "/Library/Application Support/MyApp/myapp.v1.key" \
    --service-name com.example.myapp --dek-stdin --fingerprint 3f1c...e09a
```

- **The role is checked against the administrator behind `sudo`**, the account signed in to the
  session. `sudo` alone isn't enough.
- **The Secure Enclave step runs in a short-lived system job.** The Secure Enclave binds a key to
  the context that created it, so a key made from Terminal would be unusable by the daemon.
  `provision` and `wrap` hand that step to a one-off LaunchDaemon job, and pass the DEK to it
  through a root-only pipe, so it never touches disk.
- **`wrap` gives the key file to the runner group** (`0640`), so the daemon can read it.

### 4. Run the service as a LaunchDaemon

Install a LaunchDaemon that runs as the service account, for example
`/Library/LaunchDaemons/com.example.myapp.plist`, owned by `root:wheel`, mode `0644`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.myapp</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/libexec/myapp</string></array>
  <key>UserName</key><string>_myapp</string>
  <key>GroupName</key><string>_myapp</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```sh
sudo launchctl bootstrap system /Library/LaunchDaemons/com.example.myapp.plist
```

The application calls the same functions as in user-scoped mode. Only `root` and members of the
runner group can read the key, and only from a LaunchDaemon. Root is trusted: an administrator
who can `sudo` can ultimately use the key, as with every secret store on macOS. If
administrators reaching the Mac over SSH is a concern, turn off Remote Login through MDM.

To test the whole flow on a Mac, the native repository includes
`scripts/verify-machine-scope.sh`; run it as root against a test machine without a real
policy.

## Monitor it

Every key operation is recorded in the unified log, subsystem `com.hkdfguard`, category
`audit`, with the same event IDs as Windows and Linux:

```sh
/usr/bin/log show --last 1h --info \
    --predicate 'subsystem == "com.hkdfguard" AND category == "audit"'
```

Use the full path: in zsh, `log` is a shell builtin. Console.app shows the same records live.
Any process can write to the unified log, so forward it to your SIEM rather than treating it
as tamper-proof evidence.

## Retire a key

:::danger
Retiring a key deletes it, and **every DEK wrapped under it becomes permanently
unrecoverable.**
:::

Retire a key only after the service has moved to a new, versioned service name and nothing
wrapped under the old one is needed:

```sh
hkdfguard retire --service-name com.example.myapp --fingerprint 3f1c...e09a        # user-scoped
sudo hkdfguard retire --service-name com.example.myapp --fingerprint 3f1c...e09a   # machine-scoped
```

`retire` deletes nothing unless the fingerprint matches. Run it in the same keychain mode, and
as the same user, that provisioned the key. In legacy mode it can only delete a key the tool
itself created.

## Uninstall

```sh
sudo "/Library/Application Support/HkdfGuard/v1/uninstall.sh"
```

Uninstalling removes the library, the tool and the `PATH` symlink. **Keys aren't touched.**
User-scoped keys stay in each user's keychain. Machine-scoped keys stay in
`/Library/Application Support/HkdfGuard/keks`, outside `v1/`, as does a local `policy.plist`.
Retire any key that should go *before* uninstalling, while the tool still exists.

## Troubleshooting

`hkdfguard` exits `0` on success, `1` when the operation failed and `2` for a usage error.

| Status | Meaning | Fix |
|---|---|---|
| -17 | No key for this service in this process's keychain mode | Run `provision` as the same user, in the same mode as the application |
| -18 | The keychain wouldn't answer: locked, no UI session for the prompt, the prompt was declined, or (machine-scoped) the caller isn't a LaunchDaemon in the runner group | Run user-scoped applications in a logged-in session and choose Always Allow; run machine-scoped ones as a LaunchDaemon |
| -19 | A keychain item exists but isn't a usable key | Investigate, then `hkdfguard retire --corrupt` and provision again |
| -16 | The key file was wrapped under a different key | Use the service name the file was made for, or wrap it again |
| -11 | The key file was altered, or made for a different service | Restore it from your deployment, or wrap it again |
| -9 | The production policy is invalid | Run `hkdfguard status` to see why, and fix the policy |
| -39 | The key file, or a folder above it, can be changed by someone other than its owner or root | Move it to a folder that only you or root can write |
| -37 | The key file holds an *unwrapped* key | Treat that key as exposed: delete the file, and rotate the DEK |

## Next steps

- The [hkdfguard-native-mac README](https://github.com/runsecure/hkdfguard-native-mac)
  documents the C API, every status code, both keychain modes, production mode in depth,
  building from source, and the release process.
- [Separation of duties](../separationofduties.md) compares development and production modes
  on every platform.
