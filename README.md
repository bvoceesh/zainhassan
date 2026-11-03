# Hearth local app

Hearth is a locally hosted care-coordination prototype. It serves the dashboard and a PowerShell API from the same origin, with JSON records and uploaded files persisted on this device.

## Run it

Requires Windows PowerShell 5.1. No package installation is needed.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\server.ps1
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Keep the PowerShell window open while using the app; press Ctrl+C there to stop the service. The execution-policy setting applies only to that PowerShell process.

Register from the Sign in dialog and choose a role. Accounts require a name, email, and password of at least 10 characters. If you forget a password, use the Forgot password link in the sign-in dialog to set a replacement on this device. Patient, volunteer, clinician, and care-unit workflows are backed by the local API. The signed-out dashboard is demo content.

## Local storage

`.hearth-data/database.json` stores account hashes, sessions, appointments, availability, volunteer requests, care plans, and file metadata. `.hearth-data/files/` stores uploaded file contents. The directory is excluded from Git.

The server binds only to `127.0.0.1`. It is not an internet-facing service. Role selection is self-service in this prototype; clinician and care-unit identities are not verified.

## Assistant

By default, the assistant uses local, role-scoped record lookup. It does not call an AI model. To enable an OpenAI-compatible chat-completions provider, set these variables in the same PowerShell process before starting the server:

```powershell
$env:HEARTH_ALLOW_EXTERNAL_AI = '1'
$env:HEARTH_AI_ENDPOINT = 'https://your-provider.example/v1/chat/completions'
$env:HEARTH_AI_MODEL = 'your-approved-model'
$env:HEARTH_AI_API_KEY = 'set-this-privately'
.\server.ps1
```

When enabled, the assistant sends the question and relevant account records to that provider. Do not enable it for real health data without explicit patient consent, a suitable privacy agreement with the provider, and clinical governance. Never commit API keys.

## Not for clinical use

This prototype is not production-ready and must not contain real patient information. It has no verified roles, TLS, encryption-at-rest, audit logging, backup/recovery, multi-instance database, or regulated AI review. The assistant does not diagnose, prescribe, or replace the care team. Production deployment requires a security and privacy review, approved hosting and storage, identity verification, patient consent controls, and clinically validated integrations.
