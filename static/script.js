function showFlashMessage(message, category) {
    const flashDiv = document.getElementById("flash-messages");
    if (flashDiv) {
        const msg = document.createElement("div");
        msg.className = `flash-${category}`;
        msg.textContent = message;
        flashDiv.appendChild(msg);
        setTimeout(() => msg.remove(), 3000);
    }
}

document.getElementById("signup-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        email: formData.get("email"),
        username: formData.get("username"),
        password: formData.get("password"),
    };

    if (formData.get("password") !== formData.get("confirm_password")) {
        showFlashMessage("Пароли не совпадают", "danger");
        return;
    }

    try {
        const response = await fetch("/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await response.json();
        if (response.ok) {
            showFlashMessage(result.message, "success");
            setTimeout(() => (window.location.href = "/signin"), 1000);
        } else {
            showFlashMessage(result.detail, "danger");
        }
    } catch (error) {
        showFlashMessage("Ошибка сервера", "danger");
    }
});

document.getElementById("signin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        username: formData.get("username"),
        password: formData.get("password"),
    };

    console.log("Отправляемые данные:", data);

    try {
        const response = await fetch("/signin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await response.json();
        if (response.ok) {
            localStorage.setItem("token", result.token);
            window.location.href = "/chat";
        } else {
            console.log("Ошибка входа:", result);
            if (response.status === 422) {
                showFlashMessage("Ошибка: неверный формат данных. Проверьте введенные данные.", "danger");
            } else {
                showFlashMessage(result.detail || "Ошибка входа", "danger");
            }
        }
    } catch (error) {
        console.error("Ошибка сервера:", error);
        showFlashMessage("Ошибка сервера", "danger");
    }
});

document.getElementById("forgot-password-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        email: formData.get("email"),
    };

    try {
        const response = await fetch("/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await response.json();
        if (response.ok) {
            showFlashMessage(result.message, "success");
        } else {
            showFlashMessage(result.detail, "danger");
        }
    } catch (error) {
        showFlashMessage("Ошибка сервера", "danger");
    }
});

