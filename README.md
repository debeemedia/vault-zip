# 🛡️ VaultZip: Secure Digital Distribution System

VaultZip is a high-performance DRM (Digital Rights Management) infrastructure designed for secure file storage and licensed distribution. It utilizes Envelope Encryption (AES-256-GCM) to ensure that sensitive digital assets (PDFs, ZIPs, etc.) are never stored in a raw state, providing tamper-proof file retrieval via unique authentication tags.

Key Security Features:

- On-the-fly Streaming: Files are encrypted as they stream; raw data never touches the server disk.

- Layered Security: Every file has a unique Data Key, which is itself encrypted by a Master Key. Even a database leak won't expose your files without the Master Key.

- Cryptographic "Door Guard" & Key Rotation: Features a fail-safe boot-time integrity check that synchronizes environment secrets with an active key versioning system. This architecture enables zero-downtime master key rotation and ensures the application refuses to boot if the environment's `APP_KEY` does not match the active database version, preventing configuration drift and decryption failures.

- Handshake Architecture: Utilizes a custom CLI for a secure two-step upload process. The backend validates file metadata (like size limits, extensions etc.) during the handshake phase to mitigate "blind upload" attacks, ensuring only compliant streams reach the encryption pipeline.

## 🔐 The Multi-Level Encryption Strategy

VaultZip uses a tiered security approach to ensure data is protected at rest and during delivery.

