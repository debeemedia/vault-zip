# 🛡️ VaultZip: Secure Digital Distribution System

VaultZip is a high-performance DRM (Digital Rights Management) infrastructure designed for secure file storage and licensed distribution. It utilizes Envelope Encryption (AES-256-GCM) to ensure that sensitive digital assets (PDFs, ZIPs, etc.) are never stored in a raw state, providing tamper-proof file retrieval via unique authentication tags.

Key Security Features:

- On-the-fly Streaming: Files are encrypted as they stream; raw data never touches the server disk.

- Layered Security: Every file has a unique Data Key, which is itself encrypted by a Master Key. Even a database leak won't expose your files without the Master Key.

- Handshake Architecture: Utilizes a custom CLI for a secure two-step upload process. The backend validates file metadata (like size limits, extensions etc.) during the handshake phase to mitigate "blind upload" attacks, ensuring only compliant streams reach the encryption pipeline.

## 🔐 The Multi-Level Encryption Strategy

VaultZip uses a tiered security approach to ensure data is protected at rest and during delivery.

Level 1: Storage Encryption (The Seller's Vault)

When a file is uploaded, it is encrypted using **AES-256-GCM** with a unique **Data Encryption Key (DEK)**. This DEK is then "wrapped" by the system’s **Master Key**.

- Status: Raw files never touch the disk. Even if the S3 bucket is compromised, the files are useless without the Master Key.

Level 2: Distribution Encryption (The Buyer's License)

When a user requests a download, the system doesn't just decrypt the file; it re-encrypts it on-the-fly using the user's unique License Key.

- Status: This ensures that the downloaded file is cryptographically tied to a specific buyer, preventing unauthorized redistribution.

## 🚀 Quick Start (Docker)

This project is fully containerized. You only need Docker to get started.

1. Spin up the Infrastructure

```bash
docker compose up --build -d
```

_Starts the AdonisJS app, PostgreSQL, and MinIO (S3 storage)._

2. Register Your Identity

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

3. Encrypted Upload

Files are encrypted via a streaming pipeline and sent directly to MinIO. Ensure your file is located in the `./uploads_to_process` folder.

```bash
docker compose exec app node ace vault-zip:upload --email=your_email --title="My very important file" ./uploads_to_process/your_file.pdf
```

🔍 How to Verify the File Encryption

**Storage Layer (MinIO)**
Visit the MinIO Console at http://localhost:9001 (login with your .env credentials — check the `docker-compose.yml` file). Locate the file in the vault-zip bucket. Any manual download will result in unreadable binary gibberish, confirming the AES-256-GCM encryption is active.

**Database Layer (PostgreSQL)**
To verify that the cryptographic fingerprints (IV, Auth Tag, and Encrypted Key) are properly stored:

```bash
docker compose exec db psql -U postgres -d vault_zip -c "\x" -c "SELECT title, status, file_data FROM file_uploads;"
```

## Functional Tests

Run the full test suite:

```bash
docker compose run --rm tester
```
