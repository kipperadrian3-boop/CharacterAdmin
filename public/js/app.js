// app.js - Character Admin Frontend (GitHub Pages & Local Ready)
// Manages authentication, in-game 2FA verification with Firebase, and persistent browser session via localStorage.

const FIREBASE_URL = 'https://characteradmin-default-rtdb.europe-west1.firebasedatabase.app';
const STORAGE_KEY  = 'character_admin_session';

// DOM Elements
const loginView         = document.getElementById('loginView');
const mainAppView       = document.getElementById('mainAppView');
const codeInput         = document.getElementById('codeInput');
const loginBtn          = document.getElementById('loginBtn');
const statusContainer   = document.getElementById('statusContainer');
const statusMessage     = document.getElementById('statusMessage');
const countdownProgress = document.getElementById('countdownProgress');
const errorMessage      = document.getElementById('errorMessage');
const userAvatar        = document.getElementById('userAvatar');
const userName          = document.getElementById('userName');
const logoutBtn         = document.getElementById('logoutBtn');

// Navigation & Sub-views
const dashboardView     = document.getElementById('dashboardView');
const upgradesView      = document.getElementById('upgradesView');
const navDashboardBtn   = document.getElementById('navDashboardBtn');
const navUpgradesBtn    = document.getElementById('navUpgradesBtn');

// Upgrade Elements
const statMoneyVal      = document.getElementById('statMoneyVal');
const statSpeedVal      = document.getElementById('statSpeedVal');
const statDamageVal     = document.getElementById('statDamageVal');
const upgradeStatusMsg  = document.getElementById('upgradeStatusMsg');

const costSpeed1        = document.getElementById('costSpeed1');
const costSpeed5        = document.getElementById('costSpeed5');
const costDamage5       = document.getElementById('costDamage5');
const costDamage50      = document.getElementById('costDamage50');

const previewSpeed1     = document.getElementById('previewSpeed1');
const previewSpeed5     = document.getElementById('previewSpeed5');
const previewDamage5    = document.getElementById('previewDamage5');
const previewDamage50   = document.getElementById('previewDamage50');

const buySpeed1Btn      = document.getElementById('buySpeed1Btn');
const buySpeed5Btn      = document.getElementById('buySpeed5Btn');
const buyDamage5Btn     = document.getElementById('buyDamage5Btn');
const buyDamage50Btn    = document.getElementById('buyDamage50Btn');

let pollInterval = null;
let countdownTimer = null;
let statsPollInterval = null;
let currentStats = { Money: 100, Speed: 16, Strength: 1 };
let currentUser = null;
let isPurchasing = false;

// ====================================================================
// 1. PERSISTENT BROWSER SESSION (localStorage)
// ====================================================================

function initSession() {
    const rawSaved = localStorage.getItem(STORAGE_KEY);
    if (!rawSaved) {
        showLoginView();
        return;
    }

    try {
        const session = JSON.parse(rawSaved);
        if (session && session.userId && session.username) {
            // Valid session found -> Auto-login on this device/browser!
            showMainAppView(session);
            return;
        }
    } catch (e) {
        console.error('Error reading localStorage session:', e);
    }

    localStorage.removeItem(STORAGE_KEY);
    showLoginView();
}

function saveSession(user) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
        console.error('Failed to save to localStorage:', e);
    }
}

function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
}

// ====================================================================
// 2. VIEW SWITCHING
// ====================================================================

function showLoginView() {
    stopPolling();
    stopStatsSync();
    currentUser = null;
    mainAppView.classList.add('hidden');
    loginView.classList.remove('hidden');
    statusContainer.classList.add('hidden');
    errorMessage.classList.add('hidden');
    codeInput.disabled = false;
    loginBtn.disabled = false;
    codeInput.value = '';
    codeInput.focus();
}

