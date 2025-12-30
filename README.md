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
- 💬 **Typing indicators** - See when the other person is typing (like iMessage/WhatsApp)
- 🖼️ **Profile pictures** - Upload and crop your own profile photo
- 📷 **Image messages** - Share photos in chat (auto-compressed)
- ✏️ **Change username** - Update your username anytime via Settings
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

## Profile Pictures & Image Messages

### Profile Pictures
Users can upload a profile picture from the **Settings** panel (accessible via the user dropdown menu):
- Select an image from your device
- **Crop tool** lets you position and zoom before saving
- Images are automatically resized to 256×256 and compressed to JPEG (~150KB max)
- Profile pics are stored as base64 data URLs in the database

### Image Messages
Users can send photos in chat by tapping the 📷 button:
- Select an image from your device
- Preview before sending
- Images are automatically resized (max 1200×1200) and compressed (~500KB max)
- Click/tap any image in chat to view it full-screen in a lightbox

### Changing Username
Users can change their username anytime from **Settings**:
- Same validation rules as signup (2-16 chars, starts with letter, alphanumeric + underscores)
- Username must not already be taken by another user
- Reserved usernames are blocked

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
    profile_picture_url TEXT,  -- Base64 data URL for profile picture
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

-- Admin sessions table
CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    image_url TEXT,           -- Base64 data URL for image messages
    image_width INTEGER,      -- Original width for proper rendering
    image_height INTEGER,     -- Original height for proper rendering
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message reactions table (emoji reactions on messages)
CREATE TABLE IF NOT EXISTS message_reactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    is_admin BOOLEAN DEFAULT false,
    emoji TEXT NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '😮', '😢')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_id, is_admin)
);

-- Lock down Supabase public API access (browser should not access tables directly)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE sessions FROM anon, authenticated;
REVOKE ALL ON TABLE admin_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE conversations FROM anon, authenticated;
REVOKE ALL ON TABLE messages FROM anon, authenticated;

-- Typing status table (for real-time typing indicators)
CREATE TABLE IF NOT EXISTS typing_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    is_admin BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(conversation_id, is_admin)
);

ALTER TABLE typing_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE typing_status FROM anon, authenticated;

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE message_reactions FROM anon, authenticated;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_typing_status_conversation ON typing_status(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages(reply_to_id);
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
│       ├── auth/
│       │   ├── signup/
│       │   │   └── route.ts    # User registration
│       │   ├── signin/
│       │   │   └── route.ts    # User login
│       │   ├── signout/
│       │   │   └── route.ts    # User logout
│       │   ├── me/
│       │   │   └── route.ts    # Get current user
│       │   └── profile/
│       │       └── route.ts    # Update profile (pic, username)
│       └── chat/
│           ├── messages/
│           │   └── route.ts    # Get/send messages
│           └── upload/
│               └── route.ts    # Upload image messages
├── lib/
│   ├── db.ts               # Server-side DB pool
│   ├── auth.ts             # Session helpers
│   ├── imageUtils.ts       # Image processing (resize, compress)
│   └── ImageCropper.tsx    # Profile picture crop tool
├── env.example             # Environment template
└── package.json
```

## Access

- **Chat**: `yourdomain.com`
- **Admin**: `yourdomain.com/admin`

---

Built with Next.js 14, Supabase, and bcryptjs
