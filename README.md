# Ultimate Repertory Licensing and Update Portal

This owner-only Netlify project generates Ed25519-signed licence keys, issues 10-day and 6-month trials, stops/revokes trials with immediate effect, and publishes live application updates.

## Licence & Trial rules

- **10-day Trial keys**: Device-bound evaluation keys valid for 10 days.
- **6-month Trial keys**: Device-bound extended evaluation keys valid for 180 days (~6 calendar months).
- **Custom duration Trial keys**: Device-bound evaluation keys with custom expiration days.
- **Full keys**: Device-bound permanent keys that do not expire.
- **Immediate Trial Revocation**: Allows the administrator to halt any trial remotely with immediate effect. Revocations are synced to Netlify Blobs and the live update feed (`/updates/version.json`).
- The customer app verifies the signature, device code, edition, and expiry locally, so an issued key continues to validate when offline, while checking revocations on launch.

## One shared key pair

The Flutter app, native owner generator, and this portal use this public key:

    SOmyfK3o7JHhEF7vOPNvpAdyJxen7vfUY8BEv/YTUZo=

Do not generate a different key pair. Derivation of the matching Netlify environment value:

    base64 -D < private_key.txt | xxd -p -c 256

Copy that command's output into Netlify environment variables as `PRIVATE_KEY_HEX`.
Never upload `private_key.txt`, `android_trial_release.jks`, or `android-signing.properties` to version control.

## Required Environment Variable

Configure this in Netlify (Site Settings > Environment Variables):
- `PRIVATE_KEY_HEX`: 64-character hex Ed25519 seed matching the public key above.

*Note: No admin login or passkey is required. Anyone with access to the portal URL can generate keys, manage updates, and revoke trials directly.*

## Deploy to Netlify

1. Keep this repository private on GitHub/GitLab.
2. Import this folder as a Netlify site.
3. Set `PRIVATE_KEY_HEX` in Netlify site settings.
4. Deploy with `netlify deploy --prod` or push to main branch.
   Netlify automatically bundles functions and static assets defined in `netlify.toml`.

## Local Development & Execution

To run and test the portal on your computer:

```bash
cd /Users/singh/Codex/Ultimate-Repertory-Licensing-Portal
# Create .env from template
cp .env.example .env
# Fill PRIVATE_KEY_HEX in .env
npx netlify dev
```

Open `http://localhost:8888` in your browser.

## API Endpoints

### 1. Generate Key (Supports 10-Day, 6-Month, Custom & Full)
```http
POST /api/generate-license
Content-Type: application/json

{
  "deviceCode": "AABBCC-DDEEFF-112233-445566",
  "edition": "trial",
  "trialDuration": "6m"
}
```
*`trialDuration` options*: `"10d"` (10 days), `"6m"` (180 days / 6 months), or positive number of days (e.g. `180`).
*`edition` options*: `"trial"`, `"full"`.

### 2. Validate Key & Check Revocation Status
```http
POST /api/validate-license
Content-Type: application/json

{
  "deviceCode": "AABBCC-DDEEFF-112233-445566",
  "key": "UR1.payload.signature"
}
```

### 3. Immediate Trial Revocation (Kill-Switch)
```http
POST /api/revoke-license
Content-Type: application/json

{
  "deviceCode": "AABBCC-DDEEFF-112233-445566",
  "reason": "Trial stopped by owner"
}
```
Immediately stops the trial, adds the device to the server blocklist, and updates `/updates/version.json`.

### 4. Publish Live App Update (Update Sending)
```http
POST /api/publish-update
Content-Type: application/json

{
  "version": "2.5.2",
  "buildNumber": 52,
  "releaseDate": "2026-10-26",
  "changelog": [
    "6-month trial support",
    "Immediate trial revocation",
    "Bug fixes"
  ],
  "downloads": {
    "macos": "https://...pkg",
    "windows": "https://...exe",
    "android": "https://...apk"
  }
}
```
Immediately publishes the update feed served at `/updates/version.json`.

### 5. Fetch Live Feed
```http
GET /updates/version.json
```
Served dynamically with `no-cache` headers, including build number, download links, and revocation list.

## How to Stop a Trial on Client Device Directly

If you have direct access to the client machine:
- **macOS**:
  ```bash
  rm -f "$HOME/Library/Application Support/Ultimate Repertory/.ultimate_trial_license"
  rm -f "$HOME/Library/Application Support/Ultimate Repertory Trial/.ultimate_trial_license"
  killall "Ultimate Repertory" 2>/dev/null
  ```
- **Windows (PowerShell)**:
  ```powershell
  Remove-Item "$env:LOCALAPPDATA\Ultimate Repertory\.ultimate_trial_license" -Force -ErrorAction SilentlyContinue
  Remove-Item "$env:LOCALAPPDATA\Ultimate Repertory Trial\.ultimate_trial_license" -Force -ErrorAction SilentlyContinue
  Stop-Process -Name "Ultimate Repertory" -Force -ErrorAction SilentlyContinue
  ```
- **Android**:
  Clear App Storage in Android Settings > Apps > Ultimate Repertory > Storage > Clear Data.
