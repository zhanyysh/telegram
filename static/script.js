// Общие функции
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

// Регистрация
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

// Вход
document.getElementById("signin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        email: formData.get("email"),
        password: formData.get("password"),
    };

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
            showFlashMessage(result.detail, "danger");
        }
    } catch (error) {
        showFlashMessage("Ошибка сервера", "danger");
    }
});

// Запрос на восстановление пароля
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

// Сброс пароля
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

// Чат
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

    let currentChat = { type: "private", id: null }; // Текущий чат: { type: "private", id: number }

    // Загрузка списка личных чатов
    async function loadPrivateChats() {
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
                result.chats.forEach(chat => {
                    const otherUser = chat.user1 === username ? chat.user2 : chat.user1;
                    addChatToList("private", chat.id, otherUser);
                });
                // Если есть чаты, переключаемся на первый
                if (result.chats.length > 0) {
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

    // Добавление чата в список
    function addChatToList(type, id, name) {
        const existingChat = chatList.querySelector(`[data-chat-id="${id}"][data-chat-type="${type}"]`);
        if (existingChat) return; // Чат уже есть в списке

        const div = document.createElement("div");
        div.className = "group-item";
        div.setAttribute("data-chat-type", type);
        div.setAttribute("data-chat-id", id);
        div.innerHTML = `
            <span class="group-name">${name}</span>
            <span class="unread-count">0</span>
        `;
        div.addEventListener("click", () => switchChat(type, id, name));
        chatList.appendChild(div);
    }

    // Переключение чата
    async function switchChat(type, id, name) {
        currentChat = { type, id };
        chatTitle.textContent = name;

        // Удаляем класс active у всех чатов
        document.querySelectorAll(".group-item").forEach(item => item.classList.remove("active"));
        // Добавляем класс active к текущему чату
        const activeChatItem = chatList.querySelector(`[data-chat-type="${type}"][data-chat-id="${id}"]`);
        activeChatItem.classList.add("active");

        // Очищаем сообщения
        chatMessages.innerHTML = "";

        // Загружаем сообщения
        await loadPrivateMessages(id);
    }

    // Загрузка личных сообщений
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
            messages.forEach((msg) => displayPrivateMessage(msg));
        } catch (error) {
            console.error("Ошибка загрузки личных сообщений:", error);
        }
    }

    // Отображение личного сообщения
    function displayPrivateMessage(msg) {
        const div = document.createElement("div");
        div.className = "chat-message";
        // Добавляем класс "own-message", если сообщение от текущего пользователя
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

    // Поиск пользователей
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

    // Отображение результатов поиска
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

    // Обработчик ввода в поле поиска
    searchInput?.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        if (query.length > 0) {
            searchUsers(query);
        } else {
            searchResults.classList.remove("active");
        }
    });

    // Скрываем dropdown при клике вне его
    document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.remove("active");
        }
    });

    // WebSocket события
    ws.onopen = () => {
        console.log("WebSocket подключен");
        loadPrivateChats();
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if ("chat_id" in msg && currentChat.type === "private" && currentChat.id === msg.chat_id) {
            displayPrivateMessage(msg);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket отключен");
    };

    // Отправка сообщения
    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const content = messageInput.value.trim();
        if (content && currentChat.id !== null) {
            const message = { chat_id: currentChat.id, username, content };
            ws.send(JSON.stringify(message));
            messageInput.value = "";
        } else {
            showFlashMessage("Выберите чат для отправки сообщения", "danger");
        }
    });

    // Выход из аккаунта
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

    // Очистка истории
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