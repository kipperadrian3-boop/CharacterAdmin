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

let pollInterval = null;
let countdownTimer = null;

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

// Run session check on page load
initSession();