document.getElementById("reset-password-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        new_password: formData.get("new_password"),
        confirm_password: formData.get("confirm_password"),
    };

    if (data.new_password !== data.confirm_password) {
        showFlashMessage("Пароли не совпадают", "danger");
        return;
    }

    try {
        const token = window.location.pathname.split("/").pop();
        const response = await fetch(`/reset-password/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await response.json();
        if (response.ok) {
            showFlashMessage(result.message, "success");
            setTimeout(() => (window.location.href = "/signin"), 2000);
        } else {
            showFlashMessage(result.detail, "danger");
        }
    } catch (error) {
        showFlashMessage("Ошибка сервера", "danger");
    }
});

if (document.getElementById("chat-form")) {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "/signin";
    }

    let username = "";
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        username = payload.sub;
    } catch (e) {
        window.location.href = "/signin";
    }

    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    const chatMessages = document.getElementById("chat-messages");
    const chatForm = document.getElementById("chat-form");
    const messageInput = document.getElementById("message-input");
    const searchInput = document.getElementById("search-user-input");
    const searchResults = document.getElementById("search-results");
    const chatList = document.getElementById("chat-list");
    const chatTitle = document.getElementById("chat-title");

    let currentChat = { type: "private", id: null };
    let isSwitchingChat = false;
    let lastUnreadDivider = null; // Отслеживаем последний разделитель

    if (Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    const notificationSound = new Audio("/static/notification.mp3");

    async function loadPrivateChats(autoSwitch = true) {
        try {
            const response = await fetch("/private-chats", {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });
            const result = await response.json();
            if (response.ok) {
                chatList.innerHTML = "";
                result.chats.forEach(chat => {
                    const otherUser = chat.user1 === username ? chat.user2 : chat.user1;
                    addChatToList("private", chat.id, otherUser, chat.unread_count);
                });
                if (autoSwitch && result.chats.length > 0) {
                    const firstChat = result.chats[0];
                    const otherUser = firstChat.user1 === username ? firstChat.user2 : firstChat.user1;
                    switchChat("private", firstChat.id, otherUser);
                }
            } else {
                console.error("Ошибка загрузки чатов:", result.detail);
            }
        } catch (error) {
            console.error("Ошибка сервера:", error);
        }
    }

    function addChatToList(type, id, name, unreadCount = 0) {
        const existingChat = chatList.querySelector(`[data-chat-id="${id}"][data-chat-type="${type}"]`);
        if (existingChat) return;

        const div = document.createElement("div");
        div.className = "group-item";
        div.setAttribute("data-chat-type", type);
        div.setAttribute("data-chat-id", id);
        div.innerHTML = `
            <span class="group-name">${name}</span>
            <span class="unread-count">${unreadCount}</span>
        `;
        div.addEventListener("click", () => switchChat(type, id, name));
        chatList.appendChild(div);
        updateUnreadCount(id, unreadCount);
    }

    function updateUnreadCount(chatId, count) {
        const chatItem = chatList.querySelector(`[data-chat-id="${chatId}"]`);
        if (chatItem) {
            const unreadSpan = chatItem.querySelector(".unread-count");
            unreadSpan.textContent = count;
            unreadSpan.style.display = count > 0 ? "inline-block" : "none";
            console.log(`Обновлен счетчик для чата ${chatId}: ${count}`);
        }
    }

    async function switchChat(type, id, name) {
        if (isSwitchingChat) return;
        isSwitchingChat = true;

        currentChat = { type, id };
        chatTitle.textContent = name;

        document.querySelectorAll(".group-item").forEach(item => item.classList.remove("active"));
        const activeChatItem = chatList.querySelector(`[data-chat-type="${type}"][data-chat-id="${id}"]`);
        activeChatItem.classList.add("active");

        chatMessages.innerHTML = "";
        lastUnreadDivider = null; // Сбрасываем разделитель

        await loadPrivateMessages(id);
        updateUnreadCount(id, 0);
        isSwitchingChat = false;
    }

    async function loadPrivateMessages(chatId) {
        try {
            const response = await fetch(`/private-messages/${chatId}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });
            const messages = await response.json();
            let hasUnread = false;
            messages.forEach((msg, index) => {
                console.log(`Сообщение: sender=${msg.sender}, is_read=${msg.is_read}, current_user=${username}`);
                if (!hasUnread && msg.sender !== username && msg.is_read === 0) {
                    addUnreadDivider();
                    hasUnread = true;
                }
                displayPrivateMessage(msg);
            });
            console.log(`Загружено ${messages.length} сообщений для чата ${chatId}`);
        } catch (error) {
            console.error("Ошибка загрузки личных сообщений:", error);
        }
    }

    function addUnreadDivider() {
        if (lastUnreadDivider) return; // Добавляем только один разделитель
        const divider = document.createElement("div");
        divider.className = "unread-divider";
        divider.textContent = "Непрочитанные сообщения";
        chatMessages.appendChild(divider);
        lastUnreadDivider = divider;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function displayPrivateMessage(msg) {
        const div = document.createElement("div");
        div.className = "chat-message";
        if (msg.sender === username) {
            div.classList.add("own-message");
        }
        div.innerHTML = `
            <div class="username">${msg.sender}</div>
            <div class="content">${msg.content}</div>
            <div class="timestamp">${msg.timestamp}</div>
        `;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function searchUsers(query) {
        const token = localStorage.getItem("token");
        if (!token) {
            showFlashMessage("Токен отсутствует. Пожалуйста, войдите снова.", "danger");
            setTimeout(() => (window.location.href = "/signin"), 2000);
            return;
        }

        try {
            const response = await fetch(`/search-users?query=${encodeURIComponent(query)}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });
            const result = await response.json();
            if (response.ok) {
                displaySearchResults(result.users || []);
            } else {
                if (response.status === 401) {
                    showFlashMessage("Сессия истекла. Пожалуйста, войдите снова.", "danger");
                    localStorage.removeItem("token");
                    setTimeout(() => (window.location.href = "/signin"), 2000);
                } else {
                    console.error("Ошибка поиска:", result.detail);
                    searchResults.innerHTML = "<div class='search-result-item'>Ошибка поиска</div>";
                    searchResults.classList.add("active");
                }
            }
        } catch (error) {
            console.error("Ошибка сервера при поиске:", error);
            searchResults.innerHTML = "<div class='search-result-item'>Ошибка сервера</div>";
            searchResults.classList.add("active");
        }
    }

    async function displaySearchResults(users) {
        searchResults.innerHTML = "";
        if (users.length === 0) {
            searchResults.innerHTML = "<div class='search-result-item'>Пользователи не найдены</div>";
            searchResults.classList.add("active");
            return;
        }
        users.forEach((user) => {
            const div = document.createElement("div");
            div.className = "search-result-item";
            const firstLetter = user.username.charAt(0).toUpperCase();
            div.innerHTML = `
                <div class="avatar">${firstLetter}</div>
                <div class="username">${user.username}</div>
            `;
            div.addEventListener("click", async () => {
                const otherUser = user.username;
                try {
                    const response = await fetch(`/get-or-create-chat/${encodeURIComponent(otherUser)}`, {
                        method: "GET",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`,
                        },
                    });
                    const result = await response.json();
                    if (response.ok) {
                        const chatId = result.chat_id;
                        addChatToList("private", chatId, otherUser);
                        switchChat("private", chatId, otherUser);
                        await loadPrivateChats(false);
                    } else {
                        showFlashMessage("Ошибка создания чата: " + result.detail, "danger");
                    }
                } catch (error) {
                    showFlashMessage("Ошибка сервера", "danger");
                }
                searchResults.classList.remove("active");
                searchInput.value = "";
            });
            searchResults.appendChild(div);
        });
        searchResults.classList.add("active");
    }

    searchInput?.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        if (query.length > 0) {
            searchUsers(query);
        } else {
            searchResults.classList.remove("active");
        }
    });

    document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.remove("active");
        }
    });

    ws.onopen = () => {
        console.log("WebSocket подключен");
        loadPrivateChats();
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if ("chat_id" in msg) {
            console.log(`Сообщение: sender=${msg.sender}, is_read=${msg.is_read}, current_user=${username}`);
            if (currentChat.type === "private" && currentChat.id === msg.chat_id) {
                if (msg.sender !== username && msg.is_read === 0 && !lastUnreadDivider) {
                    addUnreadDivider();
                }
                displayPrivateMessage(msg);
            }
            if (msg.sender !== username && currentChat.id !== msg.chat_id) {
                const chatItem = chatList.querySelector(`[data-chat-id="${msg.chat_id}"]`);
                if (chatItem) {
                    const unreadSpan = chatItem.querySelector(".unread-count");
                    let count = parseInt(unreadSpan.textContent) || 0;
                    count += 1;
                    updateUnreadCount(msg.chat_id, count);
                }
                if (document.hidden && Notification.permission === "granted") {
                    new Notification(`${msg.sender}`, {
                        body: msg.content,
                        icon: "/static/favicon.ico"
                    });
                    notificationSound.play().catch(err => console.error("Ошибка воспроизведения звука:", err));
                }
            }
        }
    };

    ws.onclose = () => {
        console.log("WebSocket отключен");
    };

    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const content = messageInput.value.trim();
        if (content && currentChat.id !== null) {
            const message = { chat_id: currentChat.id, username, content };
            ws.send(JSON.stringify(message));
            messageInput.value = "";
    
            // Вызываем эндпоинт для обновления is_read
            try {
                await fetch(`/mark-messages-read/${currentChat.id}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`,
                    },
                });
                // Обновляем отображение (удаляем разделитель, так как все сообщения теперь прочитаны)
                lastUnreadDivider?.remove();
                lastUnreadDivider = null;
            } catch (error) {
                console.error("Ошибка при обновлении статуса прочитанных сообщений:", error);
            }
        } else {
            showFlashMessage("Выберите чат для отправки сообщения", "danger");
        }
    });

    document.getElementById("logout-btn").addEventListener("click", async () => {
        try {
            await fetch("/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            localStorage.removeItem("token");
            window.location.href = "/signin";
        } catch (error) {
            console.error("Ошибка при выходе:", error);
        }
    });

    document.getElementById("clear-history-btn").addEventListener("click", async () => {
        if (currentChat.id === null) {
            showFlashMessage("Выберите чат для очистки истории", "danger");
            return;
        }
        try {
            const response = await fetch(`/clear-private-history/${currentChat.id}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });
            const result = await response.json();
            if (response.ok) {
                chatMessages.innerHTML = "";
                lastUnreadDivider = null; // Сбрасываем разделитель
                updateUnreadCount(currentChat.id, 0);
                showFlashMessage(result.message, "success");
            } else {
                showFlashMessage(result.detail, "danger");
            }
        } catch (error) {
            console.error("Ошибка при очистке истории:", error);
            showFlashMessage("Ошибка сервера", "danger");
        }
    });
}