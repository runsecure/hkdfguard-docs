---
title: Windows key wrapper
sidebar_label: Windows
sidebar_position: 1
description: The exact cryptographic construction and payload format of HkdfGuard's Windows key wrapper, over the TPM or the Windows software key store.
---

# Windows key wrapper

`HkdfGuard.dll` wraps a 32-byte DEK under a P-256 KEK that a Windows key storage provider (KSP)
holds. It uses the [shared construction](index.md#the-shared-wrap-construction) through Windows
CNG and NCrypt. Every payload is exactly **132 bytes**.

## The KEK

| Property | Value |
|---|---|
| Algorithm | P-256 (ECDH), non-exportable |
| Held by | The **Microsoft Platform Crypto Provider** (the TPM or vTPM), or the **Microsoft Software Key Storage Provider** |
| Scope | Machine-wide (`NCRYPT_MACHINE_KEY_FLAG`), not tied to the account that created it |
| Created by | `hkdfguard_create_kek` only, from an elevated process. Wrapping and unwrapping never create one. |
| Access | The key's own access list: SYSTEM and Administrators always, plus the groups machine policy names when it is created |
| Opened with | `NCRYPT_SILENT_FLAG`, so a key that would need a UI prompt fails instead |

The `KeyStoragePolicy` machine policy chooses the provider:

- `PreferTpm`, the default, uses the TPM when one is usable and the software provider otherwise.
- `RequireTpm` uses the TPM or fails. It also refuses, on unwrap, a payload that routes to a
  software key.
- `SoftwareOnly` always uses the software provider.

Under `PreferTpm`, a TPM that errors, or an existing TPM key that fails verification, fails the
call instead of quietly falling back. Every payload records which provider protected it.

Every create, open and use verifies the key's properties and access list. A newly created key
that fails any check is deleted by the same call. An existing key is never deleted or replaced by
the library; only the `hkdfguard retire` command deletes one, after the operator confirms its
fingerprint.

## Wrapping

1. **Draw** a 32-byte salt and a 12-byte nonce from `BCryptGenRandom`.
2. **Hash the salt to a point:** `H = PayloadEcdhPoint(salt)`, the shared try-and-increment hash.
   H is also validated as a genuine P-256 point by importing it through the Microsoft software
   provider, before any key storage provider sees it.
3. **Agree on a shared secret** with `NCryptSecretAgreement(KEK, H)` on the KEK's own provider.
   For a TPM key, this runs inside the TPM, and takes about 10 ms. The secret is taken out raw
   (`BCRYPT_KDF_RAW_SECRET`), and reversed from CNG's little-endian order to big-endian.
4. **Build the authenticated bytes:** the header (bytes 0 to 39) followed by the KEK fingerprint.
5. **Derive the wrapping key** with HKDF-SHA512 (a self-contained implementation over CNG's
   HMAC-SHA512):
   - salt: the payload's salt;
   - IKM: Z, big-endian;
   - info: `"hkdfguard-wrap-v1:" || u16le(len(service)) || service || authenticated bytes`;
   - output: 32 bytes.
6. **Seal** the DEK with AES-256-GCM (`BCryptEncrypt`), with the authenticated bytes as AAD.

The shared secret, the wrapping key and every intermediate buffer are wiped before the call
returns. A golden payload in the test suite pins the derivation.

## Payload layout

All integers are little-endian. The layout is the same whichever provider produced it.

| Offset | Size | Field | Notes |
|---:|---:|---|---|
| 0 | 1 | Version | `1` |
| 1 | 1 | ProviderType | `1` = Platform Crypto Provider (TPM), `2` = Software Key Storage Provider |
| 2 | 2 | Reserved | Must be `0` |
| 4 | 4 | KeyId | Always `1` in this version. A new KEK means a new service name, not a new KeyId. |
| 8 | 32 | Salt | Random per payload: hashed to the ECDH point, and HKDF's salt |
| 40 | 12 | Nonce | AES-GCM IV |
| 52 | 32 | Ciphertext | The AES-256-GCM encrypted DEK |
| 84 | 16 | Tag | AES-GCM tag |
| 100 | 32 | KekFingerprint | `SHA-256(X \|\| Y)` of the KEK's public key: the raw 64-byte point, **without** a `0x04` prefix |

The **authenticated bytes** are bytes 0 to 39 (Version, ProviderType, Reserved, KeyId, Salt)
followed by the KekFingerprint. Everything a parser reads or routes on is authenticated: a payload
whose version, provider type or KeyId was rewritten fails, even when the rewritten value would
parse. The nonce isn't in the authenticated bytes, because AES-GCM generates it after they are
fixed. GCM authenticates it inherently: a different nonce changes both the keystream and the tag.

## Unwrapping

Each step runs only if the one before it passed:

1. **Parse the payload.** It must be exactly 132 bytes, version `1`, with Reserved `0`, a known
   ProviderType and KeyId `1`. Otherwise it is rejected (-10 malformed, or -12 for an unknown
   version) before any key is touched.
2. **Open the KEK**, chosen by the service name, the ProviderType and the KeyId. Under
   `RequireTpm`, a software ProviderType is refused here.
3. **Compare the fingerprint** of the opened KEK with the payload's KekFingerprint. A mismatch is
   -16, with no ECDH spent.
4. **Recompute H, Z and the wrapping key** as above.
5. **Open with AES-256-GCM.** A tag that doesn't verify is -11: the payload was altered, or
   opened under the wrong service.

`BCryptDecrypt` can write unauthenticated plaintext into the output buffer before it reports a
tag mismatch. So on **any** failure, unwrap zeroes the caller's whole output buffer.

## Key files

`hkdfguard_open_file` reads a key file and returns the payload **still wrapped**. It never opens
a KEK. Before reading, it refuses a path that could have been planted or swapped:

- symbolic links, junctions and other reparse points, at the path or above it;
- 8.3 short names;
- UNC, mapped, SUBST and device paths;
- a file or folder that an untrusted account can write, delete, rename or re-permission;
- a folder below the drive root that lets an untrusted account create entries in it.

Who counts as trusted follows the [security model](../separationofduties.md#windows). The file
must be exactly 132 bytes. A file that holds what looks like an *unwrapped* DEK (32 raw bytes, or
64 hex digits, or base64 of 32 bytes) is refused as -37 and logged as event 2006, without its
contents being returned or logged.

## Process hardening

`hkdfguard_harden_process` is an opt-in, same-user barrier around the process that holds an
unwrapped DEK. It:

- leaves the heap out of Windows Error Reporting crash reports;
- replaces the process's and its current threads' access lists, so only SYSTEM can read or write
  the process's memory, inject threads or duplicate its handles.

The strict form (`HKDFGUARD_HARDEN_REQUIRE_PROTECTED_SIGNATURE`) also replaces the token's default
access list and the token's own, so threads started later are closed too. The `hkdfguard` tool
uses the strict form, and holds the DEK it reads in one `VirtualLock`ed buffer that is wiped before
it is freed.

## Audit

Every wrap and unwrap writes an event to the Windows Application log. Each records the KEK
fingerprint and a SHA-256 of the payload. Both are public and reveal nothing about the DEK, but
they tie each unwrap to the wrap that produced it, which makes a replayed older payload visible.
No key material is ever logged.

## Source

The construction is in
[hkdfguard-native-windows](https://github.com/runsecure/hkdfguard-native-windows):

| File | What it holds |
|---|---|
| `src/hash_to_curve.cpp` | The salt-to-point hash |
| `src/ecdh_hkdf.cpp` | ECDH, HKDF and the fingerprint |
| `src/aes_gcm.cpp` | AES-256-GCM |
| `src/wire_format.h` | The payload layout |
| `src/kek_store.cpp` | KEK creation and verification |

`SecurityAssumptions.md` lists what the design relies on, and known TPM vendor behavior.
