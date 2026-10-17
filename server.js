const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const FIREBASE_URL = (process.env.FIREBASE_URL || 'https://characteradmin-default-rtdb.europe-west1.firebasedatabase.app').replace(/\/$/, '');
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || 'klU7qLonlQYzzux9EvzOc7sPFl0bNLlOdtxrs4b5';

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Helper Functions
function getFirebaseUrl(endpoint) {
    return `${FIREBASE_URL}/${endpoint}.json?auth=${FIREBASE_SECRET}`;
}

async function firebaseGet(endpoint) {
    const res = await fetch(getFirebaseUrl(endpoint));
    if (!res.ok) throw new Error(`Firebase GET failed: ${res.statusText}`);
    return await res.json();
}

async function firebasePut(endpoint, data) {
    const res = await fetch(getFirebaseUrl(endpoint), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Firebase PUT failed: ${res.statusText}`);
    return await res.json();
}

async function firebasePatch(endpoint, data) {
    const res = await fetch(getFirebaseUrl(endpoint), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Firebase PATCH failed: ${res.statusText}`);
    return await res.json();
}

async function firebaseDelete(endpoint) {
    const res = await fetch(getFirebaseUrl(endpoint), {
        method: 'DELETE'
    });
    if (!res.ok) throw new Error(`Firebase DELETE failed: ${res.statusText}`);
    return await res.json();
}

// Fetch Roblox Headshot Avatar
async function fetchRobloxAvatar(userId) {
    const fallback = 'https://tr.rbxcdn.com/38c6edcb50633730ff4cf39ac8859840/150/150/AvatarHeadshot/Png';
    try {
        const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`);
        const json = await res.json();
        if (json && json.data && json.data[0] && json.data[0].imageUrl) {
            return json.data[0].imageUrl;
        }
    } catch (e) {
        console.error('[Roblox API] Error fetching avatar:', e.message);
    }
    return fallback;
}

// ====================================================================
// AUTHENTICATION API ROUTES
// ====================================================================

// 1. Submit Code -> initiates in-game 2FA verification
app.post('/api/auth/request-code', async (req, res) => {
    try {
        const rawCode = req.body.code;
        if (!rawCode || typeof rawCode !== 'string') {
            return res.status(400).json({ success: false, error: 'Please enter a code.' });
        }

        const cleanCode = rawCode.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!cleanCode) {
            return res.status(400).json({ success: false, error: 'Invalid code format.' });
        }

        // Check if code exists in Firebase
        const codeRecord = await firebaseGet(`codes/${cleanCode}`);
        if (!codeRecord || !codeRecord.UserId) {
            return res.status(404).json({
                success: false,
                error: 'Code not found. Make sure you are in the Roblox game!'
            });
        }

        const userId = codeRecord.UserId;
        const username = codeRecord.Username || 'Player';
        const now = Math.floor(Date.now() / 1000);

        // Create pending login request in Firebase
        const requestData = {
            Status: 'Pending',
            Code: cleanCode,
            UserId: userId,
            Username: username,
            RequestTime: now,
            ExpiresAt: now + 30
        };

        await firebasePut(`loginRequests/${userId}`, requestData);
        console.log(`[Auth] Verification requested for ${username} (ID: ${userId})`);

        return res.status(200).json({
            success: true,
            userId: userId,
            username: username,
            message: 'Pls Verify its you in the Game'
        });
    } catch (err) {
        console.error('[Auth] Error processing code request:', err);
        return res.status(500).json({ success: false, error: 'Server error while processing code.' });
    }
});

// 2. Poll Verification Status from Website
app.get('/api/auth/check-status', async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId parameter' });
        }

        const requestData = await firebaseGet(`loginRequests/${userId}`);
        if (!requestData) {
            return res.status(200).json({ verified: false, status: 'NoRequest' });
        }

        const now = Math.floor(Date.now() / 1000);

        if (requestData.Status === 'Verified') {
            // Player clicked MeButton in-game!
            const avatarUrl = await fetchRobloxAvatar(userId);
            const sessionToken = crypto.randomBytes(32).toString('hex');

            const sessionData = {
                userId: userId,
                username: requestData.Username,
                avatarUrl: avatarUrl,
                createdAt: Date.now()
            };

            // Save persistent session in Firebase
            await firebasePut(`sessions/${sessionToken}`, sessionData);

            // Clean up login request
            await firebaseDelete(`loginRequests/${userId}`);

            console.log(`[Auth] Player ${requestData.Username} logged in successfully! Session created.`);

            return res.status(200).json({
                verified: true,
                sessionToken: sessionToken,
                user: sessionData
            });
        }

        if (requestData.Status === 'Rejected' || (requestData.ExpiresAt && now > requestData.ExpiresAt)) {
            // Player clicked NotMeButton or timeout expired
            await firebaseDelete(`loginRequests/${userId}`);
            return res.status(200).json({ verified: false, status: 'Rejected' });
        }

        // Still pending
        return res.status(200).json({ verified: false, status: 'Pending' });
    } catch (err) {
        console.error('[Auth] Error checking status:', err);
        return res.status(500).json({ error: 'Failed to check verification status.' });
    }
});

// 3. Verify Existing Browser Session (Auto-login from localStorage)
app.get('/api/auth/verify-session', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ valid: false });
        }

        const token = authHeader.split(' ')[1];
        const session = await firebaseGet(`sessions/${token}`);

        if (session && session.userId) {
            return res.status(200).json({ valid: true, user: session });
        }

        return res.status(401).json({ valid: false });
    } catch (err) {
        return res.status(500).json({ valid: false });
    }
});

// 4. Logout (Clears session from Firebase)
app.post('/api/auth/logout', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            await firebaseDelete(`sessions/${token}`);
        }
        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(200).json({ success: true });
    }
});

// Fallback to index.html for single page app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[CharacterAdmin] Server running at http://localhost:${PORT}`);
});
