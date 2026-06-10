/**
 * Firebase service initialisation (modular API).
 *
 * Centralises access so screens never import Firebase directly.
 */
import { getAuth } from '@react-native-firebase/auth';
import { getFirestore } from '@react-native-firebase/firestore';

/**
 * Pre-initialised Auth instance for the default Firebase app.
 */
export const auth = getAuth();

/**
 * Pre-initialised Firestore instance for the default Firebase app.
 */
export const firestore = getFirestore();
