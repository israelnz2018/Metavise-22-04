import { useEffect, useState } from 'react';
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User as FirebaseUser,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

interface UseAuthUserArgs {
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
}

// Identidade do usuário: login/signup/logout, papel (admin/user) e créditos.
// Extraído do App.tsx (era ~140 linhas espalhadas por lá) — mesmo
// comportamento, só isolado. loading/error continuam vindo de fora porque
// são compartilhados com o resto do app (não é estado exclusivo de auth).
export function useAuthUser({ setLoading, setError }: UseAuthUserArgs) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<'user' | 'admin'>('user');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [credits, setCredits] = useState<number>(0);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthReady(true);

      if (firebaseUser) {
        // Ensure user document exists
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          const isAdmin = firebaseUser.email === 'israelnz2018@hotmail.com';
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            credits: 1000,
            role: isAdmin ? 'admin' : 'user',
            createdAt: serverTimestamp(),
          });
          setUserRole(isAdmin ? 'admin' : 'user');
        } else {
          const data = userSnap.data();
          const isAdmin = firebaseUser.email === 'israelnz2018@hotmail.com';
          setUserRole(isAdmin ? 'admin' : data.role || 'user');
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setCredits(0);
      return;
    }

    const unsubscribeCredits = onSnapshot(
      doc(db, 'users', user.uid),
      (doc) => {
        if (doc.exists()) {
          setCredits(doc.data().credits);
        }
      },
      (error) => {
        console.error('Firestore Error (Credits):', error);
      }
    );

    return () => unsubscribeCredits();
  }, [user]);

  useEffect(() => {
    const handleCreditsUpdate = (e: any) => setCredits(e.detail);
    window.addEventListener('credits-updated', handleCreditsUpdate);
    return () => window.removeEventListener('credits-updated', handleCreditsUpdate);
  }, []);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error('Email Auth Error:', err);
      let msg = 'Erro na autenticação.';
      if (err.code === 'auth/email-already-in-use') msg = 'Este e-mail já está em uso.';
      if (err.code === 'auth/invalid-email') msg = 'E-mail inválido.';
      if (err.code === 'auth/weak-password') msg = 'Senha muito fraca.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password')
        msg = 'E-mail ou senha incorretos.';
      if (err.code === 'auth/operation-not-allowed')
        msg = 'O login por e-mail/senha não está habilitado no Console do Firebase.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Login Error:', err);
      setError('Falha ao entrar com Google.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout Error:', err);
    }
  };

  return {
    user,
    userRole,
    isAuthReady,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    credits,
    setCredits,
    handleEmailAuth,
    handleLogin,
    handleLogout,
  };
}
