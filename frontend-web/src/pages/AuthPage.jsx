import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export function AuthPage({ initialMode = "login", onCancel }) {
  const [isLogin, setIsLogin] = useState(initialMode !== "register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = isLogin 
      ? await login(username, password)
      : await register(username, password);

    if (!result.ok) {
      setError(result.error || "An error occurred");
    }
    setLoading(false);
  };

  const getPasswordStrength = (pass) => {
    if (!pass) return 0;
    let strength = 0;
    if (pass.length >= 8) strength++;
    if (/[A-Z]/.test(pass)) strength++;
    if (/[0-9]/.test(pass)) strength++;
    if (/[^A-Za-z0-9]/.test(pass)) strength++;
    return strength;
  };

  const strength = isLogin ? 0 : getPasswordStrength(password);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__header">
          <div className="auth-card__logo">⚡</div>
          <h1 className="auth-card__title">ipv6FTP</h1>
          <p className="auth-card__tagline">Fast, Secure P2P Network</p>
        </div>

        <div className="auth-tabs">
          <button 
            className={`auth-tabs__btn ${isLogin ? "auth-tabs__btn--active" : ""}`}
            onClick={() => { setIsLogin(true); setError(""); }}
          >
            Sign In
          </button>
          <button 
            className={`auth-tabs__btn ${!isLogin ? "auth-tabs__btn--active" : ""}`}
            onClick={() => { setIsLogin(false); setError(""); }}
          >
            Create Account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-form__error">{error}</div>}
          
          <div className="auth-form__field">
            <label>Username</label>
            <input
              type="text"
              className="input"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="auth-form__field">
            <label>Password</label>
            <input
              type="password"
              className="input"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {!isLogin && (
              <div className="strength-meter">
                <div className={`strength-meter__bar strength-meter__bar--${strength}`} />
                <span className="strength-meter__label">
                  {strength < 2 ? "Weak" : strength === 2 ? "Fair" : strength === 3 ? "Good" : "Strong"}
                </span>
              </div>
            )}
          </div>

          <button className="btn btn--primary auth-form__submit" disabled={loading}>
            {loading ? "Please wait..." : isLogin ? "Sign In" : "Sign Up"}
          </button>
        </form>

        <div className="auth-card__footer">
          <p>Login is optional. You can still use basic features without an account.</p>
          {onCancel && (
            <button className="benefits-dialog__link" type="button" onClick={onCancel}>
              Continue as guest
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
