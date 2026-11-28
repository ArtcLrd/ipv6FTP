export function GuestBenefitsDialog({ prompt, onSignUp, onSignIn, onSaveForLater }) {
  if (!prompt) return null;

  const copy = {
    quota_exhausted: {
      title: "Your guest quota is used",
      body: "Create a free account to keep your identity, unlock registered features, and use unlimited IPv6 calling.",
    },
    weekly_benefits_reminder: {
      title: "Keep this setup with an account",
      body: "You can continue as a guest. Signing up preserves your device flow and unlocks contacts plus registered calling benefits.",
    },
    restricted_feature: {
      title: "This feature needs an account",
      body: "Contacts, search, and account-level features are available after sign up.",
    },
  }[prompt.reason] || {
    title: "Create an account",
    body: "Unlock registered features and keep your setup across sessions.",
  };

  return (
    <div className="benefits-dialog" role="dialog" aria-modal="true">
      <button className="benefits-dialog__backdrop" onClick={onSaveForLater} aria-label="Close" />
      <div className="benefits-dialog__panel">
        <button className="benefits-dialog__close" onClick={onSaveForLater} aria-label="Close">×</button>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        <ul>
          <li>Unlimited IPv6 voice and video</li>
          <li>Contacts, devices, and registered account features</li>
          <li>30 minutes of IPv4 calling per UTC day</li>
        </ul>
        <div className="benefits-dialog__actions">
          <button className="btn btn--primary" onClick={onSignUp}>Sign Up</button>
          <button className="btn btn--ghost" onClick={onSaveForLater}>Save it for later</button>
        </div>
        <button className="benefits-dialog__link" onClick={onSignIn}>Already registered? Sign in</button>
      </div>
    </div>
  );
}