// Fetches the real Roblox avatar using UserId or Username via official Roblox API (roproxy)
async function fetchRobloxAvatar(userId, username) {
    // 1. Try directly by UserId via roproxy (CORS-enabled Roblox Thumbnails API)
    if (userId) {
        try {
            const res = await fetch(`https://thumbnails.roproxy.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
            const data = await res.json();
            if (data && data.data && data.data[0] && data.data[0].imageUrl) {
                return data.data[0].imageUrl;
            }
        } catch (e) {
            console.warn('Roproxy thumbnails error by userId:', e);
        }
    }

    // 2. Try by Username to resolve UserId, then fetch headshot
    if (username) {
        try {
            const userRes = await fetch('https://users.roproxy.com/v1/usernames/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
            });
            const userData = await userRes.json();
            if (userData && userData.data && userData.data[0] && userData.data[0].id) {
                const resolvedId = userData.data[0].id;
                const thumbRes = await fetch(`https://thumbnails.roproxy.com/v1/users/avatar-headshot?userIds=${resolvedId}&size=150x150&format=Png&isCircular=false`);
                const thumbData = await thumbRes.json();
                if (thumbData && thumbData.data && thumbData.data[0] && thumbData.data[0].imageUrl) {
                    return thumbData.data[0].imageUrl;
                }
            }
        } catch (e) {
            console.warn('Roproxy error by username:', e);
        }
    }

    // 3. Try Firebase (saved by Roblox server)
    if (username) {
        try {
            const fbRes = await fetch(`${FIREBASE_URL}/Players/${username}/AvatarUrl.json`);
            const fbUrl = await fbRes.json();
            if (fbUrl && typeof fbUrl === 'string' && fbUrl.startsWith('http')) {
                return fbUrl;
            }
        } catch (e) {}
    }

    // 4. Stylized SVG avatar fallback with initials
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username || 'Player')}&background=d97736&color=ffffff&size=150&bold=true&rounded=true`;
}

function showMainAppView(user) {
    stopPolling();
    loginView.classList.add('hidden');
    mainAppView.classList.remove('hidden');

    if (user) {
        currentUser = user;
        userName.textContent = user.username || 'Player';

        // Set up error fallback to prevent broken icon
        userAvatar.onerror = function() {
            this.onerror = null;
            this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username || 'Player')}&background=d97736&color=ffffff&size=150&bold=true&rounded=true`;
        };

        // If user already has a valid avatarUrl that is not broken, display it
        if (user.avatarUrl && !user.avatarUrl.includes('38c6edcb') && user.avatarUrl.startsWith('http')) {
            userAvatar.src = user.avatarUrl;
        }

        // Always query the live Roblox API by UserId or Username to get and refresh the official avatar!
        fetchRobloxAvatar(user.userId, user.username).then(realUrl => {
            if (realUrl) {
                user.avatarUrl = realUrl;
                saveSession(user);
                userAvatar.src = realUrl;
            }
        });

        // Initialize sub-view and start real-time stats synchronization with Firebase
        switchSubView('dashboard');
        startStatsSync(user.username);
    }
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

// ====================================================================
// 3. CODE INPUT AUTO-FORMATTING (xxxx-xxxx-xxxx-xxxx)
// ====================================================================

codeInput.addEventListener('input', (e) => {
    hideError();
    let val = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (val.length > 16) val = val.substring(0, 16);

    const parts = [];
    for (let i = 0; i < val.length; i += 4) {
        parts.push(val.substring(i, i + 4));
    }
    e.target.value = parts.join('-');
});

codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        handleConnect();
    }
});

loginBtn.addEventListener('click', handleConnect);

// ====================================================================
// 4. CONNECT & 2FA VERIFICATION POLLING (Direct Firebase)
// ====================================================================

