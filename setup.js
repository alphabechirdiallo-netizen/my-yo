#!/usr/bin/env node

/**
 * YO APP — Script de déploiement automatique
 * Usage : node setup.js
 */

const { execSync, spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────
// Couleurs terminal
// ─────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

const log = {
  step: (n, msg) => console.log(`\n${c.bold}${c.blue}[${n}]${c.reset} ${c.bold}${msg}${c.reset}`),
  ok: (msg) => console.log(`${c.green}  ✓ ${msg}${c.reset}`),
  info: (msg) => console.log(`${c.cyan}  → ${msg}${c.reset}`),
  warn: (msg) => console.log(`${c.yellow}  ⚠ ${msg}${c.reset}`),
  error: (msg) => console.log(`${c.red}  ✗ ${msg}${c.reset}`),
  dim: (msg) => console.log(`${c.dim}    ${msg}${c.reset}`),
  blank: () => console.log(''),
};

function banner() {
  console.clear();
  console.log(`
${c.bold}${c.blue}╔═══════════════════════════════════════╗
║           YO — Setup & Deploy          ║
╚═══════════════════════════════════════╝${c.reset}
${c.dim}Ce script installe, configure et déploie
Yo automatiquement en quelques minutes.${c.reset}
`);
}

// ─────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────
function ask(rl, question, hidden = false) {
  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      let input = '';
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = (char) => {
        if (char === '\n' || char === '\r' || char === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
        } else if (char === '\u007f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + '•'.repeat(input.length));
          }
        } else {
          input += char;
          process.stdout.write('•');
        }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(question, resolve);
    }
  });
}

function run(cmd, label, options = {}) {
  try {
    execSync(cmd, { stdio: options.silent ? 'pipe' : 'inherit', ...options });
    if (label) log.ok(label);
    return true;
  } catch (e) {
    if (label) log.error(`Échec : ${label}`);
    if (options.throw) throw e;
    return false;
  }
}

function checkCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'pipe' }).toString();
  else if (platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'pipe' });
  else execSync(`xdg-open "${url}" 2>/dev/null || true`, { stdio: 'pipe' });
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────
async function main() {
  banner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // ── Étape 1 : Vérifier Node & npm ──────
  log.step('1/6', 'Vérification de l\'environnement');

  const nodeOk = checkCommand('node');
  const npmOk = checkCommand('npm');

  if (!nodeOk || !npmOk) {
    log.error('Node.js n\'est pas installé.');
    log.info('Installez-le sur : https://nodejs.org');
    process.exit(1);
  }

  const nodeVer = execSync('node --version', { stdio: 'pipe' }).toString().trim();
  const npmVer = execSync('npm --version', { stdio: 'pipe' }).toString().trim();
  log.ok(`Node ${nodeVer} détecté`);
  log.ok(`npm ${npmVer} détecté`);

  // ── Étape 2 : Clés Supabase ────────────
  log.step('2/6', 'Configuration Supabase');
  log.blank();

  console.log(`${c.yellow}${c.bold}  Vous avez besoin de vos clés Supabase.${c.reset}`);
  console.log(`${c.dim}  Si vous n'avez pas encore de projet Supabase :${c.reset}`);
  console.log(`${c.dim}  1. Allez sur https://supabase.com → New project${c.reset}`);
  console.log(`${c.dim}  2. Settings → API → copiez Project URL et anon key${c.reset}`);
  log.blank();

  const openSupabase = await ask(rl, `  ${c.cyan}Ouvrir supabase.com dans le navigateur ? (o/n) :${c.reset} `);
  if (openSupabase.toLowerCase() !== 'n') {
    openBrowser('https://supabase.com/dashboard');
    log.info('Navigateur ouvert — revenez ici une fois vos clés copiées.');
    log.blank();
  }

  const supabaseUrl = await ask(rl, `  ${c.cyan}Project URL (https://xxxx.supabase.co) :${c.reset} `);
  const supabaseKey = await ask(rl, `  ${c.cyan}Anon public key (eyJ...) :${c.reset} `, false);

  if (!supabaseUrl.includes('supabase.co') || !supabaseKey.startsWith('eyJ')) {
    log.error('Clés invalides. Vérifiez et relancez le script.');
    rl.close();
    process.exit(1);
  }

  // Écrire le .env
  const envContent = `REACT_APP_SUPABASE_URL=${supabaseUrl.trim()}\nREACT_APP_SUPABASE_ANON_KEY=${supabaseKey.trim()}\n`;
  fs.writeFileSync(path.join(__dirname, '.env'), envContent);
  log.ok('.env créé avec vos clés');

  // ── Étape 3 : SQL Supabase ─────────────
  log.step('3/6', 'Base de données Supabase');
  log.blank();

  console.log(`${c.yellow}${c.bold}  Il faut exécuter le SQL dans Supabase.${c.reset}`);
  console.log(`${c.dim}  Le fichier supabase_schema.sql va s'ouvrir.${c.reset}`);
  console.log(`${c.dim}  Copiez son contenu dans SQL Editor → Run.${c.reset}`);
  log.blank();

  const openSQL = await ask(rl, `  ${c.cyan}Ouvrir Supabase SQL Editor + le fichier SQL ? (o/n) :${c.reset} `);
  if (openSQL.toLowerCase() !== 'n') {
    // Ouvrir le SQL Editor
    const projectId = supabaseUrl.replace('https://', '').split('.')[0];
    openBrowser(`https://supabase.com/dashboard/project/${projectId}/sql/new`);

    // Ouvrir le fichier SQL dans l'éditeur par défaut
    const sqlPath = path.join(__dirname, 'supabase_schema.sql');
    if (fs.existsSync(sqlPath)) {
      if (process.platform === 'darwin') execSync(`open "${sqlPath}"`, { stdio: 'pipe' });
      else if (process.platform === 'win32') execSync(`notepad "${sqlPath}"`, { stdio: 'pipe' });
      else execSync(`xdg-open "${sqlPath}" 2>/dev/null || cat "${sqlPath}"`, { stdio: 'inherit' });
    }

    log.info('SQL Editor ouvert — collez le SQL et cliquez Run.');
    log.blank();
  }

  await ask(rl, `  ${c.cyan}Appuyez sur Entrée une fois le SQL exécuté...${c.reset} `);
  log.ok('Base de données configurée');

  // ── Étape 4 : npm install ──────────────
  log.step('4/6', 'Installation des dépendances npm');
  log.info('Cela peut prendre 1-2 minutes...');

  const installOk = run('npm install --legacy-peer-deps', null, { silent: false });
  if (!installOk) {
    log.error('npm install a échoué. Vérifiez votre connexion internet.');
    rl.close();
    process.exit(1);
  }
  log.ok('Dépendances installées');

  // ── Étape 5 : Build ───────────────────
  log.step('5/6', 'Construction de l\'application');
  log.info('Build en cours...');

  const buildOk = run('npm run build', null);
  if (!buildOk) {
    log.error('Le build a échoué. Vérifiez les erreurs ci-dessus.');
    rl.close();
    process.exit(1);
  }
  log.ok('Application construite avec succès');

  // ── Étape 6 : Netlify ─────────────────
  log.step('6/6', 'Déploiement sur Netlify');
  log.blank();

  // Installer netlify-cli si absent
  const netlifyOk = checkCommand('netlify');
  if (!netlifyOk) {
    log.info('Installation de Netlify CLI...');
    run('npm install -g netlify-cli', 'Netlify CLI installé', { silent: true });
  } else {
    log.ok('Netlify CLI déjà installé');
  }

  // Login Netlify
  log.info('Connexion à Netlify (navigateur va s\'ouvrir)...');
  log.blank();
  run('netlify login', 'Connecté à Netlify');

  // Initialiser le site Netlify (crée le site si pas encore fait)
  log.info('Initialisation du site Netlify...');
  const initOk = run('netlify init --force 2>/dev/null || netlify link 2>/dev/null || true', null, { silent: true });

  // Injecter les variables d'environnement dans Netlify
  log.info('Injection des clés Supabase dans Netlify...');
  run(`netlify env:set REACT_APP_SUPABASE_URL "${supabaseUrl.trim()}"`, 'SUPABASE_URL envoyée à Netlify', { silent: false });
  run(`netlify env:set REACT_APP_SUPABASE_ANON_KEY "${supabaseKey.trim()}"`, 'SUPABASE_ANON_KEY envoyée à Netlify', { silent: false });
  log.ok('Variables d\'environnement configurées sur Netlify');

  // Déployer
  log.info('Déploiement en cours...');
  log.blank();

  try {
    const output = execSync('netlify deploy --prod --dir=build --json 2>/dev/null || netlify deploy --prod --dir=build', {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    // Extraire l'URL
    let siteUrl = '';
    try {
      const json = JSON.parse(output);
      siteUrl = json.deploy_url || json.url || '';
    } catch {
      const match = output.match(/https:\/\/[a-z0-9-]+\.netlify\.app/);
      siteUrl = match ? match[0] : '';
    }

    log.blank();
    console.log(`${c.bold}${c.green}╔═══════════════════════════════════════╗`);
    console.log(`║           🎉 YO EST EN LIGNE !         ║`);
    console.log(`╚═══════════════════════════════════════╝${c.reset}`);
    log.blank();

    if (siteUrl) {
      console.log(`${c.bold}  URL : ${c.cyan}${siteUrl}${c.reset}`);
      log.blank();

      // Dernière étape : URL dans Supabase
      console.log(`${c.yellow}${c.bold}  Dernière étape — Mettez à jour Supabase :${c.reset}`);
      console.log(`${c.dim}  Authentication → URL Configuration${c.reset}`);
      console.log(`${c.dim}  Site URL → ${siteUrl}${c.reset}`);
      console.log(`${c.dim}  Redirect URLs → ${siteUrl}/**${c.reset}`);
      log.blank();

      const openAuth = await ask(rl, `  ${c.cyan}Ouvrir la page Auth Supabase maintenant ? (o/n) :${c.reset} `);
      if (openAuth.toLowerCase() !== 'n') {
        const projectId = supabaseUrl.replace('https://', '').split('.')[0];
        openBrowser(`https://supabase.com/dashboard/project/${projectId}/auth/url-configuration`);
        log.info('Page Auth Supabase ouverte.');
      }
    }

  } catch (e) {
    log.warn('Déploiement manuel requis :');
    log.info('netlify deploy --prod --dir=build');
  }

  log.blank();
  log.ok('Tout est terminé. Partagez votre URL et installez Yo sur votre téléphone !');
  log.blank();

  rl.close();
}

main().catch((err) => {
  console.error('\n' + c.red + 'Erreur inattendue : ' + err.message + c.reset);
  process.exit(1);
});
