# Glossary

- **DEK** (data encryption key): 32 random bytes that encrypt your application's data. On disk
  it exists only wrapped under a KEK, in a key file.
- **Deployer**: under the production security model, the role that wraps DEKs into key files the
  application will trust. See [Separation of duties](separationofduties.md).
- **Fingerprint**: the SHA-256 of a KEK's public key, 64 hex characters. `hkdfguard provision`
  prints it; record it, so you can tell if the KEK under a service name is ever replaced.
- **HKDF**: HMAC-based Extract-and-Expand Key Derivation Function (RFC 5869).
- **KEK** (key encryption key): a per-service P-256 key held by the TPM, Secure Enclave or HSM.
  It can be used there, but never read out.
- **Key file**: a file holding one wrapped DEK, written by `hkdfguard wrap`. Only the machine that
  wrote it can unwrap it.
- **Provision**: create a service's KEK, with `hkdfguard provision`. The only step that creates
  one.
- **Retire**: permanently delete a service's KEK, with `hkdfguard retire`. Every DEK wrapped under
  it becomes unrecoverable.
- **Service name**: the name of a KEK, such as `com.example.orders`: 1 to 128 ASCII letters,
  digits and dots, case-insensitive. A public identifier, not a secret.
- **Wrap / unwrap**: encrypt a DEK under a KEK, and decrypt it again.
