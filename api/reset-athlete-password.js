// Réinitialise le mot de passe Firebase Auth d'un athlète, appelé depuis la fiche
// athlète de l'appli Coach. Le SDK client du coach ne peut pas changer le mot de
// passe d'un AUTRE utilisateur Firebase Auth — il faut un accès admin (compte de
// service), donc ça passe forcément par ici plutôt que par le client.
//
// Sécurité : le token du coach est vérifié auprès d'Identity Toolkit (équivalent
// distant de admin.auth().verifyIdToken(), sans dépendance npm), puis on vérifie
// que athleteAccounts/{athleteId}.coachId correspond bien à l'uid résolu — même
// condition que les règles Firestore (resource.data.coachId == request.auth.uid).
'use strict';
import crypto from 'crypto';

// Clé API Web Firebase — déjà publique côté client (firebaseConfig dans index.html),
// nécessaire seulement pour faire valider le idToken par Identity Toolkit.
const FIREBASE_API_KEY = 'AIzaSyBF1BO_0JDvEs43bAYBaxhHFiHlah_RqaM';
const DEFAULT_PASSWORD = 'Defcon';

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function buildJWT(serviceAccount, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email, scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
  };
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(serviceAccount.private_key);
  return unsigned + '.' + base64url(signature);
}
async function getServiceAccountToken(serviceAccount, scopes) {
  const jwt = buildJWT(serviceAccount, scopes);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt)
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Échange de jeton échoué: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const { athleteId } = req.body || {};
  if (!idToken || !athleteId) return res.status(400).json({ error: 'Paramètres manquants' });

  try {
    // Vérifie le token du coach appelant.
    const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
    });
    const lookup = await lookupRes.json();
    const callerUid = lookup.users && lookup.users[0] && lookup.users[0].localId;
    if (!callerUid) return res.status(401).json({ error: 'Session invalide, reconnecte-toi.' });

    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON manquant côté serveur');
    }
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    const accessToken = await getServiceAccountToken(serviceAccount, [
      'https://www.googleapis.com/auth/datastore',
      'https://www.googleapis.com/auth/identitytoolkit'
    ]);
    const projectId = serviceAccount.project_id;

    // Vérifie que cet athlète appartient bien au coach qui appelle, avant de toucher
    // à son mot de passe.
    const docRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/athleteAccounts/${athleteId}`,
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    if (docRes.status === 404) return res.status(404).json({ error: 'Athlète introuvable' });
    const doc = await docRes.json();
    const fields = doc.fields || {};
    const coachId = fields.coachId && fields.coachId.stringValue;
    const authUid = fields.authUid && fields.authUid.stringValue;
    if (coachId !== callerUid) return res.status(403).json({ error: 'Non autorisé' });
    if (!authUid) return res.status(404).json({ error: "Compte Firebase de l'athlète introuvable" });

    const updateRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:update', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: authUid, password: DEFAULT_PASSWORD })
    });
    const updateData = await updateRes.json();
    if (updateData.error) throw new Error(JSON.stringify(updateData.error));

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
