# OLLAMA FREE

Tu as raison, j'ai mal cherché. Ollama **est** branché et exposé via Cloudflare.

## Comment ça marche

### 1. Endpoint Ollama protégé

Dans `.env` :

```bash
OLLAMA_URL=https://ollama.stiamond.net
OLLAMA_MODEL=llama3.1:latest
OLLAMA_CF_ACCESS_CLIENT_ID=...
OLLAMA_CF_ACCESS_CLIENT_SECRET=...
# Cloudflare Access Service Token for ollama.stiamond.net
OLLAMA_CF_ACCESS_CLIENT_ID=43ac0384b196b17a0a6fab667f6dc84d.access
OLLAMA_CF_ACCESS_CLIENT_SECRET=cfast_ZYuKghmqejtnSaaLz0r3zojPPQqd4HXZZ77G9d8P4ddcf262
```

Le modèle appelle `https://ollama.stiamond.net` au lieu de `localhost:11434`. Le `.stiamond.net` est un sous-domaine passant par **Cloudflare Access** (Zero Trust), donc il faut un **Service Token** Cloudflare pour s'authentifier.

### 2. Provider [OllamaProvider](cci:2://file:///home/josue/Projections/future_stiamond/bot_int/apps/api/src/modules/chat/providers/ollama.provider.ts:5:0-112:1)

