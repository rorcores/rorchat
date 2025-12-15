# rorchat.

A **sleek, professional** web chat app. Users pick a username and chat with you – you respond from the admin dashboard.

![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=for-the-badge)

## Features

- 📱 **Mobile-first design** - Optimized for phones
- 🎨 **Premium aesthetics** - Subtle waves, line art, gradient orbs
- 👤 **Simple auth** - Just username + password (no email required)
- 🔄 **Live messaging** - Simple polling-based updates
- ⚡ **Admin dashboard** - Manage all conversations at `/admin`
- 🔐 **Secure** - Bcrypt password hashing, random session tokens (httpOnly cookies), DB locked down from anon

## How Auth Works

We use a **custom username/password system** (not Supabase Auth) for simplicity:

| Component | Purpose |
|-----------|---------|
| `users` table | Stores username, bcrypt password hash, display name |
| `sessions` table | Stores **hashed** session tokens with expiry |
| `/api/auth/signup` | Validates input, hashes password, creates user |
| `/api/auth/signin` | Verifies password, sets session cookie |
| `/api/auth/signout` | Clears session cookie |
| `/api/auth/me` | Returns current user from session |

**Validation rules:**
- Username: 3-16 characters, starts with a letter, alphanumeric + underscores
- Password: 6-72 characters
- Reserved usernames blocked (admin, root, system, etc.)

**Sessions:** httpOnly cookies containing a **random token** (token is hashed in DB), 30-day expiry.

## Security Model (Important)

- The browser does **not** talk to Supabase tables directly.
- All reads/writes happen via Next.js API routes using `DATABASE_URL`.
- Public Supabase API roles (`anon`/`authenticated`) have **no privileges** on `users`, `sessions`, `conversations`, `messages` (RLS enabled + grants revoked).

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/rorchat.git
git push -u origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Add environment variables (see below)
4. Deploy!

### 3. Environment Variables

In Vercel Dashboard → Settings → Environment Variables, add:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string (server-side only) |
| `ADMIN_PASSWORD` | Your admin dashboard password |

Get your connection string from: **Supabase Dashboard → Project Settings → Database**

## Local Development

```bash
# Install dependencies
npm install

# Create .env.local with your credentials
cp env.example .env.local
# Edit .env.local with your values

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Supabase Setup

Run this SQL in your Supabase SQL Editor:

```sql
-- Users table (simple auth - no Supabase Auth needed)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table (store hashed tokens)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    visitor_id TEXT,
    visitor_name TEXT DEFAULT 'Anonymous',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lock down Supabase public API access (browser should not access tables directly)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE sessions FROM anon, authenticated;
REVOKE ALL ON TABLE conversations FROM anon, authenticated;
REVOKE ALL ON TABLE messages FROM anon, authenticated;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
```

## Project Structure

```
rorchat/
├── app/
│   ├── layout.tsx          # Root layout with fonts
│   ├── page.tsx            # Main chat page
│   ├── globals.css         # All styles
│   ├── admin/
│   │   └── page.tsx        # Admin dashboard
│   └── api/
│       ├── admin/              # Admin API (cookie-based)
│       │   ├── login/route.ts
│       │   ├── me/route.ts
│       │   ├── logout/route.ts
│       │   ├── conversations/route.ts
│       │   ├── messages/route.ts
│       │   ├── reply/route.ts
│       │   └── verify/route.ts     # Back-compat (calls login)
│       └── auth/
│           ├── signup/
│           │   └── route.ts    # User registration
│           ├── signin/
│           │   └── route.ts    # User login
│           ├── signout/
│           │   └── route.ts    # User logout
│           └── me/
│               └── route.ts    # Get current user
├── lib/
│   ├── db.ts               # Server-side DB pool
│   └── auth.ts             # Session helpers
├── env.example             # Environment template
└── package.json
```

## Access

- **Chat**: `yourdomain.com`
- **Admin**: `yourdomain.com/admin`

---

Built with Next.js 14, Supabase, and bcryptjs
