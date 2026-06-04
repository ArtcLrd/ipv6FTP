import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AuthPage } from "./pages/AuthPage";
import { AppPage } from "./pages/AppPage";

function Root() {
  const { user, loading } = useAuth();

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

  return user ? <AppPage /> : <AuthPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
