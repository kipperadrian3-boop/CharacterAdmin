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
const userInGameStatus  = document.getElementById('userInGameStatus');
const logoutBtn         = document.getElementById('logoutBtn');

let isPlayerInGame = false;

function updateInGameUI(inGame) {
    isPlayerInGame = inGame === true;
    if (userInGameStatus) {
        if (isPlayerInGame) {
            userInGameStatus.textContent = 'In Game';
            userInGameStatus.className = 'ingame-pill online';
        } else {
            userInGameStatus.textContent = 'Offline';
            userInGameStatus.className = 'ingame-pill offline';
        }
    }
}

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
const upgradesList      = document.getElementById('upgradesList');

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

async function resolveAndApplyUserLevel(user) {
    if (!user || !user.username) return 0;
    let level = Number(user.level || user.adminLevel || 0);

    try {
        // Query Firebase player profile to get live level
        const res = await fetch(`${FIREBASE_URL}/Players/${user.username}.json`);
        const data = await res.json();
        if (data && typeof data === 'object') {
            const rawLevel = data.Level !== undefined ? data.Level : (data.AdminLevel !== undefined ? data.AdminLevel : (data.Stats && data.Stats.Level !== undefined ? data.Stats.Level : null));
            if (rawLevel !== null && !isNaN(Number(rawLevel))) {
                level = Number(rawLevel);
            }
        }

        // Fallback to /config/admins if not set in player record
        if (level === 0) {
            const adminRes = await fetch(`${FIREBASE_URL}/config/admins/${user.username}.json`);
            const adminVal = await adminRes.json();
            if (typeof adminVal === 'number') {
                level = adminVal;
            }
        }
    } catch (e) {
        console.warn('Could not fetch player level:', e);
    }

    user.level = level;
    saveSession(user);

    // Dashboard button is only visible if level is 50 or higher
    const hasDashboardAccess = level >= 50;
    if (navDashboardBtn) {
        if (hasDashboardAccess) {
            navDashboardBtn.classList.remove('hidden');
        } else {
            navDashboardBtn.classList.add('hidden');
        }
    }

    // If level < 50, ensure user stays on upgrades view
    if (!hasDashboardAccess) {
        switchSubView('upgrades');
    }

    return level;
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

        // Initialize view based on stored level (if >= 50 show dashboard button, otherwise default to upgrades)
        const initialLevel = Number(user.level || 0);
        if (initialLevel >= 50) {
            if (navDashboardBtn) navDashboardBtn.classList.remove('hidden');
            switchSubView('dashboard');
        } else {
            if (navDashboardBtn) navDashboardBtn.classList.add('hidden');
            switchSubView('upgrades');
        }

        // Resolve live level from Firebase and sync stats
        resolveAndApplyUserLevel(user);
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
    stopStatsSync();
    clearSession();
    showLoginView();
});

// ====================================================================
// 6. UPGRADES SYSTEM - DYNAMICALLY SYNCED FROM UpgradeConfig.luau
// ====================================================================

let upgradeConfig = null;

// Dynamically loads the game's exact UpgradeConfig from Firebase (Single Source of Truth!)
async function loadUpgradeConfig() {
    try {
        const res = await fetch(`${FIREBASE_URL}/config/upgrades.json`);
        const data = await res.json();
        if (data && typeof data === 'object') {
            upgradeConfig = data;
            updateUpgradeUI();
        }
    } catch (e) {
        console.warn('Could not load remote upgrade config:', e);
    }
}

function getGrowthPercent(cfg, statVal) {
    const tiers = cfg.GrowthTiers || cfg.growthTiers || [];
    let last = 0;
    for (const tier of tiers) {
        const percent = tier.Percent !== undefined ? tier.Percent : tier.percent;
        const below = tier.Below !== undefined ? tier.Below : tier.below;
        last = percent;
        if (below === undefined || statVal < below) {
            return percent;
        }
    }
    return last;
}