Fichier : [apps/api/src/modules/chat/providers/ollama.provider.ts](cci:7://file:///home/josue/Projections/future_stiamond/bot_int/apps/api/src/modules/chat/providers/ollama.provider.ts:0:0-0:0)

Le provider est initialisé avec `OLLAMA_URL` et `OLLAMA_MODEL`. S'il y a `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`, il les envoie dans les headers de chaque requête :

```ts
if (clientId && clientSecret) {
  this.authHeaders['CF-Access-Client-Id'] = clientId;
  this.authHeaders['CF-Access-Client-Secret'] = clientSecret;
}
```

Chaque appel Ollama (`/api/chat`, `/api/embeddings`, `/api/tags`) emporte ces headers. Sans eux, Cloudflare Access rejetterait la requête avec une 403.

### 3. Intégration au chat

Fichier : [apps/api/src/modules/chat/chat.module.ts](cci:7://file:///home/josue/Projections/future_stiamond/bot_int/apps/api/src/modules/chat/chat.module.ts:0:0-0:0)

- [OllamaProvider](cci:2://file:///home/josue/Projections/future_stiamond/bot_int/apps/api/src/modules/chat/providers/ollama.provider.ts:5:0-112:1) est enregistré comme provider.
- `LLM_PROVIDER` est fourni par [FallbackLLMProvider](cci:2://file:///home/josue/Projections/future_stiamond/bot_int/apps/api/src/modules/chat/providers/fallback-llm.provider.ts:6:0-99:1) ([apps/api/src/modules/chat/providers/fallback-llm.provider.ts](cci:7://file:///home/josue/Projections/future_stiamond/bot_int/apps/api/src/modules/chat/providers/fallback-llm.provider.ts:0:0-0:0)).
- L'ordre dépend de `LLM_PROVIDER` :
  - `.env` a `LLM_PROVIDER=openai` → OpenAI/Groq est primaire, Ollama est **fallback**.
  - Si `LLM_PROVIDER=ollama`, Ollama devient primaire et OpenAI le fallback.

### 4. En local avec Docker

[docker-compose.yml](cci:7://file:///home/josue/Projections/future_stiamond/bot_int/docker-compose.yml:0:0-0:0) surcharge l'URL pour l'API containerisée :

```yaml
OLLAMA_URL: http://host.docker.internal:11434
OLLAMA_MODEL: ${OLLAMA_MODEL:-llama3.2}
```

Cela permet de pointer vers ton Ollama local sans Cloudflare en dev.

## Pour l'exploiter dans une autre appli

L'autre appli doit appeler `https://ollama.stiamond.net` avec les mêmes headers d'accès Cloudflare :

```bash
curl https://ollama.stiamond.net/api/generate \
  -H "CF-Access-Client-Id: $OLLAMA_CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $OLLAMA_CF_ACCESS_CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:latest",
    "prompt": "Salut",
    "stream": false,
    "options": { "num_ctx": 4096 }
  }'
```

Ou en JS/TS :

```ts
import axios from 'axios';

const res = await axios.post(
  'https://ollama.stiamond.net/api/chat',
  {
    model: 'llama3.1:latest',
    messages: [{ role: 'user', content: 'Salut' }],
    stream: false,
    options: { num_ctx: 4096 },
  },
  {
    headers: {
      'CF-Access-Client-Id': process.env.OLLAMA_CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.OLLAMA_CF_ACCESS_CLIENT_SECRET,
    },
  },
);
```

C'est donc un Ollama auto-hébergé, exposé au travers de **Cloudflare Access** avec un **Service Token** pour authentifier le backend (et potentiellement d'autres apps).






# OPEN AI FREE : 


Oui, il y a bien un autre provider IA : OpenAI/Groq pour le chat et Jina pour les embeddings.

## 1. Configuration dans `.env`

```bash
LLM_PROVIDER=openai

OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=...
OPENAI_MODEL=openai/gpt-oss-120b

OPENAI_EMBED_BASE_URL=https://api.jina.ai/v1
OPENAI_EMBED_API_KEY=...
OPENAI_EMBED_MODEL=jina-embeddings-v5-omni-small

JINA_EMBED_TASK=retrieval.query
JINA_EMBED_NORMALIZED=true
```

## 2. Provider `OpenAIProvider`

Fichier : `apps/api/src/modules/chat/providers/openai.provider.ts`

Il implémente la même interface `LLMProvider` que `OllamaProvider`. Il est donc interchangeable via `FallbackLLMProvider`.

Initialisation :

```ts
this.apiKey = config.get('OPENAI_API_KEY', '');
this.model = config.get('OPENAI_MODEL', 'gpt-4o-mini');
this.embedModel = config.get('OPENAI_EMBED_MODEL', 'text-embedding-3-small');
this.baseUrl = config.get('OPENAI_BASE_URL', 'https://api.openai.com/v1');
this.embedBaseUrl = config.get('OPENAI_EMBED_BASE_URL', this.baseUrl);
this.embedApiKey = config.get('OPENAI_EMBED_API_KEY', this.apiKey);
```

## 3. Chat (OpenAI-compatible)

Requête POST vers `${this.baseUrl}/chat/completions`.

```ts
const response = await axios.post(
  `${this.baseUrl}/chat/completions`,
  {
    model: this.model,
    messages,
    stream: false,
  },
  {
    headers: {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    },
  },
);
```

- Le `baseUrl` actuel est `https://api.groq.com/openai/v1` : on utilise donc Groq via une API OpenAI-compatible.
- La réponse est lue dans `data.choices[0].message.content`.
- L'usage est retourné dans `data.usage` (`prompt_tokens`, `completion_tokens`).

## 4. Streaming

Même endpoint, avec `stream: true` et `responseType: 'stream'`.

Le stream est au format SSE. Chaque ligne commence par `data: `. Le chunk est extrait avec :

```ts
const trimmed = line.trim();
if (!trimmed || !trimmed.startsWith('data: ')) continue;
const data = trimmed.slice(6);
if (data === '[DONE]') return;
const parsed = JSON.parse(data);
const delta = parsed.choices?.[0]?.delta?.content;
if (delta) yield delta;
```

## 5. Embeddings (Jina)

Le provider supporte deux formats d'embedding : OpenAI classique et Jina.

Si `embedBaseUrl` contient `api.jina.ai`, il envoie le payload Jina :

```ts
{
  model: this.embedModel,
  task: options?.task ?? this.config.get('JINA_EMBED_TASK', 'retrieval.query'),
  normalized: this.config.get('JINA_EMBED_NORMALIZED', 'true') !== 'false',
  input: [{ text }],
}
```

Sinon, format OpenAI :

```ts
{
  model: this.embedModel,
  input: text,
}
```

L'embedding retourné est `response.data.data[0].embedding`.

## 6. Place dans le système

- Fichier : `apps/api/src/modules/chat/chat.module.ts`
- `OpenAIProvider` est enregistré en tant que provider.
- `LLM_PROVIDER` est fourni par `FallbackLLMProvider`.
- `.env` a `LLM_PROVIDER=openai`, donc OpenAI/Groq est **primaire** et Ollama est **fallback**.
- Si `LLM_PROVIDER=ollama`, l'ordre s'inverse.

## 7. Pour l'exploiter dans une autre appli

### Chat via Groq

```bash
curl https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-oss-120b",
    "messages": [{"role": "user", "content": "Salut"}],
    "stream": false
  }'
```

### Embeddings via Jina

```bash
curl https://api.jina.ai/v1/embeddings \
  -H "Authorization: Bearer $OPENAI_EMBED_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jina-embeddings-v5-omni-small",
    "task": "retrieval.query",
    "normalized": true,
    "input": [{"text": "Comment fonctionne le produit ?"}]
  }'
```

### JS/TS

```ts
import axios from 'axios';

const chat = await axios.post(
  'https://api.groq.com/openai/v1/chat/completions',
  {
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'Salut' }],
    stream: false,
  },
  {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  },
);

const embed = await axios.post(
  'https://api.jina.ai/v1/embeddings',
  {
    model: 'jina-embeddings-v5-omni-small',
    task: 'retrieval.query',
    normalized: true,
    input: [{ text: 'Comment fonctionne le produit ?' }],
  },
  {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_EMBED_API_KEY}`,
      'Content-Type': 'application/json',
    },
  },
);
```

## Résumé

- **Chat** : OpenAI-compatible via `https://api.groq.com/openai/v1` (Groq).
- **Embeddings** : `https://api.jina.ai/v1` (Jina).
- **Fallback** : si OpenAI tombe, `FallbackLLMProvider` bascule sur Ollama (et inversement si `LLM_PROVIDER=ollama`).
