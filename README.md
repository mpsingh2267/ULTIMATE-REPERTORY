# Ultimate Repertory Licensing and Update Portal

This owner-only Netlify project generates Ed25519-signed licence keys and
publishes the optional application update feed.

## Licence rules

- Trial keys are device-bound and always expire exactly 10 days after issue.
- Full keys are device-bound and do not expire.
- The customer app verifies the signature, device code, edition, and expiry
  locally, so an issued key continues to validate when the server is offline.
- The validation API provides an optional second verifier for owner support.
- Reinstalling does not extend an issued key because its expiry is signed.

## One shared key pair

The Flutter app, native owner generator, and this portal use this public key:

    SOmyfK3o7JHhEF7vOPNvpAdyJxen7vfUY8BEv/YTUZo=

Do not generate a different key pair. From the owner_license_manager
directory, derive the matching Netlify environment value:

    base64 -D < private_key.txt | xxd -p -c 256

Copy that command's output into Netlify as PRIVATE_KEY_HEX. Never upload
private_key.txt, android_trial_release.jks, or android-signing.properties.

## Deploy

1. Keep this repository private.
2. Import this folder as a Netlify site.
3. Set ADMIN_SECRET to a long random owner password.
4. Set PRIVATE_KEY_HEX using the command above.
5. Deploy. The included netlify.toml configures the public site and functions.

The dashboard accepts the four-part device code displayed by the app. Choose
Trial or Full and send the generated UR1 key to the customer.

## API

Generate a key:

    POST /api/generate-license
    Authorization: Bearer ADMIN_SECRET
    {"deviceCode":"AABBCC-DDEEFF-112233-445566","edition":"trial"}

Validate a key:

    POST /api/validate-license
    {"deviceCode":"AABBCC-DDEEFF-112233-445566","key":"UR1.payload.signature"}

## Updates

Edit public/updates/version.json after placing the APK and PKG at the stated
download URLs. The app ignores the feed when it is unavailable and shows an
update only when the remote build number is newer.
