// firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Ganti dengan config dari Firebase Console > Project settings > Your apps
const firebaseConfig = {
  apiKey: 'AIzaSyCKpJRC2-Y9YBoZ8omzlDDGb1UzNcQtmeE',
  authDomain: 'daily-of-noura.firebaseapp.com',
  projectId: 'daily-of-noura',
  storageBucket: 'daily-of-noura.appspot.com',
  messagingSenderId: '49327333723',
  appId: '1:49327333723:web:372e4a9e9850a15494fa7e',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
