'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserProfile } from '@/lib/types';

interface AuthContextType {
  user: UserProfile;
  login: (user: Partial<UserProfile> & { id: string }) => void;
  logout: () => void;
  isLoading: boolean;
}

const DEFAULT_USER: UserProfile = {
  id: 'demo-user-1',
  email: 'demo@citewriter.local',
  name: 'Demo Author',
  role: 'user',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile>(DEFAULT_USER);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('citewriter_user');
      if (stored) {
        setUser(JSON.parse(stored));
      } else {
        localStorage.setItem('citewriter_user', JSON.stringify(DEFAULT_USER));
      }
    } catch {
      // Fallback for SSR / private mode
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = (newUser: Partial<UserProfile> & { id: string }) => {
    const updated: UserProfile = {
      id: newUser.id,
      email: newUser.email ?? `${newUser.id}@citewriter.local`,
      name: newUser.name ?? `User ${newUser.id}`,
      role: newUser.role ?? 'user',
    };
    setUser(updated);
    try {
      localStorage.setItem('citewriter_user', JSON.stringify(updated));
    } catch {
      // Ignore
    }
  };

  const logout = () => {
    setUser(DEFAULT_USER);
    try {
      localStorage.setItem('citewriter_user', JSON.stringify(DEFAULT_USER));
    } catch {
      // Ignore
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
