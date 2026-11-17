# Hostinger Business deployment — DGAP OS

This deploys DGAP OS as a **separate** website. Do not replace the existing Digital Gap public website.

## 1. Prepare a private database

1. In hPanel, create a separate MySQL database and a dedicated user.
2. Open phpMyAdmin for that database.
3. Import `db/schema.sql` (all statements, including `app_state`).
4. Keep a secure offline copy of database credentials.

## 2. Create the application

1. In Hostinger Websites, choose **Create site → Web App**.
2. Use `os.digitalgapco.com` as a separate domain/subdomain for this application. Configure its DNS and SSL before public use.
3. Upload the project ZIP or connect a private GitHub repo. When uploading, make sure `package.json` is at the archive root.
4. Choose a Node.js/Express/Other preset as applicable, Node.js 22 if available.
5. Configure the build command `npm run build`, start command `npm start`, and entry `server.js` if the setup asks for an entry file. Port defaults to 3000.
6. Set runtime environment variables in hPanel:
   - `NODE_ENV=production`
   - `APP_ORIGIN=https://os.digitalgapco.com`
   - `DB_HOST=127.0.0.1`
   - `DB_PORT=3306`
   - `DB_NAME=...`
   - `DB_USER=...`
   - `DB_PASSWORD=...`
   - `SETUP_TOKEN=...` (32+ random characters for initial setup)
   - `PRIVATE_UPLOAD_DIR=...` (absolute persistent private directory; confirm the path exists or is writable)
7. Deploy and visit `https://os.digitalgapco.com/api/health`.

**Hostinger limitation:** running arbitrary npm commands via SSH is not normally supported for managed Node.js sites. That is why this repository provides SQL import via phpMyAdmin and an authenticated-secret, single-use initial setup screen. Do not depend on running `npm run db:migrate` or `npm run admin:create` on Hostinger SSH.

## 3. Initialize the first user

1. Visit the homepage after the database schema has been imported.
2. Select **Set up the first administrator**.
3. Enter the admin name, email, a unique strong password, and the exact `SETUP_TOKEN` configured in hPanel.
4. After initialization, sign in with that account.
5. Remove the `SETUP_TOKEN` from the environment when initialization is complete (optional but recommended).

The setup process checks a database `app_state` flag and cannot normally be reused after initialization.

## 4. Security, performance and persistence

- Configure SSL; never accept live logins over HTTP.
- Verify session cookies have the `Secure`, `HttpOnly` and `SameSite=Lax` attributes.
- Validate that a client cannot download another client's project file by changing the URL.
- Avoid posting actual financial records before testing finance calculations and backups with an isolated demo dataset.
- Confirm private uploads persist across application redeployments; if Hostinger's runtime directory is ephemeral, configure supported external persistent storage before enabling uploads.
- Back up MySQL and private upload assets; rehearse a restore.
- Hostinger managed hosting does not provide inbound WebSockets, custom background workers, or Docker; this application does not require them.

## 5. Connect public website later

After CRM and security validation, the existing `digitalgapco.com` consultation form can submit through a **server-to-server** integration with a scoped API token. Do not embed a secret integration token in the public browser JavaScript. This connector is not part of v0.1.

### References

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/
- https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/
