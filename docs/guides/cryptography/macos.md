---
title: macOS key wrapper
sidebar_label: macOS
sidebar_position: 2
description: The exact cryptographic construction and payload format of HkdfGuard's macOS key wrapper over the Secure Enclave.
---

# macOS key wrapper

`libhkdfguard.dylib` wraps a 32-byte DEK under a P-256 KEK that lives in the Mac's **Secure
Enclave**. It uses the [shared construction](index.md#the-shared-wrap-construction), with
CryptoKit doing every primitive. Every payload is exactly **125 bytes**.

## The KEK

The KEK is a `SecureEnclave.P256.KeyAgreement.PrivateKey`. Its private half is generated inside
the Secure Enclave and can only be *used* there, never extracted. What is stored outside the
enclave is the enclave's opaque, device-bound reference to the key: its data representation.

| | User-scoped (development mode) | Machine-scoped (production mode) |
|---|---|---|
| Reference stored in | A keychain item: the login keychain (legacy mode), or the data-protection keychain under an access group | A KEK file, `/Library/Application Support/HkdfGuard/keks/service.kek`, owned by root, mode `0640` to the service's runner group |
| Usable | While the user's keychain is unlocked (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) | After the first unlock since boot (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), from LaunchDaemons only |
| Access control | `privateKeyUsage` only: no user-presence or biometric prompt | The KEK file's permissions, plus the Secure Enclave binding the key to the system context that created it |
| Leaves the device | Never. Not synchronized to iCloud; no backup or restore carries it. | Never |

Creating a key is explicit: only `hkdfguard_create_kek` creates one. Every wrap and unwrap
requires an existing key, and fails with -17 otherwise.

The **fingerprint** is `SHA-256(0x04 || X || Y)`: the KEK's public key in uncompressed SEC1 form
(CryptoKit's x963 representation).

## Wrapping

1. **Draw** a 32-byte salt and a 12-byte nonce from `SecRandomCopyBytes`.
2. **Build the header:** `fingerprint || 0x01 || salt || nonce`. The suite byte `0x01` names this
   construction.
3. **Hash the salt to a point** H, with the shared try-and-increment hash.
4. **Agree on a shared secret:** the Secure Enclave computes `Z = ECDH(KEK, H)`
   (`sharedSecretFromKeyAgreement`).
5. **Derive the wrapping key** with CryptoKit's HKDF over SHA-512:
   - salt: the payload's salt;
   - info: `"hkdfguard-wrap-v1:" || u16le(len(service)) || service || header`;
   - output: 32 bytes.
6. **Seal** the DEK with `AES.GCM.seal`, the nonce above and the header as authenticated data.
   The DEK is sealed straight from the caller's buffer, without a copy.

## Payload layout

| Offset | Size | Field | Notes |
|---:|---:|---|---|
| 0 | 32 | KEK fingerprint | `SHA-256(0x04 \|\| X \|\| Y)` |
| 32 | 1 | Suite | `0x01`: ECDH against a hashed point, then HKDF-SHA512, then AES-256-GCM |
| 33 | 32 | Salt | Random per payload: hashed to the ECDH point, and HKDF's salt |
| 65 | 12 | Nonce | AES-GCM nonce |
| 77 | 32 | Ciphertext | The AES-256-GCM encrypted DEK |
| 109 | 16 | Tag | AES-GCM tag |

The **header** is bytes 0 to 76: everything before the ciphertext, nonce included. It is bound
into the key through HKDF's info, together with the service name, and checked by the tag as AAD.
So neither the fingerprint nor the suite byte can be rewritten. A payload sealed for one service
can't be opened under another, even if both somehow resolved to the same KEK.

The suite byte is the hook for a future construction: a payload is dispatched on it at parse
time, before any keychain or enclave work.

## Unwrapping

Each step runs only if the one before it passed:

1. **Check the length and output capacity.** The payload must be exactly 125 bytes (-10
   otherwise), and the output buffer must hold 32 bytes. Both are checked before the keychain or
   enclave is touched, so a sizing call costs nothing, and a DEK is never decrypted for a caller
   who can't receive it.
2. **Check the suite byte.** Anything but `0x01` is -12: a payload from a different build, not
   tampering.
3. **Load the KEK** from the keychain or KEK file, for the lowercased service name.
4. **Compare the fingerprint** with the KEK's public key. A mismatch is -16, with no enclave work
   spent.
5. **Recompute H and Z in the Secure Enclave.** If the enclave refuses the key agreement (for
   example, a locked session), that is -5: a fact about this machine, not about the payload.
6. **Open with AES-256-GCM.** A tag that doesn't verify is -11: the payload was altered, or sealed
   for a different service.

On any failure, every byte of the caller's output buffer is zeroed.

## Key files

`hkdfguard_open_file` reads a 125-byte payload without touching the keychain or the enclave, and
validates its structure:

- a fingerprint of all zeros, or an unknown suite byte, is -38;
- a file that holds what looks like an unwrapped DEK (raw, hex or base64) is -37. That check runs
  in constant time, and never decodes the contents.

It refuses, as -39:

- a file reached through a symbolic link;
- a file owned by anyone other than the reading user or root, or writable by anyone else;
- a file with an access control list that lets someone else change it;
- a file in a folder, anywhere up to `/`, that someone else can add to, remove from or rename
  entries in;
- a file on a volume mounted with ownership ignored, such as a user-mounted disk image.

## Process hardening

`hkdfguard_harden_process` turns core dumps off (`RLIMIT_CORE` 0, hard limit included) and denies
debugger attachment (`PT_DENY_ATTACH`).

On macOS, what really stops another process of the same user from reading memory is the *host
executable's* code signature: the Hardened Runtime without `get-task-allow` or the `DYLD_*`
entitlements. The library checks that signature but can't change it. The strict form fails unless
the signature is protected; otherwise a weak signature is only logged.

## Audit

Every wrap and unwrap writes a record to the unified log, subsystem `com.hkdfguard`, category
`audit`, with the same event IDs as Windows and Linux. Records carry the KEK fingerprint and a
SHA-256 of the payload, never key material.

## Source

The construction is in `HkdfGuardNativeMacOS/HkdfGuardNativeMacOS.swift` in
[hkdfguard-native-mac](https://github.com/runsecure/hkdfguard-native-mac):

| Function | What it does |
|---|---|
| `payloadECDHPoint` | The salt-to-point hash |
| `deriveWrappingKey` and `wrappingKeyInfo` | ECDH and HKDF |
| `wrapDekCore` | Builds and seals the payload |
| `kekFingerprint` | The fingerprint |
