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
                            }
                        } catch (e) { console.error("Handshake failed:", e); }
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

        origFetch(`${API_URL}/handshake`).then(r => r.json()).then(d => {
            if (d.session_id) {
                sessionStorage.setItem('mx_session_id', d.session_id);
                sessionStorage.setItem('mx_session_secret', d.session_secret);
            }
        }).catch(() => { });
        const savedUser = localStorage.getItem('mx_username');
        const savedToken = localStorage.getItem('mx_token');

        let globalTickets = [];
        let rawDataHash = "";

        function openMobileNav() { document.getElementById('mobileNav').classList.add('open'); document.body.style.overflow = 'hidden'; }
        function closeMobileNav() { document.getElementById('mobileNav').classList.remove('open'); document.body.style.overflow = ''; }

        function showToast(text) {
            const toast = document.getElementById('notificationToast');
            document.getElementById('toastTitle').innerText = "Выполнено";
            document.getElementById('toastDesc').innerText = text;
            toast.className = 'toast';
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        function formatText(str) {
            if (!str) return '';
            let safeStr = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            safeStr = safeStr.replace(urlRegex, function (url) {
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`;
            });
            return safeStr.replace(/\n/g, '<br>');
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

        async function initAdmin() {
            if (!savedUser || !savedToken) { window.location.href = "index.html"; return; }

            initScrollReveal();

            await pollAdminTickets(true);
            await pollAdminRP();
            await fetchVersion();

            setInterval(() => pollAdminTickets(false), 10000);
            setInterval(() => pollAdminRP(), 10000);
        }

        async function pollAdminTickets(isFirstLoad = false) {
            try {
                const res = await fetch(`${API_URL}/admin_tickets`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken })
                });

                if (res.status === 403 || !res.ok) {
                    if (isFirstLoad) { alert("У вас нет прав администратора!"); window.location.href = "profile.html"; }
                    return;
                }

                const data = await res.json();
                const newHash = JSON.stringify(data.tickets || {});

                if (newHash !== rawDataHash) {
                    rawDataHash = newHash;
                    globalTickets = [];
                    for (const [id, tData] of Object.entries(data.tickets || {})) { globalTickets.push({ id, ...tData }); }
                    renderTickets();
                }
            } catch (e) {
                if (isFirstLoad) document.getElementById('admin-tickets').innerHTML = '<div class="empty-state" style="color: var(--error-color);">Ошибка соединения с сервером.</div>';
            }
        }

        function renderTickets() {
            let activeForms = {};
            document.querySelectorAll('.action-section.active').forEach(sec => {
                let textarea = sec.querySelector('textarea');
                if (textarea) activeForms[sec.id] = textarea.value;
            });

            const cont = document.getElementById('admin-tickets');
            cont.innerHTML = '';
            const statusFilter = document.getElementById('status-filter').value;
            const sortMethod = document.getElementById('sort-select').value;
            let filteredTickets = globalTickets.filter(t => t.status === statusFilter);

            if (filteredTickets.length === 0) {
                const emptyMsg = statusFilter === 'open' ? "Все тикеты разобраны. Очередь пуста." : "Список отвеченных тикетов пуст.";
                cont.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
                return;
            }

            filteredTickets.sort((a, b) => {
                const premiumA = a.is_premium ? 1 : 0;
                const premiumB = b.is_premium ? 1 : 0;
                if (premiumA !== premiumB) return premiumB - premiumA;
                const dateA = new Date(a.date).getTime();
                const dateB = new Date(b.date).getTime();
                return sortMethod === 'new' ? dateB - dateA : dateA - dateB;
            });

            filteredTickets.forEach(tData => {
                const dateStr = new Date(tData.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                const safeMessage = formatText(tData.message);
                let html = '';
                const premiumClass = tData.is_premium ? ' premium' : '';
                const premiumBadge = tData.is_premium ? '<span class="premium-badge">PREMIUM</span>' : '';

                if (statusFilter === 'open') {
                    html = `
                        <div class="ticket-item${premiumClass}" id="ticket-wrapper-${tData.id}">
                            <div class="ticket-header">
                                <div class="ticket-status open">Ожидает ответа</div>
                                <div class="ticket-user-info">${premiumBadge} <span>Пользователь: ${tData.user}</span> <span>|</span> <span>${dateStr}</span></div>
                            </div>
                            <div class="ticket-body">
                                <div class="ticket-q-label">Суть обращения</div>
                                <div class="ticket-q">${safeMessage}</div>
                                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                                    <button class="btn-outline-admin" onclick="toggleForm('${tData.id}', 'reply')">Ответить</button>
                                    <button class="btn-outline-admin" style="color: var(--error-color); border-color: var(--border);" onclick="toggleForm('${tData.id}', 'reject')">Отклонить</button>
                                    <button class="btn-outline-admin" style="border-color: transparent;" onclick="deleteTicket('${tData.id}')">Удалить</button>
                                </div>
                                <div class="action-section" id="form-reply-${tData.id}">
                                    <textarea id="input-reply-${tData.id}" class="reply-input" placeholder="Введите ответ для игрока..."></textarea>
                                    <button class="btn-auth-admin" style="width: 100%;" onclick="submitReply('${tData.id}')">Отправить ответ</button>
                                </div>
                                <div class="action-section" id="form-reject-${tData.id}">
                                    <textarea id="input-reject-${tData.id}" class="reply-input" style="border-color: var(--error-color);" placeholder="Укажите причину отклонения..."></textarea>
                                    <button class="btn-auth-admin" style="width: 100%; background: var(--error-color); border-color: var(--error-color); color: var(--white);" onclick="submitReject('${tData.id}')">Отклонить тикет</button>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    let rawReply = tData.reply || "";
                    let isRejected = rawReply.includes("Отклонено");
                    if (isRejected) { rawReply = rawReply.replace(/^Отклонено администратором @[^\n\r]+[\n\r]*/i, ''); }
                    else { rawReply = rawReply.replace(/^Ответил администратор @[^\n\r]+:[\n\r]*/i, ''); }
                    const safeReply = formatText(rawReply);

                    html = `
                        <div class="ticket-item${premiumClass}" id="ticket-wrapper-${tData.id}">
                            <div class="ticket-header">
                                <div class="ticket-status ${isRejected ? 'rejected' : 'answered'}">${isRejected ? 'Отклонено' : 'Отвечено'}</div>
                                <div class="ticket-user-info">${premiumBadge} <span>Пользователь: ${tData.user}</span> <span>|</span> <span>${dateStr}</span></div>
                            </div>
                            <div class="ticket-body">
                                <div class="ticket-q-label">Суть обращения</div>
                                <div class="ticket-q">${safeMessage}</div>
                                <div class="ticket-a-block ${isRejected ? 'rejected' : ''}">
                                    <div class="ticket-a-label">${isRejected ? 'Причина отказа' : 'Ответ администрации'}</div>
                                    <div class="ticket-a" style="${isRejected ? 'color: var(--gray-400);' : ''}">${safeReply}</div>
                                </div>
                                <button class="btn-outline-admin" style="border-color: transparent;" onclick="deleteTicket('${tData.id}')">Удалить навсегда</button>
                            </div>
                        </div>
                    `;
                }
                cont.innerHTML += html;
            });

            for (let secId in activeForms) {
                let sec = document.getElementById(secId);
                if (sec) {
                    sec.classList.add('active');
                    let ta = sec.querySelector('textarea');
                    if (ta) ta.value = activeForms[secId];
                }
            }
        }

        function toggleForm(ticketId, type) {
            document.querySelectorAll('.action-section').forEach(el => el.classList.remove('active'));
            const targetSection = document.getElementById(`form-${type}-${ticketId}`);
            if (targetSection) { targetSection.classList.add('active'); document.getElementById(`input-${type}-${ticketId}`).focus(); }
        }

        async function submitReply(ticketId) {
            const replyText = document.getElementById(`input-reply-${ticketId}`).value.trim();
            if (replyText.length < 2) { alert("Ответ слишком короткий!"); return; }
            const finalReply = `Ответил администратор @${savedUser}:\n${replyText}`;
            await executeReplyAction(ticketId, finalReply, "Ответ отправлен");
        }

        async function submitReject(ticketId) {
            const reasonText = document.getElementById(`input-reject-${ticketId}`).value.trim();
            if (reasonText.length < 2) { alert("Укажите причину отклонения!"); return; }
            const rejectMsg = `Отклонено администратором @${savedUser}\nПричина: ${reasonText}`;
            await executeReplyAction(ticketId, rejectMsg, "Тикет отклонен");
        }

        async function executeReplyAction(ticketId, replyText, successMsg) {
            try {
                const res = await fetch(`${API_URL}/reply_ticket`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken, ticket_id: ticketId, reply: replyText })
                });
                if (res.ok) { showToast(successMsg); pollAdminTickets(false); }
                else { alert("Ошибка при обработке запроса."); }
            } catch (e) { alert("Ошибка сети."); }
        }

        async function deleteTicket(ticketId) {
            if (!confirm("ВЫ УВЕРЕНЫ? Тикет будет полностью удален с сервера и исчезнет у пользователя навсегда.")) return;
            try {
                const res = await fetch(`${API_URL}/delete_ticket`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken, ticket_id: ticketId })
                });
                if (res.ok) { showToast("Удалено с сервера"); pollAdminTickets(false); }
                else { alert("Ошибка при удалении тикета."); }
            } catch (e) { alert("Ошибка сети."); }
        }

        async function pollAdminRP() {
            try {
                const res = await fetch(`${API_URL}/admin_rp`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken })
                });
                if (res.ok) {
                    const data = await res.json();
                    renderRP(data.rp_data.pending || {});
                } else if (res.status === 403) {
                    document.getElementById('admin-rp').innerHTML = '<div class="empty-state">У вас нет прав для модерации ресурспаков.</div>';
                }
            } catch (e) { }
        }

        function renderRP(pendingPacks) {
            const cont = document.getElementById('admin-rp');
            cont.innerHTML = '';
            const entries = Object.entries(pendingPacks);

            if (entries.length === 0) { cont.innerHTML = `<div class="empty-state">Очередь ресурспаков пуста.</div>`; return; }

            entries.forEach(([id, pack]) => {
                const dateStr = new Date(pack.date).toLocaleString('ru-RU');
                cont.innerHTML += `
                    <div class="ticket-item">
                        <div class="ticket-header">
                            <div class="ticket-status open">Ожидает модерации</div>
                            <div class="ticket-user-info"><span>Автор: ${pack.author}</span> <span>|</span> <span>${dateStr}</span></div>
                        </div>
                        <div class="ticket-body">
                            <div class="ticket-q-label">Информация о паке</div>
                            <div class="ticket-q">
                                <b>Название:</b> ${pack.name} <span style="color: var(--gray-400);">(v${pack.version})</span><br><br>
                                <a href="${pack.url}" target="_blank" class="chat-link" style="margin-right: 16px;">[ Скачать .zip ]</a>
                                <a href="${pack.image}" target="_blank" class="chat-link">[ Посмотреть скриншот ]</a>
                            </div>
                            <div style="display: flex; gap: 12px; margin-top: 24px;">
                                <button class="btn-outline-admin" style="color: var(--success-color); border-color: var(--border);" onclick="reviewRP('${id}', 'approve')">Одобрить</button>
                                <button class="btn-outline-admin" style="color: var(--error-color); border-color: transparent;" onclick="reviewRP('${id}', 'reject')">Отклонить</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        async function reviewRP(id, action) {
            if (action === 'reject' && !confirm('Точно отклонить этот ресурспак?')) return;
            try {
                const res = await fetch(`${API_URL}/review_rp`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: savedUser, token: savedToken, rp_id: id, action: action })
                });
                if (res.ok) { showToast(action === 'approve' ? "Пак одобрен!" : "Пак отклонен"); pollAdminRP(); }
                else { alert("Ошибка при обработке запроса."); }
            } catch (e) { alert("Ошибка сети."); }
        }

        async function manageUser(action) {
            const targetUser = document.getElementById('target-username').value.trim();
            if (!targetUser) {
                alert("Сначала введите никнейм игрока!");
                return;
            }

            let duration = null;
            if (action === 'premium') {
                duration = document.getElementById('premium-duration').value;
            }

            if (!confirm(`Вы уверены, что хотите применить это действие к игроку ${targetUser}?`)) return;

            try {
                const res = await fetch(`${API_URL}/admin_manage_user`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: savedUser,
                        token: savedToken,
                        target_user: targetUser,
                        action: action,
                        duration: duration
                    })
                });

                const data = await res.json();

                if (res.ok) {
                    showToast(data.message || "Успешно выполнено!");
                    if (action === 'ban' || action === 'unban') {
                        document.getElementById('target-username').value = '';
                    }
                } else {
                    alert(data.error || "Ошибка при выполнении действия.");
                }
            } catch (e) {
                alert("Ошибка соединения с сервером.");
            }
        }

        window.onload = initAdmin;
