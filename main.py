import sqlite3
import jwt
import uvicorn
import json
import bcrypt
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from typing import List

app = FastAPI()

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

# Настройки для JWT
SECRET_KEY = "your_secret_key"
ALGORITHM = "HS256"

# Настройки для SMTP (для отправки писем)
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "your_email@gmail.com"
SMTP_PASSWORD = "your_password"

# Подключение к базе данных SQLite
def get_db():
    conn = sqlite3.connect("chat.db")
    conn.row_factory = sqlite3.Row
    return conn

# Создание таблиц
def init_db():
    with get_db() as conn:
        # Таблица пользователей
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            )
        """)
        # Таблица личных чатов
        conn.execute("""
            CREATE TABLE IF NOT EXISTS private_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user1 TEXT NOT NULL,
                user2 TEXT NOT NULL,
                UNIQUE(user1, user2)
            )
        """)
        # Таблица сообщений личных чатов
        conn.execute("""
            CREATE TABLE IF NOT EXISTS private_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                sender TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES private_chats(id)
            )
        """)
        conn.commit()

init_db()

# Модель для регистрации
class UserCreate(BaseModel):
    email: str
    username: str
    password: str

# Модель для входа
class UserLogin(BaseModel):
    email: str
    password: str

# Модель для сброса пароля
class ResetPassword(BaseModel):
    new_password: str
    confirm_password: str

# Модель для личного сообщения
class PrivateMessage(BaseModel):
    chat_id: int
    sender: str
    content: str
    timestamp: str

# Настройка OAuth2 для извлечения токена
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/signin", auto_error=False)

# Проверка токена авторизации
def verify_token(token: str = Depends(oauth2_scheme)) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Токен отсутствует")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Неверный токен")

# Функция для отправки email
def send_reset_email(email: str, token: str):
    msg = MIMEMultipart()
    msg["From"] = SMTP_USER
    msg["To"] = email
    msg["Subject"] = "Сброс пароля"
    reset_link = f"http://127.0.0.1:8000/reset-password/{token}"
    body = f"Для сброса пароля перейдите по ссылке: {reset_link}"
    msg.attach(MIMEText(body, "plain"))
    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, email, msg.as_string())

# WebSocket соединения
connected_clients = {}

# Маршруты
@app.get("/", response_class=HTMLResponse)
async def redirect_to_signin():
    return RedirectResponse(url="/signin")

@app.get("/signup", response_class=HTMLResponse)
async def get_signup():
    with open("templates/signup.html", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), media_type="text/html; charset=utf-8")

@app.post("/signup")
async def signup(user: UserCreate):
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE email = ? OR username = ?", (user.email, user.username))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email или username уже заняты")
        
        hashed_password = bcrypt.hashpw(user.password.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            "INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
            (user.email, user.username, hashed_password)
        )
        conn.commit()
    return {"message": "Регистрация успешна"}

@app.get("/signin", response_class=HTMLResponse)
async def get_signin():
    with open("templates/signin.html", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), media_type="text/html; charset=utf-8")

@app.post("/signin")
async def signin(user: UserLogin):
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE email = ?", (user.email,))
        db_user = cursor.fetchone()
        if not db_user or not bcrypt.checkpw(user.password.encode(), db_user["password"].encode()):
            raise HTTPException(status_code=401, detail="Неверный email или пароль")
        
        token = jwt.encode({
            "sub": db_user["username"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=24)
        }, SECRET_KEY, algorithm=ALGORITHM)
        return {"token": token}

@app.get("/chat", response_class=HTMLResponse)
async def get_chat():
    with open("templates/chat.html", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), media_type="text/html; charset=utf-8")

@app.get("/private-messages/{chat_id}")
async def get_private_messages(chat_id: int, token: dict = Depends(verify_token)):
    username = token["sub"]
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM private_chats WHERE id = ? AND (user1 = ? OR user2 = ?)", (chat_id, username, username))
        chat = cursor.fetchone()
        if not chat:
            raise HTTPException(status_code=403, detail="Нет доступа к этому чату")
        
        cursor = conn.execute("SELECT * FROM private_messages WHERE chat_id = ? ORDER BY timestamp", (chat_id,))
        messages = [dict(row) for row in cursor.fetchall()]
    return messages

@app.post("/clear-private-history/{chat_id}")
async def clear_private_history(chat_id: int, token: dict = Depends(verify_token)):
    username = token["sub"]
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM private_chats WHERE id = ? AND (user1 = ? OR user2 = ?)", (chat_id, username, username))
        chat = cursor.fetchone()
        if not chat:
            raise HTTPException(status_code=403, detail="Нет доступа к этому чату")
        
        conn.execute("DELETE FROM private_messages WHERE chat_id = ?", (chat_id,))
        conn.commit()
    return {"message": "История чата очищена"}

@app.post("/logout")
async def logout():
    return {"message": "Выход выполнен"}

@app.get("/forgot-password", response_class=HTMLResponse)
async def get_forgot_password():
    with open("templates/forgot_password.html", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), media_type="text/html; charset=utf-8")

@app.post("/forgot-password")
async def forgot_password(email: str):
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        
        token = secrets.token_urlsafe(32)
        conn.execute("UPDATE users SET reset_token = ? WHERE email = ?", (token, email))
        conn.commit()
        send_reset_email(email, token)
    return {"message": "Ссылка для сброса пароля отправлена на ваш email"}

@app.get("/reset-password/{token}", response_class=HTMLResponse)
async def get_reset_password(token: str):
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE reset_token = ?", (token,))
        if not cursor.fetchone():
            raise HTTPException(status_code=400, detail="Неверный или истекший токен")
    with open("templates/reset_password.html", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), media_type="text/html; charset=utf-8")

@app.post("/reset-password/{token}")
async def reset_password(token: str, data: ResetPassword):
    if data.new_password != data.confirm_password:
        raise HTTPException(status_code=400, detail="Пароли не совпадают")
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE reset_token = ?", (token,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=400, detail="Неверный или истекший токен")
        
        hashed_password = bcrypt.hashpw(data.new_password.encode(), bcrypt.gensalt()).decode()
        conn.execute("UPDATE users SET password = ?, reset_token = NULL WHERE reset_token = ?", (hashed_password, token))
        conn.commit()
    return {"message": "Пароль успешно изменен"}

@app.get("/search-users")
async def search_users(query: str, token: dict = Depends(verify_token)):
    username = token["sub"]
    with get_db() as conn:
        cursor = conn.execute("SELECT username FROM users WHERE LOWER(username) LIKE ? AND username != ?", (f"%{query.lower()}%", username))
        users = [{"username": row["username"]} for row in cursor.fetchall()]
    return {"users": users}

@app.get("/private-chats")
async def get_private_chats(token: dict = Depends(verify_token)):
    username = token["sub"]
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT * FROM private_chats WHERE user1 = ? OR user2 = ?",
            (username, username)
        )
        chats = [dict(row) for row in cursor.fetchall()]
    return {"chats": chats}

@app.get("/get-or-create-chat/{other_user}")
async def get_or_create_chat(other_user: str, token: dict = Depends(verify_token)):
    username = token["sub"]
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM private_chats WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)", 
                              (username, other_user, other_user, username))
        chat = cursor.fetchone()
        if not chat:
            conn.execute("INSERT INTO private_chats (user1, user2) VALUES (?, ?)", (username, other_user))
            conn.commit()
            cursor = conn.execute("SELECT * FROM private_chats WHERE user1 = ? AND user2 = ?", (username, other_user))
            chat = cursor.fetchone()
        return {"chat_id": chat["id"]}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = id(websocket)
    connected_clients[client_id] = {"websocket": websocket, "chat_id": None}
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if "chat_id" in message:
                chat_id = message["chat_id"]
                connected_clients[client_id]["chat_id"] = chat_id
                sender = message["username"]
                content = message["content"]
                timestamp = datetime.now(timezone.utc).isoformat()
                
                with get_db() as conn:
                    conn.execute(
                        "INSERT INTO private_messages (chat_id, sender, content, timestamp) VALUES (?, ?, ?, ?)",
                        (chat_id, sender, content, timestamp)
                    )
                    conn.commit()
                
                for client_id, client_info in connected_clients.items():
                    if client_info["chat_id"] == chat_id:
                        await client_info["websocket"].send_text(json.dumps({
                            "chat_id": chat_id,
                            "sender": sender,
                            "content": content,
                            "timestamp": timestamp
                        }))
    except WebSocketDisconnect:
        del connected_clients[client_id]

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)