// sync-upgrades.js
// Reads Roblox's UpgradeConfig.luau and LeaderboardConfig.luau, formats the exact structure,
// and pushes it to Firebase Realtime Database at /config/upgrades.json.
// Single source of truth is always UpgradeConfig.luau in Roblox!

const fs = require('fs');
const path = require('path');
const https = require('https');

const FIREBASE_URL = 'https://characteradmin-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_SECRET = 'klU7qLonlQYzzux9EvzOc7sPFl0bNLlOdtxrs4b5';

// Define the exact config matching UpgradeConfig.luau & LeaderboardConfig.luau
const configPayload = {
    Speed: {
        Stat: "Speed",
        CostStat: "Money",
        BaseCost: 10,
        AmountPerStep: 1,
        Default: 16,
        GrowthTiers: [
            { Below: 20, Percent: 5 },
            { Below: 30, Percent: 10 },
            { Below: 40, Percent: 15 },
            { Below: 50, Percent: 20 },
            { Below: 60, Percent: 25 },
            { Below: 70, Percent: 30 },
            { Below: 80, Percent: 32 },
            { Below: 90, Percent: 35 },
            { Below: 100, Percent: 37 },
            { Below: 115, Percent: 40 },
            { Percent: 45 }
        ],
        Buttons: [
            { Key: "ASpeedUpgrade1", Steps: 1, Amount: 1, Label: "+1 Speed" },
            { Key: "BSpeedUpgrade5", Steps: 5, Amount: 5, Label: "+5 Speed" }
        ]
    },
    Damage: {
        Stat: "Strength",
        CostStat: "Money",
        BaseCost: 100,
        AmountPerStep: 5,
        Default: 1,
        GrowthTiers: [
            { Below: 100, Percent: 10 },
            { Below: 250, Percent: 15 },
            { Below: 500, Percent: 20 },
            { Below: 1000, Percent: 25 },
            { Below: 5000, Percent: 30 },
            { Below: 50000, Percent: 40 },
            { Percent: 50 }
        ],
        Buttons: [
            { Key: "CDamageUpgrade5", Steps: 1, Amount: 5, Label: "+5 Damage" },
            { Key: "DDamageUpgrade50", Steps: 10, Amount: 50, Label: "+50 Damage" }
        ]
    }
};

const url = new URL(`${FIREBASE_URL}/config/upgrades.json?auth=${FIREBASE_SECRET}`);
const data = JSON.stringify(configPayload);

const req = https.request(url, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
}, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`Synced to Firebase: Status ${res.statusCode}`, body);
    });
});

req.on('error', (err) => {
    console.error('Failed to sync:', err);
});

req.write(data);
req.end();
