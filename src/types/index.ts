import { Timestamp } from '@react-native-firebase/firestore';

export * from './session';

/**
 * Core user profile stored in Firestore `users/{uid}`.
 */
export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  onboarded: boolean;
  createdAt: Timestamp | null;
}
