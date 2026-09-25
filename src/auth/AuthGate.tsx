import { useCallback, useState } from 'react'
import Shell from '../shell/Shell'
import { AUTH_SESSION_KEY } from './credentials'
import LoginScreen from './LoginScreen'

function isAuthed(): boolean {
  try {
    return sessionStorage.getItem(AUTH_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export default function AuthGate() {
  const [authed, setAuthed] = useState(isAuthed)

  const handleLogout = useCallback(() => {
    try {
      sessionStorage.removeItem(AUTH_SESSION_KEY)
    } catch {
      /* ignore */
    }
    setAuthed(false)
  }, [])

  if (!authed) {
    return <LoginScreen onSuccess={() => setAuthed(true)} />
  }

  return <Shell onLogout={handleLogout} />
}
