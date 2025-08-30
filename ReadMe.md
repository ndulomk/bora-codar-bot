# 📌 Automação de Postagens — API Scheduler

👤 Desenvolvido por **Edgar Manuel Janota**
💻 Fullstack Developer

---

## 📖 Visão Geral

Este projeto é uma **API para agendamento e publicação automática de posts** em múltiplas plataformas sociais (Twitter, LinkedIn, Instagram — suporte inicial para Twitter).

### ✨ Funcionalidades:

* Agendamento de posts com data/hora.
* Publicação automática via cron jobs (`node-cron`).
* Persistência em banco de dados SQLite.
* Sistema de **tentativas automáticas** (retry até 3 vezes).
* Registro de **analytics** (post agendado, publicado, falha, retry).
* API REST construída com **Fastify**.
* Suporte a conteúdos pré-definidos.
* Eventos desacoplados usando `EventEmitter`.

---

## 🛠️ Tecnologias

* **Node.js + TypeScript**
* **Fastify** (API REST)
* **SQLite** (persistência)
* **node-cron** (scheduler)
* **Twitter API v2** (publicação no Twitter)
* **EventEmitter** (eventos internos de workflow)

---

## ⚙️ Instalação

```bash
# Clonar repositório
git clone https://github.com/SEU_REPO.git
cd SEU_REPO

# Instalar dependências
npm install

# Criar arquivo de variáveis de ambiente
cp .env.example .env
```

### Variáveis de ambiente (`.env`)

```env
PORT=3000

# Caminho do banco SQLite
DATABASE_PATH=./data/posts.db

# Credenciais Twitter
TWITTER_API_KEY=xxxx
TWITTER_API_SECRET=xxxx
TWITTER_ACCESS_TOKEN=xxxx
TWITTER_ACCESS_TOKEN_SECRET=xxxx
```

---

## ▶️ Executando

```bash
npm run build   # compilar TypeScript
npm start       # iniciar servidor
```

Servidor roda por padrão em **[http://localhost:3000](http://localhost:3000)**.

---

## 🌐 Endpoints da API

### 🔹 Healthcheck

```
GET /health
```

Retorna `{ status: "ok", timestamp: "..." }`.

---

### 🔹 Publicar agora

```
POST /api/posts/publish
```

Body:

```json
{
  "content": "Meu post agora!",
  "platform": "twitter"
}
```

---

### 🔹 Agendar post

```
POST /api/posts/schedule
```

Body:

```json
{
  "content": "Meu post para mais tarde",
  "scheduledFor": "2025-09-01T12:00:00Z",
  "platform": "twitter"
}
```

---

### 🔹 Listar agendados

```
GET /api/posts/scheduled
```

---

### 🔹 Buscar por ID

```
GET /api/posts/:id
```

---

### 🔹 Deletar agendado

```
DELETE /api/posts/:id
```

---

### 🔹 Conteúdos pré-definidos

```
GET /api/content/predefined
```

---

### 🔹 Publicar conteúdo pré-definido

```
POST /api/content/predefined/publish
```

Body:

```json
{
  "category": "motivacional",
  "index": 0,
  "platform": "twitter"
}
```

---

### 🔹 Analytics (geral)

```
GET /api/analytics
```

### 🔹 Analytics por post

```
GET /api/analytics/:id
```

---

## 📊 Estrutura de Dados

### Post (tabela `posts`)

* `id` — identificador único
* `content` — conteúdo do post
* `scheduled_for` — data agendada
* `status` — `pending | posted | failed`
* `created_at` — data de criação
* `platform` — `twitter | linkedin | instagram`
* `tags` — lista de categorias
* `retry_count` — número de tentativas
* `published_at` — data de publicação
* `error_message` — erro em caso de falha

### Analytics (tabela `post_analytics`)

* `post_id` — id do post
* `event_type` — `scheduled | published | failed | retry`
* `event_data` — JSON com dados extras
* `created_at` — data do evento

---

## 🔔 Eventos Internos (`EventEmitter`)

* `post:scheduled` — quando um post é agendado.
* `post:published` — quando um post é publicado com sucesso.
* `post:failed` — quando falha após 3 tentativas.
* `post:retrying` — quando uma tentativa falha mas será repetida.

👉 Você pode **adicionar listeners externos** para integrar com outros serviços (ex: enviar e-mail, webhook, Slack).

---

## 🚀 Roadmap

* [ ] Suporte a LinkedIn e Instagram.
* [ ] Interface Web (dashboard).
* [ ] Webhooks externos.
* [ ] Múltiplos usuários / autenticação.
* [ ] Métricas avançadas de engajamento.

---

⚡ **Edgar Manuel Janota** — Desenvolvedor Fullstack