function calculateUpgradeCost(cfg, currentStatValue, countSteps) {
    if (!cfg) return 0;
    const defaultVal = Number(cfg.Default) || 0;
    const amountPerStep = Number(cfg.AmountPerStep) || 1;
    const baseCost = Number(cfg.BaseCost) || 10;

    const level = Math.max(0, Math.floor(((currentStatValue - defaultVal) / amountPerStep) + 0.5));
    let price = baseCost;
    let total = 0;
    for (let i = 0; i < level + countSteps; i++) {
        if (i >= level) {
            total += price;
        }
        const statAtStep = defaultVal + i * amountPerStep;
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

    if (!upgradesList) return;

    if (!upgradeConfig) {
        upgradesList.innerHTML = '<div class="upgrade-loading">Loading upgrade configurations...</div>';
        return;
    }

    // 2. Render cards dynamically directly from Roblox UpgradeConfig (Single Source of Truth)
    let html = '';
    for (const [upgradeName, cfg] of Object.entries(upgradeConfig)) {
        const statKey = cfg.Stat || (upgradeName === 'Speed' ? 'Speed' : 'Strength');
        const currentVal = Number(currentStats[statKey]) !== undefined && !isNaN(Number(currentStats[statKey]))
            ? Number(currentStats[statKey])
            : (Number(cfg.Default) || 0);

        const buttons = Array.isArray(cfg.Buttons) ? cfg.Buttons : Object.entries(cfg.Buttons || {}).map(([k, v]) => ({
            Key: k,
            Steps: typeof v === 'object' ? v.Steps : v,
            Amount: typeof v === 'object' ? v.Amount : (v * (Number(cfg.AmountPerStep) || 1)),
            Label: typeof v === 'object' ? v.Label : `+${v * (Number(cfg.AmountPerStep) || 1)} ${upgradeName}`
        }));

        for (const btn of buttons) {
            const steps = Number(btn.Steps) || 1;
            const amount = Number(btn.Amount) || (steps * (Number(cfg.AmountPerStep) || 1));
            const cost = calculateUpgradeCost(cfg, currentVal, steps);
            const nextVal = currentVal + amount;
            const canAfford = money >= cost;
            const isDisabled = isPurchasing || !canAfford;
            const label = btn.Label || `+${amount} ${upgradeName}`;

            html += `
                <div class="upgrade-card" data-upgrade="${upgradeName}" data-steps="${steps}">
                    <div class="upgrade-card-left">
                        <span class="upgrade-type-tag">${upgradeName.toUpperCase()}</span>
                        <h3 class="upgrade-title">${label}</h3>
                        <p class="upgrade-preview">${currentVal.toLocaleString()} → ${nextVal.toLocaleString()}</p>
                    </div>
                    <div class="upgrade-card-right">
                        <span class="upgrade-cost-tag">${cost.toLocaleString()} ${cfg.CostStat || 'Money'}</span>
                        <button class="upgrade-buy-btn" data-upgrade="${upgradeName}" data-steps="${steps}" data-amount="${amount}" data-label="${label}" ${isDisabled ? 'disabled' : ''}>
                            Buy
                        </button>
                    </div>
                </div>
            `;
        }
    }

    upgradesList.innerHTML = html;

    // Attach click events
    const buyBtns = upgradesList.querySelectorAll('.upgrade-buy-btn');
    buyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const upg = btn.getAttribute('data-upgrade');
            const steps = parseInt(btn.getAttribute('data-steps'), 10);
            const amount = parseInt(btn.getAttribute('data-amount'), 10);
            const label = btn.getAttribute('data-label');
            handlePurchaseUpgrade(upg, steps, amount, label);
        });
    });
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

