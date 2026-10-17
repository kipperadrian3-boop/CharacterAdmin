// app.js - Character Admin Frontend Logic
// Manages authentication, in-game 2FA polling, and persistent device sessions via localStorage.

const STORAGE_KEY = 'character_admin_session';

// DOM Elements
const loginView        = document.getElementById('loginView');
const mainAppView      = document.getElementById('mainAppView');
const codeInput        = document.getElementById('codeInput');
const loginBtn         = document.getElementById('loginBtn');
const statusContainer  = document.getElementById('statusContainer');
const statusMessage    = document.getElementById('statusMessage');
const countdownProgress = document.getElementById('countdownProgress');
const errorMessage     = document.getElementById('errorMessage');
const userAvatar       = document.getElementById('userAvatar');
const userName         = document.getElementById('userName');
const logoutBtn        = document.getElementById('logoutBtn');

let pollInterval = null;
let countdownTimer = null;

// ====================================================================
// 1. PERSISTENT BROWSER SESSION MANAGEMENT (localStorage)
// ====================================================================

async function initSession() {
    const rawSaved = localStorage.getItem(STORAGE_KEY);
    if (!rawSaved) {
        showLoginView();
        return;
    }

    try {
        const session = JSON.parse(rawSaved);
        if (session && session.sessionToken) {
            // Verify with server
            const res = await fetch('/api/auth/verify-session', {
                headers: {
                    'Authorization': `Bearer ${session.sessionToken}`
                }
            });

            const data = await res.json();
            if (data.valid && data.user) {
                // Session valid -> Auto login immediately!
                showMainAppView(data.user);
                return;
            }
        }
    } catch (e) {
        console.error('Error validating stored session:', e);
    }

    // Invalid session
    localStorage.removeItem(STORAGE_KEY);
    showLoginView();
}

function saveSession(sessionToken, user) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionToken, user }));
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

function showMainAppView(user) {
    stopPolling();
    loginView.classList.add('hidden');
    mainAppView.classList.remove('hidden');

    if (user) {
        userName.textContent = user.username || 'Player';
        userAvatar.src = user.avatarUrl || 'https://tr.rbxcdn.com/38c6edcb50633730ff4cf39ac8859840/150/150/AvatarHeadshot/Png';
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
// 4. CONNECT & 2FA VERIFICATION POLLING
// ====================================================================

async function handleConnect() {
    const raw = codeInput.value.trim();
    if (!raw) {
        showError('Please enter your code from the game.');
        return;
    }

    hideError();
    codeInput.disabled = true;
    loginBtn.disabled = true;

    try {
        const res = await fetch('/api/auth/request-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: raw })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            showError(data.error || 'Code verification failed.');
            codeInput.disabled = false;
            loginBtn.disabled = false;
            return;
        }

        // Show prompt: "Pls Verify its you in the Game"
        statusMessage.textContent = data.message || 'Pls Verify its you in the Game';
        statusContainer.classList.remove('hidden');

        // Start 30s countdown progress bar
        startCountdown(30);

        // Start polling verification status
        startPolling(data.userId);

    } catch (err) {
        showError('Could not connect to server. Check your connection.');
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
            showError('Verification timed out. Please click Connect to try again.');
            codeInput.disabled = false;
            loginBtn.disabled = false;
        }
    }, 1000);
}

function startPolling(userId) {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/auth/check-status?userId=${userId}`);
            const data = await res.json();

            if (data.verified && data.sessionToken && data.user) {
                // SUCCESS! Verified via MeButton in-game!
                stopPolling();
                saveSession(data.sessionToken, data.user);
                showMainAppView(data.user);
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

logoutBtn.addEventListener('click', async () => {
    const rawSaved = localStorage.getItem(STORAGE_KEY);
    if (rawSaved) {
        try {
            const session = JSON.parse(rawSaved);
            if (session && session.sessionToken) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session.sessionToken}` }
                });
            }
        } catch (e) {}
    }

    clearSession();
    showLoginView();
});

// Run session check on initial page load
initSession();