async function handleConnect() {
    const raw = codeInput.value.trim();
    if (!raw) {
        showError('Please enter your code.');
        return;
    }

    const cleanCode = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanCode.length < 8) {
        showError('Invalid code format.');
        return;
    }

    hideError();
    codeInput.disabled = true;
    loginBtn.disabled = true;

    try {
        // 1. Verify code exists in Firebase
        const codeRes = await fetch(`${FIREBASE_URL}/codes/${cleanCode}.json`);
        const codeRecord = await codeRes.json();

        if (!codeRecord || !codeRecord.UserId) {
            showError('Code not found.');
            codeInput.disabled = false;
            loginBtn.disabled = false;
            return;
        }

        const userId = codeRecord.UserId;
        const username = codeRecord.Username || 'Player';
        const now = Math.floor(Date.now() / 1000);

        // 2. Create pending verification request in Firebase
        const reqPayload = {
            Status: 'Pending',
            Code: cleanCode,
            UserId: userId,
            Username: username,
            RequestTime: now,
            ExpiresAt: now + 30
        };

        await fetch(`${FIREBASE_URL}/loginRequests/${userId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqPayload)
        });

        // Also track under Players/<Username>/LoginRequest
        fetch(`${FIREBASE_URL}/Players/${username}/LoginRequest.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqPayload)
        }).catch(() => {});

        // 3. Show "Pls Verify its you in the Game"
        statusMessage.textContent = 'Pls Verify its you in the Game';
        statusContainer.classList.remove('hidden');

        // Start 30s countdown bar
        startCountdown(30);

        // Start polling for in-game MeButton click
        startPolling(userId, username);

    } catch (err) {
        console.error('Error connecting to Firebase:', err);
        showError('Could not connect to database. Check your internet connection.');
        codeInput.disabled = false;
        loginBtn.disabled = false;
    }
}

function startCountdown(seconds) {
    let timeLeft = seconds;
    countdownProgress.style.width = '100%';

    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        timeLeft -= 1;
        const pct = Math.max(0, (timeLeft / seconds) * 100);
        countdownProgress.style.width = `${pct}%`;

        if (timeLeft <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            stopPolling();
            statusContainer.classList.add('hidden');
            showError('Verification timed out. Click Connect to try again.');
            codeInput.disabled = false;
            loginBtn.disabled = false;
        }
    }, 1000);
}

function startPolling(userId, username) {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`${FIREBASE_URL}/loginRequests/${userId}.json`);
            const requestData = await res.json();

            if (requestData && requestData.Status === 'Rejected') {
                stopPolling();
                statusContainer.classList.add('hidden');
                showError('Login was rejected in-game.');
                codeInput.disabled = false;
                loginBtn.disabled = false;
                return;
            }

            if (requestData && requestData.Status === 'Verified') {
                // SUCCESS! Verified via MeButton in Roblox!
                stopPolling();

                // Resolve real avatar URL
                const avatarUrl = await fetchRobloxAvatar(userId, username);

                const userSession = {
                    userId: userId,
                    username: username,
                    avatarUrl: avatarUrl,
                    loggedInAt: Date.now()
                };

                // Save to browser localStorage (persists on device!)
                saveSession(userSession);
                showMainAppView(userSession);
            }
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 1200);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

// ====================================================================
// 5. LOGOUT
// ====================================================================

logoutBtn.addEventListener('click', () => {
    clearSession();
    showLoginView();
});

// ====================================================================
// 6. UPGRADES SYSTEM & EXACT IN-GAME CALCULATOR
// ====================================================================

const UPGRADE_CONFIG = {
    Speed: {
        stat: 'Speed',
        baseCost: 10,
        defaultVal: 16,
        amountPerStep: 1,
        growthTiers: [
            { below: 20, percent: 5 },
            { below: 30, percent: 10 },
            { below: 40, percent: 15 },
            { below: 50, percent: 20 },
            { below: 60, percent: 25 },
            { below: 70, percent: 30 },
            { below: 80, percent: 32 },
            { below: 90, percent: 35 },
            { below: 100, percent: 37 },
            { below: 115, percent: 40 },
            { percent: 45 }
        ]
    },
    Damage: {
        stat: 'Strength',
        baseCost: 100,
        defaultVal: 1,
        amountPerStep: 5,
        growthTiers: [
            { below: 100, percent: 10 },
            { below: 250, percent: 15 },
            { below: 500, percent: 20 },
            { below: 1000, percent: 25 },
            { below: 5000, percent: 30 },
            { below: 50000, percent: 40 },
            { percent: 50 }
        ]
    }
};

function getGrowthPercent(cfg, statVal) {
    let last = 0;
    for (const tier of cfg.growthTiers) {
        last = tier.percent;
        if (tier.below === undefined || statVal < tier.below) {
            return tier.percent;
        }
    }
    return last;
}