Level 1: Storage Encryption (The Seller's Vault)

When a file is uploaded, it is encrypted using **AES-256-GCM** with a unique **Data Encryption Key (DEK)**. This DEK is then "wrapped" by the system’s **Master Key**.

- Status: Raw files never touch the disk. Even if the S3 bucket is compromised, the files are useless without the Master Key.

Level 2: Distribution Encryption (The Buyer's License)

When a user downloads a file, the system performs a cryptographic handshake that ties the data to their specific license. Instead of sending a raw file, the system re-wraps the Data Encryption Key (DEK) using the user's unique License Key.

Process: The file remains encrypted with its original DEK, but that DEK is now protected by the user's License Key rather than the system's Master Key.

Security: This ensures the downloaded `.vault` bundle is cryptographically locked to the buyer. Even if the file is leaked, it cannot be decrypted without the specific License Key used during the download, preventing unauthorized redistribution.

## 🔓 Decryption & Integrity (The Client Side)

The final stage of the DRM process occurs entirely on the user's local machine. The server provides a `.vault` bundle containing the encrypted file and the metadata required to unlock it.

The Decryption Process:

- Key Derivation: The CLI derives a transient AES key from the user's License Key and the salt provided in the bundle.

- Key Unwrapping: This derived key is used to decrypt the Wrapped DEK.

- Stream Decryption: The raw file is decrypted via AES-256-GCM using the recovered DEK and the stored IV.

- Authentication Check: Before finalizing the file, the CLI verifies the Authentication Tag. If even a single bit of the file was tampered with during transit or storage, the process aborts and the file is deleted.

## 🚀 Quick Start (Docker)

This project is fully containerized. You only need Docker to get started.

### 1. Spin up the Infrastructure

```bash
docker compose up --build -d
```

_Starts the AdonisJS app, PostgreSQL, and MinIO (S3 storage)._

### 2. Register Your Identity

This command creates your user profile and generates a License Key.

- The "Dual Role" Demo: In this project, you are acting as both the Seller (storing the asset) and the Buyer (using a license to unlock it).

- Licence Key Storage: The raw license key is saved locally to `./vault_data/.config.json`. Do not delete this file; you will need this key later to authorize the "Level 2" decryption and download of your files.

- Security: The database only stores an encrypted version of this license, ensuring the raw key remains in your control.

```bash
docker compose exec app node ace vault-zip:register --email=your_email
```

To verify that the licence key stored in the database is encrypted:

```bash
docker compose exec db psql -U postgres -d vault_zip -c "\x" -c "SELECT email, licence_key FROM users;"
```

### 3. Encrypted Upload

Files are encrypted via a streaming pipeline and sent directly to MinIO. Ensure your file is located in the `./uploads_to_process` folder.

```bash
docker compose exec app node ace vault-zip:upload --email=your_email --title="My very important file" ./uploads_to_process/your_file.pdf
```

🔍 How to Verify the File Encryption

**Storage Layer (MinIO)**

- Visit the MinIO Console at http://localhost:9001.
- In your `docker-compose.yml`, look under `services` -> `app` -> `environment`. Use `AWS_ACCESS_KEY_ID` as the username and `AWS_SECRET_ACCESS_KEY` as the password.
- Locate your file in the vault-zip bucket. Any manual download will result in unreadable binary gibberish, confirming that AES-256-GCM encryption is active and the raw data is protected at rest.

**Database Layer (PostgreSQL)**

To verify that the cryptographic fingerprints (IV, Auth Tag, and Encrypted Key) are properly stored:

```bash
docker compose exec db psql -U postgres -d vault_zip -c "\x" -c "SELECT title, status, file_data FROM file_uploads;"
```

### 4. Secure Download (Distribution Encryption)

Download your encrypted bundle from the vault. The system re-encrypts the file's access key with your License Key during transit, creating a unique `.vault` file tied specifically to your credentials.

```bash
docker compose exec app node ace vault-zip:download --email=your_email
```

**Note on Security:** To prevent your License Key from leaking into shell history or process logs, the command will securely prompt you for the key if it isn't found in your local configuration (`./vault_data/.config.json`).

**Manual Override:** If you have a key saved in your config but want to use a different one (e.g., for testing), use the override flag to trigger a fresh secure prompt:

```bash
docker compose exec app node ace vault-zip:download --email=your_email --override-key
```

Upon running the download command, you should see a formatted table of your available files. Select the file you want to download.

🔍 How to Verify the Distribution Encryption

**Local Storage Layer (`./vault_downloads`)**

Check your project's directory for a `./vault_downloads` directory. You will find a `.vault` file. Even though this file exists on your hard drive, it remains fully encrypted.

### 5. Decryption (Unlocking the Asset)

Now that you have the encrypted `.vault` file, use your licence key to decrypt it. This process is done entirely on the client; your licence key is never sent to the server during this phase.

```bash
docker compose exec app node ace vault-zip:decrypt ./vault_downloads/your_file.pdf.vault
```

**Note on Security:** To prevent your License Key from leaking into shell history or process logs, the command will securely prompt you for the key if it isn't found in your local configuration (`./vault_data/.config.json`).

Upon running the command, you should see your now decrypted file in the `vault_downloads` folder.

**Predictable Performance:** The decryption process is designed to be memory-efficient even for large files, and maintains a constant memory footprint (approx. 200MB RSS). Because it streams data instead of buffering, decrypting a 108MB file uses about the same amount of RAM as a 108KB file, ensuring stability on low-spec servers or Docker containers.

🔍 How to Verify Authenticated Decryption

**Wrong Licence Key**

You can attempt to decrypt with a wrong key by manually overriding the licence key in your config using the `--override-key` flag:

```bash
docker compose exec app node ace vault-zip:decrypt ./vault_downloads/your_file.pdf.vault --override-key
```

You will be prompted to input a licence key.

**File Tampering**

You can also manually modify even a single byte of the `.vault` file (try it in a [hex editor](https://hexed.it/)).
Note: When testing with a hex editor, modify a byte toward the end of the file. This ensures you are tampering with the encrypted payload rather than the metadata header, allowing you to see the AES-GCM authentication failure in action.

The command will fail and any corrupted output will be automatically deleted to protect your workspace.

## 🔑 Encryption Key Lifecycle & Rotation

Vault-Zip uses a Versioned Encryption System to ensure data remains accessible even as security requirements evolve. Instead of a single static key, the system manages a relationship between database records and environment-level secrets.

### Key Features

- Key Versioning: Every encrypted file and user licence key is tagged with an `encryption_key_version_id`, allowing the system to pick the correct decryption key automatically.

- Zero-Downtime Rotation: Rotate to a new `APP_KEY` without immediately re-encrypting every file in your storage.

- Environment Auditing: Built-in CLI tools to verify that required keys exist in your `.env` before attempting operations.

### CLI Commands

#### 1. List Key Versions:

List all registered versions and check if they are active and if their corresponding environment variables are present.

```bash
docker compose exec app node ace vault-zip:list-key-versions
```

#### 2. Rotate Active Key:

Safely transition the system to a new encryption key. This command performs pre-flight checks to ensure the new key is available in the environment before deactivating the old one. In your `docker-compose.yml`, look under `services` -> `app` -> `environment`.

```bash
docker compose exec app node ace vault-zip:rotate-active-key-version --version=2
```

If the provided version already exists in the database, it's `is_active` status is set to true, and the previous active key is deactivated. Only one key is active at a time for new encryptions.

[!IMPORTANT] Key Syncing Requirement:

After running the command to rotate the key, ensure you update the `APP_KEY` to mirror the secret of the currently active version in the `encryption_key_versions` database table.

Why?
The core framework and internal encryption providers use the `APP_KEY` variable by default for general purpose encryption. To ensure the system-wide encryption remains in sync with your latest rotated version, both variables must point to the same secret.

[!TIP]

To generate a cryptographically secure key, run this command and copy the output from the terminal:

```bash
node ace generate:key --show
```

Sample Output: `HwQ8D8UKcK8c34sdcY3mXkO-pJ9yAnkR`

## 🛡️ Data Integrity & The "Door Guard"

To prevent "silent corruption" (encrypting data with an out-of-sync key), the system implements a strict Boot-Time Hash Validation:

- Immutable Hashes: When a key version is first activated, a SHA-256 fingerprint of the secret is locked in the database.

- Fail-Fast Protection: After application boot, the system hashes the current `APP_KEY` and compares it against the active database record.

- Atomic Consistency: If the environment secret does not match the database "Source of Truth," the application will refuse to start, preventing accidental encryption with incorrect credentials.

This system prioritizes data integrity over app functionality. Any mismatch in the master key used for encryption causes the app to crash after booting because, in this application, there is no other important feature that can be afforded runtime without resolving master key discrepancies.

## 🧪 Testing & Reliability

The suite provides 100% command coverage, ensuring the system is resilient against malformed data and malicious tampering.

You can run all the tests with one quick command:

```bash
docker compose run --rm tester
```

- Comprehensive Command Coverage: Exhaustive integration tests for `register`, `upload`, `list`, `download`, and `decrypt`. Every command tested against database and cloud (S3/MinIO) storage drivers.
  Exhaustive tests are also availabe for the `list-key-versions` and `rotate-active-key-version` commands.

- Strict Validation: Covers all failure modes including missing/duplicate emails, title constraints, file size/type violations, and missing environment variables for the key versioning/rotation tests.

- Large File Support: Verified handling of multi-megabyte streams near the maximum size limit.

- Binary & Metadata Integrity: Validates rejection of tampered bundles, malformed JSON metadata, and out-of-bounds headers.

- Environment Resilience: Tests terminal-width edge cases, license key storage, and interactive prompt overrides.

- System Cleanliness: Verifies automatic cleanup of all temporary files and "ghost" data after both successful and failed operations.

- Automated Cleanup: Ensures absolute cleanup of all temporary artifacts and test-generated data (local and S3) after every run.
