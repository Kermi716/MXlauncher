const API_URL = "https://api.mxlauncher.fun";

async function getSha256Hash(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const origFetch = window.fetch;
window.fetch = async function (url, options = {}) {
    if (typeof url === 'string' && url.includes(API_URL)) {
        const exempt = ['/handshake', '/check_update', '/online', '/get_downloads', '/get_ad'];
        const isExempt = exempt.some(endpoint => url.includes(endpoint));

        if (!isExempt) {
            let session_id = sessionStorage.getItem('mx_session_id');
            let session_secret = sessionStorage.getItem('mx_session_secret');

            if (!session_id || !session_secret) {
                try {
                    const hs_res = await origFetch(`${API_URL}/handshake`);
                    if (hs_res.ok) {
                        const hs_data = await hs_res.json();
                        session_id = hs_data.session_id;
                        session_secret = hs_data.session_secret;
                        sessionStorage.setItem('mx_session_id', session_id);
                        sessionStorage.setItem('mx_session_secret', session_secret);

                        if (hs_data.server_time) {
                            const localTime = Date.now() / 1000;
                            sessionStorage.setItem('mx_time_offset', hs_data.server_time - localTime);
                        }
                    }
                } catch (e) { }
            }

            if (session_id && session_secret) {
                const timeOffset = parseFloat(sessionStorage.getItem('mx_time_offset')) || 0;
                const timestamp = (Date.now() / 1000 + timeOffset).toString();

                const nonce = crypto.randomUUID();
                const urlObj = new URL(url);
                const path = urlObj.pathname;
                const method = (options.method || 'GET').toUpperCase();
                let bodyString = "";
                if (options.body) bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);

                const bodyHash = await getSha256Hash(bodyString);
                const message = `${method}:${path}:${timestamp}:${nonce}:${bodyHash}`;

                const encoder = new TextEncoder();
                const keyData = encoder.encode(session_secret);
                const msgData = encoder.encode(message);
                const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
                const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
                const signatureArray = Array.from(new Uint8Array(signatureBuffer));
                const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

                options.headers = {
                    ...options.headers,
                    'X-Session-Id': session_id,
                    'X-Signature': signatureHex,
                    'X-Timestamp': timestamp,
                    'X-Nonce': nonce
                };
            }
        }
    }
    return origFetch(url, options);
};

origFetch(`${API_URL}/handshake`).then(r => r.json()).then(d => {
    if (d.session_id) {
        sessionStorage.setItem('mx_session_id', d.session_id);
        sessionStorage.setItem('mx_session_secret', d.session_secret);
        if (d.server_time) {
            const localTime = Date.now() / 1000;
            sessionStorage.setItem('mx_time_offset', d.server_time - localTime);
        }
    }
}).catch(() => { });

function openMobileNav() {
    document.getElementById('mobileNav').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeMobileNav() {
    document.getElementById('mobileNav').classList.remove('open');
    document.body.style.overflow = '';
}

function showNotification(title, text, isSuccess = false) {
    const toast = document.getElementById('notificationToast');
    document.getElementById('toastTitle').innerText = title;
    document.getElementById('toastDesc').innerText = text;
    toast.className = 'toast';
    if (!isSuccess) toast.classList.add('toast-error');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
}

let authMode = 'login';
let tgLinkOpened = false;

function openAuthModal(e) {
    if (e) e.preventDefault();
    document.getElementById('authModal').classList.add('active');
    switchAuthMode('login');
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
    const am = document.getElementById('authModal');
    if (am) {
        am.addEventListener('click', function (e) {
            if (e.target === this) closeAuthModal();
        });
    }
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAuthModal();
});

