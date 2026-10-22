---
title: Cryptography
sidebar_label: Overview
sidebar_position: 0
description: How HkdfGuard wraps data encryption keys under a hardware-held key, and how the language libraries encrypt data with them.
---

# Cryptography

HkdfGuard has two layers, and each does one cryptographic job:

1. **The native key wrapper**, one per operating system, protects a 32-byte **data encryption
   key (DEK)** under a **key encryption key (KEK)** that the TPM, Secure Enclave or HSM holds.
   It turns a DEK into a wrapped payload, the contents of a key file, and back.
2. **The language libraries** (.NET, Java, Go, Node.js, Python) use the unwrapped DEK to encrypt
   your data with AES-256-GCM.

This section describes both, precisely enough to review. The platform pages give each native
wrapper's exact construction and byte layout:

- [Windows: TPM and the Windows key storage providers](windows.md)
- [macOS: the Secure Enclave](macos.md)
- [Linux: TPM 2.0, PKCS#11, external secrets](linux.md)

## The shared wrap construction

All three native wrappers use the same construction, built from standard primitives:

```text
ECDH (P-256, against a per-payload hashed point)  ->  HKDF-SHA512  ->  AES-256-GCM
```

To wrap a DEK:

1. **Draw a random 32-byte salt.**
2. **Hash the salt to a P-256 point, H.** Try-and-increment: for counter = 0, 1, 2 and so on,
   compute `X = SHA-256("HkdfGuard-P256-payload-ECDH-point-v1:" || salt || counter)`. The first X
   that is a valid P-256 x-coordinate gives H, taking the point with even Y (SEC1 prefix `0x02`).
   About half of all candidates are valid, so this takes a couple of tries. Failing all 255
   attempts has a negligible probability.
3. **Compute `Z = ECDH(KEK private key, H)` inside the hardware.** This needs the KEK's private
   key, which never leaves the TPM, Secure Enclave or HSM.
4. **Derive the wrapping key with HKDF-SHA512:**
   - salt: the payload's salt;
   - input key material: `Z`, big-endian;
   - info: `"hkdfguard-wrap-v1:" || u16le(len(service)) || service || authenticated header`;
   - output: the first 32 bytes, the AES-256 key.
5. **Seal the DEK with AES-256-GCM**, with a random 12-byte nonce, the payload's authenticated
   header as additional authenticated data (AAD), and a 16-byte tag.

The payload records the salt, so unwrapping recomputes the same point, the hardware recomputes the
same `Z`, and HKDF the same key.

The **service name** is lowercased, after being checked to be ASCII, and is never stored in the
payload. It is bound into the key through HKDF's info, so a payload opened under the wrong
service derives the wrong key, and its tag fails.

The **KEK fingerprint**, the SHA-256 of the KEK's public key, travels in the payload. Unwrap
compares it with the service's current KEK *before* any key agreement. That makes "wrong key"
(status -16) a cheap, distinct error from "tampered" (status -11), and costs no TPM operation.
The fingerprint is a check, never a lookup: the KEK is always chosen by the service name and
the payload's routing fields, then compared.

### Why a hashed point, and not ECIES

Ordinary public-key encryption (ECIES, HPKE base mode) has the sender pick an ephemeral key `e`
and compute `e · KEK_public`. Anyone holding the KEK's public key can do that. The public key
isn't a secret; on a TPM, anyone who can reach the device can recompute it. So anyone holding
it could write a key file carrying a DEK of their choosing, and unwrap would accept it.

Nobody knows the discrete logarithm of a point that came out of a hash. So `Z = ECDH(KEK, H)`
can only be computed with the KEK's **private** key, and only code allowed to use the KEK can
*create* a payload, not just open one. Knowing the public key is not enough to forge one.

Because each payload gets its own point, `Z` is unique to the payload. If one `Z` is ever
captured (from memory, swap, or a discrete TPM's bus), it opens that one payload. It doesn't open
the service's other payloads, and it can't create new ones.

### What is authenticated

Every byte of a payload except the ciphertext and tag is authenticated twice:

- **in the key**, through HKDF's info, together with the service name;
- **by the tag**, as AES-GCM's additional authenticated data.

So no header byte can be changed (a version, a provider tag, a fingerprint) without the unwrap
failing, even when the changed value would itself parse. The nonce is authenticated by GCM
itself.

### What it does not protect against

- **Replay of an older key file.** A genuine payload stays genuine for as long as its KEK exists.
  Nothing in it records when it was made or whether it is the latest. Someone who can replace a
  key file can put back an older genuine one for the same service, and it unwraps normally.
  That is deliberate, so a rolled-back release can recover its own DEK. Each platform's file
  checks, and the separation of duties, decide who can replace a key file.
- **Moving a payload between machines.** A KEK never leaves its machine, so a payload opens only
  on the machine that wrapped it. Payload layouts differ between platforms for the same reason:
  nothing ever needs to read another platform's payload.
- **Code running as an account allowed to use the KEK.** It can unwrap, and it can wrap.

## Payloads per platform

The construction is shared. The byte layouts are not:

| | Windows | macOS | Linux |
|---|---|---|---|
| Size | 132 bytes | 125 bytes | 132 to 276 bytes |
| Where `Z` is computed | TPM (Platform Crypto Provider), or the Software Key Storage Provider | Secure Enclave | TPM (`TPM2_ECDH_ZGen`), HSM (`CKM_ECDH1_DERIVE`), or process memory for an external or ephemeral key |
| Fingerprint input | Raw `X \|\| Y` (64 bytes) | `0x04 \|\| X \|\| Y` (65 bytes) | `0x04 \|\| X \|\| Y` (65 bytes) |
| Version or suite field | Version byte `1` | Suite byte `0x01` | Version byte `1` |
| Records which provider wrapped it | Yes (1 = TPM, 2 = software) | No (one provider) | Yes (1 = TPM2, 2 = PKCS#11, 3 = external secret, 5 = ephemeral) |
| Nonce in the authenticated header | No (authenticated by GCM) | Yes | Yes |

A fingerprint is meaningful only on the platform that computed it.

## The data layer: AES-256-GCM in the language libraries

Once a DEK is unwrapped, the language libraries use it to encrypt your data. Every library writes
and reads exactly the same bytes, so a value encrypted in one language decrypts in any other.

**The stored value** is text:

```text
enc::v<version>::<base64 of nonce || ciphertext || tag>
```

- `version` is the key version the value was encrypted under: the number the key file was
  registered with, or an ephemeral key's version. Decryption uses the key registered at that
  version. Encryption always uses the highest version, so rotating keys needs no re-encryption.
- `nonce` is 12 random bytes, drawn fresh for every encryption.
- `tag` is the 16-byte AES-GCM tag.

**Every value is bound to its purpose** through AES-GCM's additional authenticated data, so a
value encrypted for one purpose never decrypts under another:

| Used through | AAD (UTF-8) |
|---|---|
| A data protector named `name` | `name` |
| A configuration value at `key` | `HkdfGuard.EncryptedConfiguration:` followed by `key` with ASCII letters upper-cased |
| A protected cache entry named `name` | `HkdfGuard.Cache:` followed by `name` with ASCII letters upper-cased |

Only ASCII letters are folded, so keys differing only in ASCII case share a value, as they do in
.NET configuration. Keys differing in non-ASCII case (`café` and `CAFÉ`) never do: reading under
the other spelling fails authentication, rather than revealing the value. A configuration value
copied to a different key, such as an admin connection string moved into a less privileged
setting, fails authentication too.

**Limits.** Because each nonce is random, a single key may encrypt at most 2³¹ values. That keeps
the chance of a repeated nonce negligible. The libraries log a warning at 2²⁸ encryptions, and
refuse to encrypt past the limit. Rotate before reaching it; ephemeral keys rotate on a schedule
by default.

**Keys in memory.** An unwrapped DEK is held in memory that is zeroed when its key ring closes.
Every key-refresh interval (1 to 300 seconds), the library unwraps the DEK again through the
native wrapper. If the KEK stops answering, the key **fails closed** after three failed refreshes
by default: encryption and decryption stop until access returns. A fail-open policy, which keeps
the last good key, is available but must be chosen explicitly.

**The pipeline protector** is the one exception to "DEKs come from the native wrapper". It
generates a random 32-byte key in memory, so a deployment pipeline can encrypt configuration
before the key is wrapped. It binds each value to its configuration key, as above. At the end of
the pipeline, its key is handed to `hkdfguard wrap` on standard input, and from then on it is an
ordinary wrapped DEK.

## Algorithms at a glance

| Purpose | Algorithm |
|---|---|
| KEK | P-256 key-agreement key, generated in and never leaving the TPM, Secure Enclave or HSM |
| Per-payload point | SHA-256 try-and-increment hash to P-256, domain `HkdfGuard-P256-payload-ECDH-point-v1:` |
| Shared secret | ECDH (P-256), computed by the KEK's provider |
| Wrapping-key derivation | HKDF-SHA512 (RFC 5869), info prefix `hkdfguard-wrap-v1:` |
| DEK wrapping | AES-256-GCM, 96-bit random nonce, 128-bit tag |
| KEK fingerprint | SHA-256 of the KEK's public key |
| Data encryption | AES-256-GCM, 96-bit random nonce, 128-bit tag, purpose-bound AAD |
| DEK | 32 bytes from the operating system's CSPRNG |
