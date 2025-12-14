# rorchat.

A **sleek, professional** web chat app. Users pick a username and chat with you – you respond from the admin dashboard.

![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=for-the-badge)

## Features

- 📱 **Mobile-first design** - Optimized for phones
- 🎨 **Premium aesthetics** - Subtle waves, line art, gradient orbs
- 👤 **Username-based auth** - Simple username + password (no email)
- 🔄 **Real-time messaging** - Instant updates via Supabase
- ⚡ **Admin dashboard** - Manage all conversations at `/admin`
- 🔐 **Secure** - Admin password via environment variable

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
-- Profiles table for usernames
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    visitor_id UUID,
    visitor_name TEXT,
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

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin can view all profiles" ON profiles FOR SELECT USING (true);

-- Conversations policies
CREATE POLICY "Users can view own conversations" ON conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create conversations" ON conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin can view all conversations" ON conversations FOR SELECT USING (true);
CREATE POLICY "Admin can update conversations" ON conversations FOR UPDATE USING (true);

-- Messages policies
CREATE POLICY "Users can view messages" ON messages FOR SELECT USING (true);
CREATE POLICY "Users can send messages" ON messages FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
```

## Project Structure

```
rorchat/
├── app/
│   ├── layout.tsx      # Root layout with fonts
│   ├── page.tsx        # Main chat page
│   ├── globals.css     # All styles
│   ├── admin/
│   │   └── page.tsx    # Admin dashboard
│   └── api/
│       └── admin/
│           └── verify/
│               └── route.ts  # Admin auth API
├── lib/
│   └── supabase.ts     # Supabase client
├── env.example         # Environment template
└── package.json
```

## Access

- **Chat**: `yourdomain.com`
- **Admin**: `yourdomain.com/admin`

---

Built with Next.js 14, Supabase, and ❤️
