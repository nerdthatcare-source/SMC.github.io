/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-Side Firebase Initialization
 */

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
