import { doc, setDoc, getDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { firestore } from './firebase';
import { UserProfile } from '../types';

/**
 * Create or merge a user document in Firestore.
 *
 * Uses `setDoc` with `{ merge: true }` to avoid silent failures
 * when the document does not yet exist.
 */
export const createUserDoc = async (
  uid: string,
  name: string,
  email: string,
): Promise<void> => {
  const userRef = doc(firestore, 'users', uid);
  await setDoc(
    userRef,
    {
      uid,
      name,
      email,
      onboarded: false,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
};

/**
 * Fetch a user profile from Firestore.
 *
 * Returns `null` if the document does not exist.
 */
export const getUserProfile = async (
  uid: string,
): Promise<UserProfile | null> => {
  const userRef = doc(firestore, 'users', uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    return null;
  }

  return snap.data() as UserProfile;
};
