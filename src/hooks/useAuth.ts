import { useEffect, useState } from 'react';
import { onAuthStateChanged, FirebaseAuthTypes } from '@react-native-firebase/auth';
import { auth } from '../lib/firebase';
import { getUserProfile, createUserDoc } from '../lib/firestore';
import { UserProfile } from '../types';

type User = FirebaseAuthTypes.User;

interface AuthState {
  /** The Firebase Auth user object, or null when signed out. */
  user: User | null;
  /** The Firestore user profile, or null when loading / signed out. */
  profile: UserProfile | null;
  /** True while the initial auth check is in progress. */
  loading: boolean;
}

/**
 * Subscribe to Firebase Auth state and automatically fetch
 * the matching Firestore user profile.
 */
export const useAuth = (): AuthState => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        try {
          let userProfile = await getUserProfile(firebaseUser.uid);
          if (!userProfile) {
            // Auto-initialize profile document for users created directly via Console
            await createUserDoc(
              firebaseUser.uid,
              firebaseUser.displayName || 'Player',
              firebaseUser.email || ''
            );
            userProfile = await getUserProfile(firebaseUser.uid);
          }
          setProfile(userProfile);
        } catch (err) {
          console.error('[useAuth] Error fetching user profile:', err);
          setProfile(null);
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return { user, profile, loading };
};
