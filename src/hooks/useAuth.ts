import { useEffect, useState } from 'react';
import { onAuthStateChanged, FirebaseAuthTypes } from '@react-native-firebase/auth';
import { doc, onSnapshot } from '@react-native-firebase/firestore';
import { auth, firestore } from '../lib/firebase';
import { getUserProfile, createUserDoc } from '../lib/firestore';
import { UserProfile } from '../types';

type User = FirebaseAuthTypes.User;

interface AuthState {
  /** The Firebase Auth user object, or null when signed out. */
  user: User | null;
  /** The Firestore user profile, or null when loading / signed out. */
  profile: UserProfile | null;
  /** True while the initial auth check or profile fetch is in progress. */
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
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up existing profile subscription
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      setUser(firebaseUser);

      if (firebaseUser) {
        setLoading(true);
        let retryCount = 0;

        const initializeSession = async () => {
          try {
            // Initialize user profile document if it doesn't exist yet
            let userProfile = await getUserProfile(firebaseUser.uid);
            if (!userProfile) {
              await createUserDoc(
                firebaseUser.uid,
                firebaseUser.displayName || 'Player',
                firebaseUser.email || ''
              );
            }

            // Subscribe to real-time changes of the profile document
            const userRef = doc(firestore, 'users', firebaseUser.uid);
            unsubscribeProfile = onSnapshot(
              userRef,
              (snapshot) => {
                if (snapshot.exists()) {
                  setProfile(snapshot.data() as UserProfile);
                } else {
                  setProfile(null);
                }
                setLoading(false);
              },
              (err) => {
                // If user signed out, ignore permission errors
                if (!auth.currentUser) return;

                console.error('[useAuth] Error in user profile snapshot listener:', err);
                setProfile(null);
                setLoading(false);
              }
            );
          } catch (err) {
            // If the user signed out during setup, ignore
            if (!auth.currentUser) return;

            const firebaseError = err as { code?: string; message?: string };

            // Handle temporary token propagation delay with retry
            if (firebaseError && firebaseError.code === 'firestore/permission-denied' && retryCount < 3) {
              retryCount++;
              console.warn(`[useAuth] Permission denied during init, retrying profile load (${retryCount}/3)...`);
              setTimeout(() => {
                if (auth.currentUser) {
                  initializeSession();
                }
              }, 250);
              return;
            }

            console.error('[useAuth] Error initializing user profile:', err);
            setProfile(null);
            setLoading(false);
          }
        };

        initializeSession();
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  return { user, profile, loading };
};