function togglePasswordVisibility() {
    const inp = document.getElementById('auth-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function loadCaptcha() {
    const img = document.getElementById('auth-captcha-image');
    const idInput = document.getElementById('auth-captcha-id');
    const textInput = document.getElementById('auth-captcha-text');
    if (!img) return;

    img.style.opacity = '0.4';
    textInput.value = '';
    try {
        const res = await fetch(`${API_URL}/get_captcha`);
        const data = await res.json();
        if (data.status === 'ok') {
            img.src = data.image_base64;
            idInput.value = data.captcha_id;
            img.style.opacity = '1';
        }
    } catch (e) { img.style.opacity = '1'; }
}

function switchAuthMode(mode) {
    authMode = mode;
    tgLinkOpened = false;

    document.getElementById('auth-status').innerText = "";
    document.getElementById('auth-status').style.color = "var(--error-color, #ff5555)";

    const title = document.getElementById('auth-modal-title-text');
    const sub = document.getElementById('auth-modal-sub-text');
    const btn = document.getElementById('auth-submit-btn');

    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('tab-register').classList.remove('active');

    document.getElementById('auth-username-group').style.display = 'block';
    document.getElementById('auth-pass-group').style.display = 'block';
    document.getElementById('auth-captcha-group').style.display = 'block';
    document.getElementById('auth-forgot-btn').style.display = 'none';
    document.getElementById('auth-switch-btn').style.display = 'block';
    document.getElementById('auth-username').disabled = false;
    document.getElementById('auth-username').value = '';

    if (mode === 'login') {
        document.getElementById('tab-login').classList.add('active');
        title.innerText = "Добро пожаловать";
        sub.innerText = "Войдите в свой аккаунт";
        document.getElementById('auth-forgot-btn').style.display = 'block';
        document.getElementById('auth-username').placeholder = "Логин";
        document.getElementById('auth-switch-btn').innerText = "Нет аккаунта? Регистрация";
        document.getElementById('auth-switch-btn').onclick = () => switchAuthMode('register');
        btn.innerText = "ВОЙТИ";
    }
    else if (mode === 'register') {
        document.getElementById('tab-register').classList.add('active');
        title.innerText = "Создать аккаунт";
        sub.innerText = "Регистрация через Telegram";
        document.getElementById('auth-username').placeholder = "Придумайте логин";
        document.getElementById('auth-switch-btn').innerText = "Уже есть аккаунт? Войти";
        document.getElementById('auth-switch-btn').onclick = () => switchAuthMode('login');
        btn.innerText = "ОТПРАВИТЬ В ТЕЛЕГРАМ";
    }
    else if (mode === 'reset') {
        title.innerText = "Сброс пароля";
        sub.innerText = "Восстановление доступа";
        document.getElementById('auth-username').placeholder = "Ваш логин";
        document.getElementById('auth-password').placeholder = "Новый пароль";
        document.getElementById('auth-switch-btn').innerText = "Вспомнили? Войти";
        document.getElementById('auth-switch-btn').onclick = () => switchAuthMode('login');
        btn.innerText = "ОТПРАВИТЬ В ТЕЛЕГРАМ";
    }
    else if (mode === 'link') {
        title.innerText = "Привязка Telegram";
        sub.innerText = "Требование безопасности";
        document.getElementById('auth-username').placeholder = "Ваш логин";
        document.getElementById('auth-switch-btn').innerText = "Войти в другой аккаунт";
        document.getElementById('auth-switch-btn').onclick = () => switchAuthMode('login');
        btn.innerText = "ПОЛУЧИТЬ ССЫЛКУ";
    }
    loadCaptcha();
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const user = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value.trim();
    const capText = document.getElementById('auth-captcha-text').value.trim();
    const capId = document.getElementById('auth-captcha-id').value;

    const btn = document.getElementById('auth-submit-btn');
    const status = document.getElementById('auth-status');
    status.style.color = 'var(--error-color, #ff5555)';

    if (!user || !pass) { status.innerText = "Заполните логин и пароль!"; return; }

    if (authMode !== 'login' && !tgLinkOpened) {
        if (!capText) { status.innerText = "Введите капчу!"; return; }
        btn.disabled = true; btn.innerText = "ПОЛУЧЕНИЕ ССЫЛКИ...";

        try {
            const res = await fetch(`${API_URL}/get_tg_link`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, action: authMode, captcha_id: capId, captcha_text: capText })
            });
            const data = await res.json();
            if (res.ok) {
                tgLinkOpened = true;
                window.open(data.link, '_blank');
                status.style.color = 'var(--success-color, #2ecc71)';
                status.innerText = "Перейдите в Telegram, нажмите СТАРТ, а затем кнопку ниже.";

                document.getElementById('auth-captcha-group').style.display = 'none';
                if (authMode === 'register') btn.innerText = "ЗАВЕРШИТЬ РЕГИСТРАЦИЮ";
                if (authMode === 'reset') btn.innerText = "СМЕНИТЬ ПАРОЛЬ";
                if (authMode === 'link') btn.innerText = "ЗАВЕРШИТЬ ПРИВЯЗКУ";
            } else {
                status.innerText = data.error || "Ошибка получения ссылки";
                loadCaptcha();
            }
        } catch (e) { status.innerText = "Ошибка сервера"; }
        btn.disabled = false;
        return;
    }

    btn.disabled = true; btn.innerText = "ОБРАБОТКА...";

    let endpoint = "";
    let payload = { username: user, password: pass };

    if (authMode === 'login') {
        if (!capText) { status.innerText = "Введите капчу!"; btn.disabled = false; btn.innerText = "ВОЙТИ"; return; }
        endpoint = "/login";
        payload.captcha_id = capId;
        payload.captcha_text = capText;
    } else if (authMode === 'register') {
        endpoint = "/register";
    } else if (authMode === 'reset') {
        endpoint = "/reset_password";
        payload = { username: user, new_password: pass };
    } else if (authMode === 'link') {
        endpoint = "/link_tg";
    }

    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
            status.style.color = 'var(--success-color, #2ecc71)';
            if (authMode === 'login') {
                localStorage.setItem('mx_token', data.token);
                localStorage.setItem('mx_username', data.username);
                closeAuthModal();
                showNotification("Добро пожаловать", data.username, true);
                setTimeout(() => window.location.reload(), 1000);
            } else {
                let msg = "Успешно!";
                if (authMode === 'register') msg = "Регистрация успешна! Входим...";
                if (authMode === 'reset') msg = "Пароль изменен! Входим...";
                if (authMode === 'link') msg = "Telegram привязан! Входим...";
                status.innerText = msg;
                setTimeout(() => switchAuthMode('login'), 1500);
            }
        } else {
            if (authMode === 'login' && data.error === 'no_tg' && data.require_link) {
                document.getElementById('auth-username').value = data.username || user;
                document.getElementById('auth-username').disabled = true;
                switchAuthMode('link');
                document.getElementById('auth-status').innerText = "Требуется привязка Telegram! Введите пароль и получите ссылку.";
            } else {
                status.innerText = data.error || "Ошибка";
                if (authMode === 'login') loadCaptcha();
            }
        }
    } catch (e) { status.innerText = "Ошибка сервера"; }

    btn.disabled = false;
    if (authMode === 'login') btn.innerText = "ВОЙТИ";
    else if (!tgLinkOpened) btn.innerText = "ОТПРАВИТЬ В ТЕЛЕГРАМ";
}

