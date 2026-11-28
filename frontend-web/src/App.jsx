import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AuthPage } from "./pages/AuthPage";
import { AppPage } from "./pages/AppPage";
import { GuestBenefitsDialog } from "./components/GuestBenefitsDialog";
import { useState } from "react";

function Root() {
  const {
    user,
    loading,
    bootstrapError,
    bootstrapGuest,
    activePrompt,
    dismissPrompt,
    recordPromptAction,
    clearGuestPrompt,
  } = useAuth();
  const [authMode, setAuthMode] = useState(null);

  if (loading) {
    return (
      <div className="splash">
        <div className="splash__content">
          <div className="splash__logo">⚡</div>
          <div className="spinner" />
          <p>Connecting to secure network...</p>
        </div>
      </div>
    );
  }

  if (!user && bootstrapError) {
    return (
      <div className="splash">
        <div className="splash__content">
          <div className="splash__logo">⚡</div>
          <p>{bootstrapError}</p>
          <button className="btn btn--primary" onClick={bootstrapGuest}>Retry</button>
        </div>
      </div>
    );
  }

  if (authMode) {
    return <AuthPage initialMode={authMode} onCancel={() => setAuthMode(null)} />;
  }

  return (
    <>
      <AppPage />
      <GuestBenefitsDialog
        prompt={activePrompt}
        onSaveForLater={dismissPrompt}
        onSignUp={async () => {
          await recordPromptAction(activePrompt, "signup");
          clearGuestPrompt();
          setAuthMode("register");
        }}
        onSignIn={async () => {
          await recordPromptAction(activePrompt, "signin");
          clearGuestPrompt();
          setAuthMode("login");
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
