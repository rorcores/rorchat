#!/usr/bin/env node

/**
 * Generate VAPID keys for Web Push notifications.
 * 
 * Run this once:
 *   node scripts/generate-vapid-keys.js
 * 
 * Then add the output to your .env file:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
 *   VAPID_PRIVATE_KEY=...
 */

const webpush = require('web-push')

const vapidKeys = webpush.generateVAPIDKeys()

console.log('\n🔐 VAPID Keys Generated!\n')
console.log('Add these to your .env file:\n')
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`)
console.log('\n⚠️  Keep VAPID_PRIVATE_KEY secret! Never commit it to git.\n')