async function fetchDownloadCount() {
    try {
        const res = await fetch(`${API_URL}/get_downloads`);
        const data = await res.json();
        if (data.status === 'ok') document.getElementById('download-counter').innerText = data.count.toLocaleString('ru');
    } catch { }
}

async function handleDownload(e) {
    if (e) e.preventDefault();
    try { await fetch(`${API_URL}/increment_downloads`, { method: 'POST' }); fetchDownloadCount(); } catch { }
    showNotification("Загрузка", "Скачивание началось...", true);
    window.location.href = "https://github.com/Kermi716/MXlauncher/releases/download/mxupdate/MXSetup.exe";
}

async function fetchLauncherRating() {
    try {
        const res = await fetch(`${API_URL}/get_launcher_rating`);
        const data = await res.json();
        if (data.status === 'ok') {
            const likes = data.likes || 0, dislikes = data.dislikes || 0;
            const total = likes + dislikes;
            document.getElementById('like-count').innerText = likes;
            document.getElementById('dislike-count').innerText = dislikes;
            const lp = total > 0 ? (likes / total) * 100 : 50;
            document.getElementById('rating-bar-like').style.width = `${lp}%`;
            document.getElementById('rating-bar-dislike').style.width = `${100 - lp}%`;
        }
    } catch { }
}

