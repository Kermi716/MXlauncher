const API_URL = "https://api.mxlauncher.fun";

        const prices = {
            'START': 199,
            'MEDIUM': 499,
            'ULTIMATE': 999
        };

        const pricesUSD = {
            'START': 2.5,
            'MEDIUM': 6,
            'ULTIMATE': 12
        };

        let selectedTier = '';
        let selectedCurrency = 'RUB';

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
                            }
                        } catch (e) { }
                    }

                    if (session_id && session_secret) {
                        const timestamp = (Date.now() / 1000).toString();
                        const nonce = crypto.randomUUID();
                        const urlObj = new URL(url);
                        const path = urlObj.pathname;
                        const method = (options.method || 'GET').toUpperCase();

                        let bodyString = "";
                        if (options.body) {
                            bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
                        }
                        const bodyHash = await getSha256Hash(bodyString);

                        const message = `${method}:${path}:${timestamp}:${nonce}:${bodyHash}`;

                        const encoder = new TextEncoder();
                        const keyData = encoder.encode(session_secret);
                        const msgData = encoder.encode(message);

                        const cryptoKey = await crypto.subtle.importKey(
                            "raw", keyData, { name: "HMAC", hash: "SHA-256" },
                            false, ["sign"]
                        );
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

        const savedUser = localStorage.getItem('mx_username');
        const savedToken = localStorage.getItem('mx_token');

        let rawNotifHash = "";
        let rawTicketsHash = "";

        function openMobileNav() { document.getElementById('mobileNav').classList.add('open'); document.body.style.overflow = 'hidden'; }
        function closeMobileNav() { document.getElementById('mobileNav').classList.remove('open'); document.body.style.overflow = ''; }

        function showNotification(title, text, isError = false) {
            const toast = document.getElementById('notificationToast');
            document.getElementById('toastTitle').innerText = title;
            document.getElementById('toastDesc').innerText = text;
            toast.className = 'toast';
            if (isError) toast.classList.add('toast-error');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        function formatText(str) {
            if (!str) return '';
            let safeStr = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            safeStr = safeStr.replace(urlRegex, function (url) {
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--white); text-decoration:underline;">${url}</a>`;
            });
            return safeStr.replace(/\n/g, '<br>');
        }

        document.getElementById('bell-wrapper').addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = document.getElementById('notif-dropdown');
            if (dd.classList.contains('show')) {
                dd.classList.remove('show');
                document.getElementById('bell-badge').style.display = 'none';
            } else {
                dd.classList.add('show');
                document.getElementById('bell-badge').style.display = 'none';
                clearNotifBadge();
            }
        });

        document.addEventListener('click', (e) => {
            const dd = document.getElementById('notif-dropdown');
            if (dd.classList.contains('show') && !e.target.closest('#bell-wrapper')) {
                dd.classList.remove('show');
            }
        });

        async function clearNotifBadge() {
            try {
                await fetch(`${API_URL}/clear_notifications`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken })
                });
            } catch (e) { }
        }

        async function fetchVersion() {
            try {
                const res = await fetch(`${API_URL}/check_update`);
                const data = await res.json();
                const ver = data.latest_version || data.version;
                if (ver) {
                    const footerEl = document.getElementById('footer-version-label');
                    if (footerEl) footerEl.textContent = `Ver. ${ver}`;
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

        async function initProfile() {
            if (!savedUser || !savedToken) {
                window.location.href = "index.html";
                return;
            }

            initScrollReveal();

            try {
                const res = await fetch(`${API_URL}/get_user_info`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken })
                });

                if (res.ok) {
                    const data = await res.json();
                    document.getElementById('prof-name').innerText = data.username;
                    document.getElementById('prof-role').innerText = data.role.toUpperCase();
                    document.getElementById('prof-tg').innerText = data.telegram_id || "Не привязан";

                    const role = data.role.toLowerCase();
                    if (role === 'helper' || role === 'admin' || role === 'owner') {
                        document.getElementById('adminBtn').style.display = 'inline-block';
                    }

                    if (data.is_trial_eligible) {
                        document.getElementById('btn-trial').style.display = 'inline-block';
                    }
                } else if (res.status === 401) {
                    logout();
                } else {
                    document.getElementById('prof-name').innerText = "Ошибка загрузки";
                }
            } catch (e) {
                document.getElementById('prof-name').innerText = "Ошибка соединения";
            }

            await pollNotifications();
            await pollProfileTickets();
            await fetchVersion();

            setInterval(() => pollNotifications(), 5000);
            setInterval(() => pollProfileTickets(), 10000);
        }

        function logout() {
            localStorage.removeItem('mx_username');
            localStorage.removeItem('mx_token');
            window.location.href = 'index.html';
        }

        function openPaymentModal(tier) {
            selectedTier = tier;
            document.getElementById('payment-tier-label').innerText = `Выбранный тариф: ${tier}`;
            selectCurrency('RUB');
            document.getElementById('payment-modal').classList.add('active');
        }

        function closePaymentModal() {
            document.getElementById('payment-modal').classList.remove('active');
        }

        function selectCurrency(curr) {
            selectedCurrency = curr;
            document.getElementById('btn-rub').classList.remove('active');
            document.getElementById('btn-crypto').classList.remove('active');
            if (curr === 'RUB') {
                document.getElementById('btn-rub').classList.add('active');
                document.getElementById('btn-pay').innerText = `Оплатить ${prices[selectedTier]}₽`;
            } else {
                document.getElementById('btn-crypto').classList.add('active');
                document.getElementById('btn-pay').innerText = `Оплатить $${pricesUSD[selectedTier]}`;
            }
        }

        async function processPayment() {
            const btn = document.getElementById('btn-pay');
            btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border:2px solid;border-radius:50%;border-top-color:transparent;animation:spin 1s linear infinite;display:inline-block;"></span>`;
            btn.disabled = true;

            try {
                const res = await fetch(`${API_URL}/create_payment`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: savedUser,
                        token: savedToken,
                        tier: selectedTier,
                        currency: selectedCurrency
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.url) {
                        window.location.href = data.url;
                    } else {
                        throw new Error();
                    }
                } else {
                    throw new Error();
                }
            } catch (e) {
                showNotification("Ошибка оплаты", "Мы не смогли создать платежную сессию.", true);
                btn.innerHTML = "Перейти к оплате";
                btn.disabled = false;
            }
        }

        async function activateTrial() {
            if (!confirm("Активировать тестовый период Premium на 10 часов? Эту возможность можно использовать только 1 раз!")) return;
            try {
                const res = await fetch(`${API_URL}/activate_trial`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken })
                });
                const data = await res.json();
                if (res.ok) {
                    showNotification("Успешно", "Premium активирован на 10 часов!");
                    document.getElementById('btn-trial').style.display = 'none';
                    initProfile();
                } else {
                    showNotification("Ошибка", data.error || "Невозможно активировать тест.", true);
                }
            } catch (e) {
                showNotification("Ошибка сети", "Нет связи с сервером.", true);
            }
        }

        let isPolling = false;
        async function pollNotifications() {
            if (isPolling) return;
            isPolling = true;
            try {
                const res = await fetch(`${API_URL}/get_notifications`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken })
                });
                if (!res.ok) { isPolling = false; return; }
                const data = await res.json();

                const newHash = JSON.stringify(data);
                if (newHash === rawNotifHash) { isPolling = false; return; }
                rawNotifHash = newHash;

                if (data.has_unread && !document.getElementById('notif-dropdown').classList.contains('show')) {
                    const b = document.getElementById('bell-badge');
                    b.innerText = data.unread_count > 9 ? '9+' : data.unread_count;
                    b.style.display = 'block';
                }

                const list = document.getElementById('notif-list');
                list.innerHTML = '';
                if (!data.notifications || data.notifications.length === 0) {
                    list.innerHTML = '<div class="notif-empty">У вас нет уведомлений</div>';
                } else {
                    data.notifications.forEach(n => {
                        const d = new Date(n.date).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                        list.innerHTML += `
                            <div class="notif-item ${n.type}">
                                <div class="notif-text">${n.text}</div>
                                <div class="notif-date">${d}</div>
                            </div>
                        `;
                    });
                }
            } catch (e) { }
            isPolling = false;
        }

        async function pollProfileTickets() {
            try {
                const resTickets = await fetch(`${API_URL}/get_my_tickets`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken })
                });
                if (!resTickets.ok) return;
                const dataTickets = await resTickets.json();
                const newHash = JSON.stringify(dataTickets.tickets || {});
                if (newHash === rawTicketsHash) return;
                rawTicketsHash = newHash;

                const cont = document.getElementById('tickets-container');
                cont.innerHTML = '';

                if (Object.keys(dataTickets.tickets || {}).length === 0) {
                    cont.innerHTML = '<div class="notif-empty" style="border: 1px dashed var(--border); padding: 40px; border-radius: 8px;">У вас нет активных обращений.</div>';
                    return;
                }

                const sortedTickets = Object.entries(dataTickets.tickets).sort((a, b) => {
                    return new Date(b[1].date).getTime() - new Date(a[1].date).getTime();
                });

                for (const [tId, tData] of sortedTickets) {
                    const isAnswered = tData.status === 'answered';
                    const safeMessage = formatText(tData.message);

                    let rawReply = tData.reply || "";
                    let isRejected = rawReply.includes("Отклонено");
                    if (isRejected) { rawReply = rawReply.replace(/^Отклонено администратором @[^\n\r]+[\n\r]*/i, ''); }
                    else { rawReply = rawReply.replace(/^Ответил администратор @[^\n\r]+:[\n\r]*/i, ''); }

                    const safeReply = formatText(rawReply);

                    let replyBlock = '';
                    if (isAnswered) {
                        replyBlock = `
                            <div class="ticket-a-block">
                                <div class="ticket-a-label">${isRejected ? 'Статус: Отклонено' : 'Ответ поддержки'}</div>
                                <div class="ticket-a" ${isRejected ? 'style="color: var(--gray-400);"' : ''}>${safeReply}</div>
                            </div>
                        `;
                    }

                    const html = `
                        <div class="ticket-item" id="ticket-${tId}">
                            <div class="ticket-header">
                                <div class="ticket-status ${isAnswered ? (isRejected ? 'rejected' : 'answered') : ''}">
                                    ${isAnswered ? (isRejected ? 'Отклонено' : 'Отвечен поддержкой') : 'Ожидает ответа'}
                                </div>
                                ${isAnswered ? `<button class="btn-outline" style="padding: 6px 12px; font-size: 9px;" onclick="markRead('${tId}')">ОЗНАКОМЛЕН (УДАЛИТЬ)</button>` : ''}
                            </div>
                            <div class="ticket-body">
                                <div class="ticket-q-label">Ваш вопрос</div>
                                <div class="ticket-q">${safeMessage}</div>
                                ${replyBlock}
                            </div>
                        </div>
                    `;
                    cont.innerHTML += html;
                }
            } catch (e) {
                document.getElementById('tickets-container').innerHTML = '<div class="notif-empty" style="border: 1px solid var(--border); padding: 40px;">Ошибка связи с сервером.</div>';
            }
        }

        async function markRead(ticketId) {
            try {
                const res = await fetch(`${API_URL}/delete_ticket`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken, ticket_id: ticketId })
                });
                if (res.ok) {
                    showNotification("Успешно", "Тикет удален");
                    pollProfileTickets();
                }
            } catch (e) { }
        }

        window.onload = initProfile;
