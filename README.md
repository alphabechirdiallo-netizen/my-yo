# Yo — Application de messagerie

Messagerie ultra-épurée, thème blanc/noir, style OpenAI.  
Stack : React + Supabase + Netlify (PWA installable)

---

## 🚀 Déploiement en 10 minutes

### Étape 1 — Créer le projet Supabase

1. Aller sur [supabase.com](https://supabase.com) → **New Project**
2. Choisir un nom et un mot de passe de base de données
3. Attendre ~2 minutes que le projet se crée

### Étape 2 — Configurer la base de données

1. Dans Supabase → **SQL Editor** → **New Query**
2. Copier-coller tout le contenu de `supabase_schema.sql`
3. Cliquer **Run**

### Étape 3 — Activer Realtime

Dans Supabase → **Database** → **Replication** → activer les tables :
- `messages`
- `conversations`
- `profiles`

### Étape 4 — Configurer l'authentification

Dans Supabase → **Authentication** → **Email** :
- Activer **Enable Email** ✅
- Désactiver **Confirm email** (optionnel, pour magic link direct)
- Dans **URL Configuration** → Site URL : `https://votre-app.netlify.app`

### Étape 5 — Récupérer les clés

Dans Supabase → **Settings** → **API** :
- `Project URL` → `REACT_APP_SUPABASE_URL`
- `anon public` → `REACT_APP_SUPABASE_ANON_KEY`

### Étape 6 — Déployer sur Netlify

#### Option A — Via l'interface Netlify (recommandé)

1. Pusher ce dossier sur GitHub
2. Aller sur [netlify.com](https://netlify.com) → **New site from Git**
3. Choisir le repo
4. **Build command** : `npm run build`
5. **Publish directory** : `build`
6. Dans **Environment variables** ajouter :
   - `REACT_APP_SUPABASE_URL` = votre URL
   - `REACT_APP_SUPABASE_ANON_KEY` = votre clé
7. **Deploy site** ✅

#### Option B — Via CLI Netlify

```bash
npm install -g netlify-cli
cp .env.example .env   # Remplir les valeurs
npm install
npm run build
netlify deploy --prod --dir=build
```

### Étape 7 — Mettre à jour l'URL Supabase

Dans Supabase → **Authentication** → **URL Configuration** :
- **Site URL** : `https://votre-app.netlify.app`
- **Redirect URLs** : `https://votre-app.netlify.app/**`

---

## 📱 Installation sur téléphone

**Android** : Dans Chrome, menu → "Ajouter à l'écran d'accueil"  
**iOS** : Dans Safari, partager → "Sur l'écran d'accueil"

---

## 🔑 Fonctionnement de l'authentification (sans SMS payant)

**Magic Link** : L'utilisateur entre son email ou numéro de téléphone.  
Un lien magique est envoyé sur l'email (pour les numéros, on génère un email dérivé du numéro).  
Un seul clic dans l'email suffit — pas de mot de passe, pas de SMS.

- Email → envoi direct à l'adresse
- Téléphone → génère `226XXXXXXXX@yo-phone.app` → email envoyé à cette adresse

> Note : Pour la version téléphone, l'utilisateur doit avoir accès à cet email généré.  
> Pour une prod réelle, utilisez simplement l'email uniquement, ou Twilio si budget dispo.

---

## 🏗 Architecture

```
src/
├── assets/        logo.png (votre logo)
├── components/    Avatar, BottomNav, NewChatModal
├── lib/           supabase.js, AuthContext, usePresence, utils
└── pages/         Splash, Auth, ProfileSetup, Chats, Chat, Contacts, Favorites, Profile
```

## Tables Supabase

| Table | Rôle |
|-------|------|
| `profiles` | Utilisateurs (nom, photo, statut en ligne) |
| `conversations` | Paires de participants + dernier message |
| `messages` | Messages avec sender et timestamp |
| `favorites` | Conversations favorites par utilisateur |