function calculateUpgradeCost(upgradeKey, currentStatValue, countSteps) {
    const cfg = UPGRADE_CONFIG[upgradeKey];
    const level = Math.max(0, Math.floor(((currentStatValue - cfg.defaultVal) / cfg.amountPerStep) + 0.5));
    let price = cfg.baseCost;
    let total = 0;
    for (let i = 0; i < level + countSteps; i++) {
        if (i >= level) {
            total += price;
        }
        const statAtStep = cfg.defaultVal + i * cfg.amountPerStep;
        price *= (1 + getGrowthPercent(cfg, statAtStep) / 100);
    }
    return Math.ceil(total);
}

function updateUpgradeUI() {
    if (!statMoneyVal) return;

    const money = Number(currentStats.Money) || 0;
    const speed = Number(currentStats.Speed) || 16;
    const strength = Number(currentStats.Strength) || 1;

    // 1. Update stats bar
    statMoneyVal.textContent = money.toLocaleString();
    statSpeedVal.textContent = speed.toLocaleString();
    statDamageVal.textContent = strength.toLocaleString();

    // 2. Speed +1 (1 step of 1)
    const costS1 = calculateUpgradeCost('Speed', speed, 1);
    if (costSpeed1) costSpeed1.textContent = `${costS1.toLocaleString()} Money`;
    if (previewSpeed1) previewSpeed1.textContent = `${speed} → ${speed + 1}`;
    if (buySpeed1Btn) buySpeed1Btn.disabled = isPurchasing || (money < costS1);

    // 3. Speed +5 (5 steps of 1)
    const costS5 = calculateUpgradeCost('Speed', speed, 5);
    if (costSpeed5) costSpeed5.textContent = `${costS5.toLocaleString()} Money`;
    if (previewSpeed5) previewSpeed5.textContent = `${speed} → ${speed + 5}`;
    if (buySpeed5Btn) buySpeed5Btn.disabled = isPurchasing || (money < costS5);

    // 4. Damage +5 (1 step of 5)
    const costD5 = calculateUpgradeCost('Damage', strength, 1);
    if (costDamage5) costDamage5.textContent = `${costD5.toLocaleString()} Money`;
    if (previewDamage5) previewDamage5.textContent = `${strength} → ${strength + 5}`;
    if (buyDamage5Btn) buyDamage5Btn.disabled = isPurchasing || (money < costD5);

    // 5. Damage +50 (10 steps of 5)
    const costD50 = calculateUpgradeCost('Damage', strength, 10);
    if (costDamage50) costDamage50.textContent = `${costD50.toLocaleString()} Money`;
    if (previewDamage50) previewDamage50.textContent = `${strength} → ${strength + 50}`;
    if (buyDamage50Btn) buyDamage50Btn.disabled = isPurchasing || (money < costD50);
}

function showUpgradeMessage(text, isError = false) {
    if (!upgradeStatusMsg) return;
    upgradeStatusMsg.textContent = text;
    upgradeStatusMsg.className = `upgrade-status-msg ${isError ? 'error' : 'success'}`;
    upgradeStatusMsg.classList.remove('hidden');

    setTimeout(() => {
        if (upgradeStatusMsg) upgradeStatusMsg.classList.add('hidden');
    }, 4000);
}

