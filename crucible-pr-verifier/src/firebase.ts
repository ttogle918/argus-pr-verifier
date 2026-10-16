import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocFromServer,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export async function signInWithGooglePopup() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutFirebase() {
  return signOut(auth);
}

export interface StoredTranslationPayload {
  prId: string;
  lang: 'ko' | 'en';
  prTitle: string;
  prDescription: string;
  executiveSummary: string;
  invariants: Array<{
    id: string;
    title: string;
    rationale: string;
    plannedAttackVector: string;
  }>;
  tests: Array<{
    id: string;
    hypothesis: string;
    failureOutput: string;
    remediationHint: string;
  }>;
  plantedBugs: Array<{
    id: string;
    name: string;
    description: string;
    blindSpotAnalysis: string;
  }>;
  residualRisks: Array<{
    id: string;
    title: string;
    source: string;
    impact: string;
    recommendation: string;
  }>;
  sandboxSteps: Array<{
    index: number;
    summary: string;
  }>;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'default_id';
}

export async function loadTranslationFromFirestore(
  prId: string,
  lang: 'ko' | 'en'
): Promise<StoredTranslationPayload | null> {
  if (!auth.currentUser) return null;
  const safeDocId = sanitizeId(`${auth.currentUser.uid}_${prId}_${lang}`);
  const path = `translations/${safeDocId}`;
  try {
    const snap = await getDoc(doc(db, 'translations', safeDocId));
    if (!snap.exists()) return null;
    return snap.data() as StoredTranslationPayload;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveTranslationToFirestore(
  payload: StoredTranslationPayload
): Promise<boolean> {
  if (!auth.currentUser) return false;
  const safePrId = sanitizeId(payload.prId);
  const safeDocId = sanitizeId(`${auth.currentUser.uid}_${safePrId}_${payload.lang}`);
  const path = `translations/${safeDocId}`;
  const docRef = doc(db, 'translations', safeDocId);

  try {
    const existingSnap = await getDoc(docRef);
    const sanitizedData = {
      prId: safePrId,
      lang: payload.lang === 'ko' ? 'ko' : 'en',
      prTitle: (payload.prTitle || 'Untitled PR').slice(0, 500),
      prDescription: (payload.prDescription || 'No description').slice(0, 4000),
      executiveSummary: (payload.executiveSummary || 'No summary').slice(0, 4000),
      invariants: (payload.invariants || []).slice(0, 10).map((i) => ({
        id: String(i.id || '').slice(0, 64),
        title: String(i.title || '').slice(0, 300),
        rationale: String(i.rationale || '').slice(0, 1500),
        plannedAttackVector: String(i.plannedAttackVector || '').slice(0, 1500),
      })),
      tests: (payload.tests || []).slice(0, 10).map((t) => ({
        id: String(t.id || '').slice(0, 64),
        hypothesis: String(t.hypothesis || '').slice(0, 1500),
        failureOutput: String(t.failureOutput || '').slice(0, 1500),
        remediationHint: String(t.remediationHint || '').slice(0, 1500),
      })),
      plantedBugs: (payload.plantedBugs || []).slice(0, 10).map((m) => ({
        id: String(m.id || '').slice(0, 64),
        name: String(m.name || '').slice(0, 300),
        description: String(m.description || '').slice(0, 1500),
        blindSpotAnalysis: String(m.blindSpotAnalysis || '').slice(0, 1500),
      })),
      residualRisks: (payload.residualRisks || []).slice(0, 10).map((r) => ({
        id: String(r.id || '').slice(0, 64),
        title: String(r.title || '').slice(0, 300),
        source: String(r.source || '').slice(0, 300),
        impact: String(r.impact || '').slice(0, 1500),
        recommendation: String(r.recommendation || '').slice(0, 1500),
      })),
      sandboxSteps: (payload.sandboxSteps || []).slice(0, 10).map((s) => ({
        index: Number(s.index || 1),
        summary: String(s.summary || '').slice(0, 1000),
      })),
      ownerId: auth.currentUser.uid,
      createdAt: existingSnap.exists() ? existingSnap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(docRef, sanitizedData);
    return true;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      path
    );
  }
}