async function handleRate(action) {
    const token = localStorage.getItem('mx_token');
    const username = localStorage.getItem('mx_username');
    if (!token || !username) {
        showNotification("Требуется вход", "Оценки доступны только для зарегистрированных пользователей");
        openAuthModal(); return;
    }
    try {
        const res = await fetch(`${API_URL}/rate_launcher`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, token, action })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'ok') { showNotification("Голос учтён", "", true); fetchLauncherRating(); }
            else if (data.error === "unauthorized") {
                showNotification("Сессия истекла", "Войдите снова");
                localStorage.removeItem('mx_token'); localStorage.removeItem('mx_username');
                openAuthModal();
            }
        }
    } catch { showNotification("Ошибка", "Сервер недоступен"); }
}

async function checkServerStatus() {
    const dot = document.getElementById('server-dot');
    const text = document.getElementById('server-text');
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API_URL}/get_downloads?t=${Date.now()}`, { signal: controller.signal });
        clearTimeout(t);
        if (res.ok) { dot.classList.add('online'); text.innerText = 'ONLINE'; } else throw new Error();
    } catch { text.innerText = 'OFFLINE'; dot.classList.remove('online'); }
}

async function fetchOnlineCount() {
    try {
        const res = await fetch(`${API_URL}/online?t=${Date.now()}`);
        const data = await res.json();
        if (data.online !== undefined) document.getElementById('online-counter').innerText = data.online;
    } catch { document.getElementById('online-counter').innerText = "—"; }
}

async function fetchVersion() {
    try {
        const res = await fetch(`${API_URL}/check_update`);
        const data = await res.json();
        const ver = data.latest_version || data.version;
        if (ver) {
            const el = document.getElementById('version-label');
            if (el) el.textContent = `Ver. ${ver}`;
            const footerEl = document.getElementById('footer-version-label');
            if (footerEl) footerEl.textContent = `V. ${ver}`;
        }
    } catch { }
}

function initScrollReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => observer.observe(el));
}

function toggleFaq(btn) {
    const item = btn.closest('.faq-item');
    const body = item.querySelector('.faq-body');
    const isOpen = btn.getAttribute('aria-expanded') === 'true';

    document.querySelectorAll('.faq-trigger[aria-expanded="true"]').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
        b.closest('.faq-item').querySelector('.faq-body').classList.remove('open');
    });

    if (!isOpen) {
        btn.setAttribute('aria-expanded', 'true');
        body.classList.add('open');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchDownloadCount();
    fetchLauncherRating();
    checkServerStatus();
    fetchOnlineCount();
    fetchVersion();
    initScrollReveal();

    const savedUser = localStorage.getItem('mx_username');
    if (savedUser) {
        const btn = document.getElementById('auth-btn-footer');
        if (btn) { btn.textContent = 'Личный кабинет'; btn.onclick = null; btn.href = "profile.html"; }
        const mobileBtn = document.getElementById('mobile-auth-link');
        if (mobileBtn) { mobileBtn.textContent = 'Личный кабинет'; mobileBtn.onclick = null; mobileBtn.href = "profile.html"; }
    }

    if (window.Swiper) {
        new Swiper('.mySwiper', {
            effect: 'coverflow',
            grabCursor: true,
            centeredSlides: true,
            slidesPerView: 'auto',
            loop: true,
            autoplay: { delay: 3500, disableOnInteraction: false },
            coverflowEffect: { rotate: 10, stretch: 0, depth: 100, modifier: 1, slideShadows: false },
            pagination: { el: '.swiper-pagination', clickable: true, dynamicBullets: true },
            navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
        });
    }
});