// Exploit-safe purchase handler using dynamic Roblox UpgradeConfig
async function handlePurchaseUpgrade(type, countSteps, displayAmount, label) {
    if (isPurchasing || !currentUser || !currentUser.username || !upgradeConfig) {
        return;
    }

    isPurchasing = true;
    updateUpgradeUI();

    try {
        const username = currentUser.username;
        const cfg = upgradeConfig[type];
        if (!cfg) {
            isPurchasing = false;
            return;
        }

        const statKey = cfg.Stat || (type === 'Speed' ? 'Speed' : 'Strength');
        const costCurrencyKey = cfg.CostStat || 'Money';

        // ── CHECK 1: Local Pre-Check ──
        const localMoney = Number(currentStats[costCurrencyKey]) || 0;
        const localStatVal = Number(currentStats[statKey]) || (Number(cfg.Default) || 0);
        const estimatedCost = calculateUpgradeCost(cfg, localStatVal, countSteps);

        if (localMoney < estimatedCost) {
            showUpgradeMessage(`Not enough ${costCurrencyKey}! Needed: ${estimatedCost.toLocaleString()}, You have: ${localMoney.toLocaleString()}`, true);
            isPurchasing = false;
            updateUpgradeUI();
            return;
        }

        // ── CHECK 2: Fresh Database Pre-Check ──
        const res = await fetch(`${FIREBASE_URL}/Players/${username}/Stats.json`);
        const latestStats = (await res.json()) || {};
        const dbMoney = (latestStats[costCurrencyKey] !== undefined && !isNaN(Number(latestStats[costCurrencyKey])))
            ? Number(latestStats[costCurrencyKey])
            : localMoney;
        const dbStatVal = (latestStats[statKey] !== undefined && !isNaN(Number(latestStats[statKey])))
            ? Number(latestStats[statKey])
            : localStatVal;

        const dbRequiredCost = calculateUpgradeCost(cfg, dbStatVal, countSteps);
        if (dbMoney < dbRequiredCost) {
            showUpgradeMessage(`Not enough ${costCurrencyKey}! Needed: ${dbRequiredCost.toLocaleString()}, Database has: ${dbMoney.toLocaleString()}`, true);
            currentStats[costCurrencyKey] = dbMoney;
            currentStats[statKey] = dbStatVal;
            isPurchasing = false;
            updateUpgradeUI();
            return;
        }

        // ── CHECK 3: Send to Roblox Server and wait for Authoritative Server Response! ──
        const reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const purchasePayload = {
            RequestId: reqId,
            Username: username,
            UpgradeId: type,
            Steps: countSteps,
            Amount: displayAmount,
            ExpectedCost: dbRequiredCost,
            Status: 'Pending',
            CreatedAt: Math.floor(Date.now() / 1000)
        };

        // Post purchase request to Firebase
        await fetch(`${FIREBASE_URL}/purchaseRequests/${reqId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(purchasePayload)
        });

        // Wait for Roblox Server response (poll every 500ms, timeout 12s)
        let resolved = false;
        let attempts = 0;
        const maxAttempts = 24; // 12 seconds max

        while (!resolved && attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;

            try {
                const checkRes = await fetch(`${FIREBASE_URL}/purchaseRequests/${reqId}.json`);
                const result = await checkRes.json();

                if (result && result.Status === 'Approved') {
                    resolved = true;
                    // Roblox server successfully executed and applied the upgrade!
                    if (result.NewMoney !== undefined) currentStats[costCurrencyKey] = Number(result.NewMoney);
                    if (result.NewStat !== undefined) currentStats[statKey] = Number(result.NewStat);

                    // Clean up resolved purchase request
                    fetch(`${FIREBASE_URL}/purchaseRequests/${reqId}.json`, { method: 'DELETE' }).catch(() => {});
                    break;
                } else if (result && result.Status === 'Rejected') {
                    resolved = true;
                    showUpgradeMessage(result.Reason || 'Purchase rejected by Roblox server.', true);
                    syncStatsOnce(username);
                    fetch(`${FIREBASE_URL}/purchaseRequests/${reqId}.json`, { method: 'DELETE' }).catch(() => {});
                    break;
                }
            } catch (err) {
                console.warn('Polling purchase status error:', err);
            }
        }

        if (!resolved) {
            showUpgradeMessage('Roblox server did not respond. You must be in the Roblox game to purchase upgrades.', true);
            fetch(`${FIREBASE_URL}/purchaseRequests/${reqId}.json`, { method: 'DELETE' }).catch(() => {});
        }

    } catch (e) {
        console.error('Error during purchase:', e);
        showUpgradeMessage('An error occurred during purchase.', true);
    } finally {
        isPurchasing = false;
        updateUpgradeUI();
    }
}

// Real-time synchronization of stats and live in-game status with Firebase
async function syncStatsOnce(username) {
    if (!username) return;
    try {
        const [statsRes, playerRes] = await Promise.all([
            fetch(`${FIREBASE_URL}/Players/${username}/Stats.json`),
            fetch(`${FIREBASE_URL}/Players/${username}.json`)
        ]);
        const data = await statsRes.json();
        const playerData = await playerRes.json();

        if (playerData && typeof playerData === 'object') {
            updateInGameUI(playerData.IsInGame === true);
        }

        if (data && typeof data === 'object') {
            currentStats = {
                Money: (data.Money !== undefined && !isNaN(Number(data.Money))) ? Number(data.Money) : 0,
                Speed: (data.Speed !== undefined && !isNaN(Number(data.Speed))) ? Number(data.Speed) : 16,
                Strength: (data.Strength !== undefined && !isNaN(Number(data.Strength))) ? Number(data.Strength) : 1
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

// Sub-view navigation (Dashboard is restricted to level 50+)
function switchSubView(viewName) {
    if (!dashboardView || !upgradesView) return;

    const userLevel = Number(currentUser && (currentUser.level || currentUser.adminLevel) || 0);
    if (viewName === 'dashboard' && userLevel < 50) {
        viewName = 'upgrades';
    }

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
        loadUpgradeConfig();
        updateUpgradeUI();
    }
}

if (navDashboardBtn) navDashboardBtn.addEventListener('click', () => switchSubView('dashboard'));
if (navUpgradesBtn) navUpgradesBtn.addEventListener('click', () => switchSubView('upgrades'));

// Run session check on page load
initSession();
loadUpgradeConfig();
