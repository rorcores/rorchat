# rorchat.

A **sleek, professional** web chat app. Users pick a username and chat with you – you respond from the admin dashboard.

![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=for-the-badge)

## Features

- 📱 **Mobile-first design** - Optimized for phones
- 🎨 **Premium aesthetics** - Subtle waves, line art, gradient orbs
- 👤 **Simple auth** - Just username + password (no email required)
- 🔄 **Real-time messaging** - Instant updates via Supabase
- ⚡ **Admin dashboard** - Manage all conversations at `/admin`
- 🔐 **Secure** - Bcrypt password hashing, httpOnly session cookies

## How Auth Works

We use a **custom username/password system** (not Supabase Auth) for simplicity:

| Component | Purpose |
|-----------|---------|
| `users` table | Stores username, bcrypt password hash, display name |
| `/api/auth/signup` | Validates input, hashes password, creates user |
| `/api/auth/signin` | Verifies password, sets session cookie |
| `/api/auth/signout` | Clears session cookie |
| `/api/auth/me` | Returns current user from session |

**Validation rules:**
- Username: 3-16 characters, starts with a letter, alphanumeric + underscores
- Password: 6-72 characters
- Reserved usernames blocked (admin, root, system, etc.)

**Sessions:** httpOnly cookies containing the user ID, 30-day expiry.

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
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `ADMIN_PASSWORD` | Your admin dashboard password |

Get your Supabase credentials from: **Supabase Dashboard → Project Settings → API**

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

-- Disable RLS (we handle auth in our API routes)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
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
│       ├── admin/
│       │   └── verify/
│       │       └── route.ts    # Admin password check
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
│   └── supabase.ts         # Supabase client
├── env.example             # Environment template
└── package.json
```

## Access

- **Chat**: `yourdomain.com`
- **Admin**: `yourdomain.com/admin`

---

Built with Next.js 14, Supabase, and bcryptjs
