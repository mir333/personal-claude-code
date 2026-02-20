import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, User, Loader2, Eye, EyeOff, Sparkles } from "lucide-react";

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function PasswordStrength({ password }) {
  if (!password) return null;
  const len = password.length;
  let strength = 0;
  if (len >= 4) strength++;
  if (len >= 8) strength++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) strength++;
  if (/\d/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;

  const labels = ["Weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-red-500", "bg-red-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"];
  const idx = Math.min(strength, 4);

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i < strength ? colors[idx] : "bg-muted"
            }`}
          />
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">{labels[idx]}</span>
    </div>
  );
}

function ProfileAvatar({ name, size = "lg", className = "" }) {
  const letter = name?.charAt(0)?.toUpperCase() || "?";
  const sizes = {
    sm: "h-10 w-10 text-base",
    lg: "h-16 w-16 text-2xl",
    xl: "h-20 w-20 text-3xl",
  };
  return (
    <div
      className={`${sizes[size]} rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white font-bold shadow-lg shadow-primary/20 ${className}`}
    >
      {letter}
    </div>
  );
}

// --- Mode: Profile Selector ---
function ProfileSelector({ profiles, onSelectProfile, onCreateNew }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Claude Web UI</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose your profile to continue</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectProfile(p)}
            className="group flex flex-col items-center gap-2.5 p-5 rounded-xl border border-border bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
          >
            <ProfileAvatar name={p.name} size="sm" />
            <div className="text-center min-w-0 w-full">
              <div className="text-sm font-medium truncate">{p.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">@{p.slug}</div>
            </div>
          </button>
        ))}

        <button
          onClick={onCreateNew}
          className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 cursor-pointer"
        >
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <Plus className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">New Profile</span>
        </button>
      </div>
    </div>
  );
}

// --- Mode: Profile Login ---
function ProfileLogin({ profile, onBack, onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, password }),
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess(data.profile);
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to profiles
      </button>

      <div className="flex flex-col items-center mb-8">
        <ProfileAvatar name={profile.name} size="xl" className="mb-4" />
        <h2 className="text-xl font-bold">{profile.name}</h2>
        <p className="text-sm text-muted-foreground">@{profile.slug}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            className="pr-10 h-11 bg-background/50 border-border/50 focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full h-11 font-medium" disabled={loading || !password}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            "Sign In"
          )}
        </Button>
      </form>
    </div>
  );
}

// --- Mode: Create Profile ---
function CreateProfile({ onBack, onSuccess, isFirst }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const slug = slugify(name.trim());
  const passwordsMatch = password && confirmPassword && password === confirmPassword;
  const canSubmit = name.trim().length >= 2 && password.length >= 4 && passwordsMatch;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password }),
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess(data.profile);
      } else {
        setError(data.error || "Failed to create profile");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {!isFirst && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profiles
        </button>
      )}

      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
          <User className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold">
          {isFirst ? "Create Your Profile" : "New Profile"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isFirst
            ? "Set up your workspace to get started"
            : "Create an isolated workspace with its own settings"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus
            className="h-11 bg-background/50 border-border/50 focus:border-primary/50"
          />
          {slug && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Workspace: <span className="font-mono text-primary/70">@{slug}</span>
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">Password</label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 4 characters"
              className="pr-10 h-11 bg-background/50 border-border/50 focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <PasswordStrength password={password} />
        </div>

        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">
            Confirm Password
          </label>
          <Input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
            className={`h-11 bg-background/50 border-border/50 focus:border-primary/50 ${
              confirmPassword && !passwordsMatch ? "border-destructive/50" : ""
            }`}
          />
          {confirmPassword && !passwordsMatch && (
            <p className="text-[11px] text-destructive mt-1">Passwords don't match</p>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full h-11 font-medium" disabled={loading || !canSubmit}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Profile"
          )}
        </Button>
      </form>
    </div>
  );
}

// --- Mode: Legacy Password (AUTH_PASSWORD mode, no profiles) ---
function LegacyLogin({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onSuccess(null);
      } else {
        const data = await res.json();
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Claude Web UI</h1>
        <p className="text-sm text-muted-foreground mt-1">Enter password to continue</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="h-11 bg-background/50 border-border/50 focus:border-primary/50"
        />
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full h-11 font-medium" disabled={loading || !password}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            "Sign In"
          )}
        </Button>
      </form>
    </div>
  );
}

// --- Main LoginScreen ---
export default function LoginScreen({ onSuccess }) {
  const [mode, setMode] = useState("loading"); // loading | select | login | create | legacy
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);

  useEffect(() => {
    // Check current auth state + load profiles
    Promise.all([
      fetch("/api/auth/check").then((r) => r.json()),
      fetch("/api/profiles").then((r) => r.json()),
    ])
      .then(([authData, profileList]) => {
        if (authData.authenticated) {
          onSuccess(authData.profile);
          return;
        }
        setProfiles(profileList || []);
        if (authData.hasProfiles && profileList?.length > 0) {
          setMode("select");
        } else if (!authData.hasProfiles && !authData.authenticated) {
          // No profiles exist — check if AUTH_PASSWORD is set by trying an empty login
          // If hasProfiles is false and not authenticated, either it's open mode or AUTH_PASSWORD
          // The auth/check endpoint tells us
          if (authData.hasProfiles === false && profileList?.length === 0) {
            // Could be legacy password mode or first-time setup
            // Try to see if we need a password
            fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: "" }),
            })
              .then((r) => {
                if (r.ok) {
                  // No password needed (open mode) — shouldn't reach here since auth/check returned not authenticated
                  onSuccess(null);
                } else {
                  // AUTH_PASSWORD is set — show legacy login
                  setMode("legacy");
                }
              })
              .catch(() => {
                // Default to creating first profile
                setMode("create");
              });
          } else {
            setMode("create");
          }
        } else {
          setMode("create");
        }
      })
      .catch(() => setMode("create"));
  }, [onSuccess]);

  function handleSelectProfile(profile) {
    setSelectedProfile(profile);
    setMode("login");
  }

  function handleProfileCreated(profile) {
    onSuccess(profile);
  }

  function handleLoginSuccess(profile) {
    onSuccess(profile);
  }

  if (mode === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background login-bg">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background login-bg">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary/3 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        <div className="glass rounded-2xl p-8 shadow-2xl">
          {mode === "select" && (
            <ProfileSelector
              profiles={profiles}
              onSelectProfile={handleSelectProfile}
              onCreateNew={() => setMode("create")}
            />
          )}
          {mode === "login" && selectedProfile && (
            <ProfileLogin
              profile={selectedProfile}
              onBack={() => setMode("select")}
              onSuccess={handleLoginSuccess}
            />
          )}
          {mode === "create" && (
            <CreateProfile
              onBack={profiles.length > 0 ? () => setMode("select") : null}
              onSuccess={handleProfileCreated}
              isFirst={profiles.length === 0}
            />
          )}
          {mode === "legacy" && <LegacyLogin onSuccess={handleLoginSuccess} />}
        </div>

        <p className="text-center text-[11px] text-muted-foreground/50 mt-6">
          Powered by Claude &middot; Anthropic
        </p>
      </div>
    </div>
  );
}