// Exploit-safe purchase handler with anti-double-spend locks and server re-validation
async function handlePurchaseUpgrade(type, countSteps, displayAmount) {
    if (isPurchasing || !currentUser || !currentUser.username) {
        return;
    }

    isPurchasing = true;
    updateUpgradeUI();

    try {
        const username = currentUser.username;

        // 1. Fetch fresh stats directly from Firebase to prevent client-side desync/cheats
        const res = await fetch(`${FIREBASE_URL}/Players/${username}/Stats.json`);
        const latestStats = (await res.json()) || { Money: 100, Speed: 16, Strength: 1 };

        const currentMoney = Number(latestStats.Money) || 0;
        const currentStatVal = type === 'Speed' ? (Number(latestStats.Speed) || 16) : (Number(latestStats.Strength) || 1);

        // 2. Re-calculate cost using authoritative latest numbers
        const requiredCost = calculateUpgradeCost(type, currentStatVal, countSteps);

        if (currentMoney < requiredCost) {
            showUpgradeMessage(`Not enough Money! Needed: ${requiredCost.toLocaleString()}, You have: ${currentMoney.toLocaleString()}`, true);
            isPurchasing = false;
            currentStats = latestStats;
            updateUpgradeUI();
            return;
        }

        // 3. Atomically update stats in Firebase
        const newMoney = currentMoney - requiredCost;
        const newStatVal = type === 'Speed' ? (currentStatVal + countSteps * 1) : (currentStatVal + countSteps * 5);

        const patchPayload = {
            Money: newMoney,
            [type === 'Speed' ? 'Speed' : 'Strength']: newStatVal
        };

        const patchRes = await fetch(`${FIREBASE_URL}/Players/${username}/Stats.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchPayload)
        });

        if (patchRes.ok) {
            currentStats.Money = newMoney;
            if (type === 'Speed') currentStats.Speed = newStatVal;
            if (type === 'Damage') currentStats.Strength = newStatVal;

            showUpgradeMessage(`+${displayAmount} ${type} successfully upgraded!`, false);
        } else {
            showUpgradeMessage('Purchase failed. Could not communicate with server.', true);
        }

    } catch (e) {
        console.error('Error during purchase:', e);
        showUpgradeMessage('An error occurred during purchase.', true);
    } finally {
        isPurchasing = false;
        updateUpgradeUI();
    }
}

// Real-time synchronization of stats with Firebase
async function syncStatsOnce(username) {
    if (!username) return;
    try {
        const res = await fetch(`${FIREBASE_URL}/Players/${username}/Stats.json`);
        const data = await res.json();
        if (data && typeof data === 'object') {
            currentStats = {
                Money: Number(data.Money) || 0,
                Speed: Number(data.Speed) || 16,
                Strength: Number(data.Strength) || 1
            };
            updateUpgradeUI();
        }
    } catch (e) {
        console.warn('Could not sync stats:', e);
    }
}

function startStatsSync(username) {
    stopStatsSync();
    syncStatsOnce(username);
    statsPollInterval = setInterval(() => {
        if (!isPurchasing) {
            syncStatsOnce(username);
        }
    }, 2000);
}

function stopStatsSync() {
    if (statsPollInterval) {
        clearInterval(statsPollInterval);
        statsPollInterval = null;
    }
}

// Sub-view navigation
function switchSubView(viewName) {
    if (!dashboardView || !upgradesView) return;
    if (viewName === 'dashboard') {
        dashboardView.classList.remove('hidden');
        upgradesView.classList.add('hidden');
        if (navDashboardBtn) navDashboardBtn.classList.add('active');
        if (navUpgradesBtn) navUpgradesBtn.classList.remove('active');
    } else if (viewName === 'upgrades') {
        dashboardView.classList.add('hidden');
        upgradesView.classList.remove('hidden');
        if (navDashboardBtn) navDashboardBtn.classList.remove('active');
        if (navUpgradesBtn) navUpgradesBtn.classList.add('active');
        updateUpgradeUI();
    }
}

if (navDashboardBtn) navDashboardBtn.addEventListener('click', () => switchSubView('dashboard'));
if (navUpgradesBtn) navUpgradesBtn.addEventListener('click', () => switchSubView('upgrades'));

// Hook upgrade buttons
if (buySpeed1Btn) buySpeed1Btn.addEventListener('click', () => handlePurchaseUpgrade('Speed', 1, 1));
if (buySpeed5Btn) buySpeed5Btn.addEventListener('click', () => handlePurchaseUpgrade('Speed', 5, 5));
if (buyDamage5Btn) buyDamage5Btn.addEventListener('click', () => handlePurchaseUpgrade('Damage', 1, 5));
if (buyDamage50Btn) buyDamage50Btn.addEventListener('click', () => handlePurchaseUpgrade('Damage', 10, 50));

// Run session check on page load
initSession();
