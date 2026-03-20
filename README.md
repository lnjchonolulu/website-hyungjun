# Hyungjun Cho Site

Minimal editorial portfolio site with:

- static frontend served by Node
- admin login for publication editing
- PostgreSQL-backed publication storage
- Railway-friendly deployment shape

## Local Run

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env`.
3. Fill in:

   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `ADMIN_PASSWORD_SHA256`

4. Install dependencies:

   ```bash
   npm install
   ```

5. Start the app:

   ```bash
   npm start
   ```

6. Open [http://localhost:3000](http://localhost:3000).

## Password Hash

To generate the SHA-256 value for an admin password:

```bash
printf 'your-password-here' | shasum -a 256
```

Use the resulting hex string as `ADMIN_PASSWORD_SHA256`.

## Railway

Create a Railway project with:

- one service from this repo
- one PostgreSQL database

Set these environment variables on the web service:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_PASSWORD_SHA256`
- `NODE_ENV=production`

Railway will use:

```bash
npm start
```

The server serves both the frontend and the API, so no separate frontend deployment is required.

## Data Model

`db/schema.sql` creates a single `publications` table. The frontend editor saves the entire publication layout through `PUT /api/publications`, and the backend rewrites the ordered publication rows inside a database transaction.
