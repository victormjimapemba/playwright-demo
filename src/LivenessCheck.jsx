import { useState, useRef, useEffect, useCallback } from "react";

// ── challenge metadata ────────────────────────────────────────────────────────
const CHALLENGE_META = {
  blink_twice:    { label: "Blink twice",        icon: "👁️",  duration: 2500 },
  turn_left:      { label: "Turn head left",     icon: "←",   duration: 2500 },
  turn_right:     { label: "Turn head right",    icon: "→",   duration: 2500 },
  tilt_up:        { label: "Tilt head up",       icon: "↑",   duration: 2000 },
  tilt_down:      { label: "Tilt head down",     icon: "↓",   duration: 2000 },
  smile:          { label: "Smile",              icon: "😊",  duration: 2000 },
  open_mouth:     { label: "Open your mouth",    icon: "😮",  duration: 2000 },
  raise_eyebrows: { label: "Raise your eyebrows",icon: "🤨",  duration: 2000 },
  look_left:      { label: "Look left",          icon: "👈",  duration: 2000 },
  look_right:     { label: "Look right",         icon: "👉",  duration: 2000 },
};

const DEMO_CHALLENGES = ["blink_twice", "turn_left"];

// ── stages ────────────────────────────────────────────────────────────────────
// idle → preparing → challenge_1 → challenge_2 → processing → success | failure

const TOTAL_CLIP_MS = 5000;

export default function LivenessCheck() {
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const mediaRecorder = useRef(null);
  const chunksRef     = useRef([]);
  const streamRef     = useRef(null);
  const timerRef      = useRef(null);

  const [stage,       setStage]      = useState("idle");
  const [challenges,  setChallenges] = useState(DEMO_CHALLENGES);
  const [sessionId,   setSessionId]  = useState(null);
  const [activeIdx,   setActiveIdx]  = useState(0);
  const [countdown,   setCountdown]  = useState(null);
  const [result,      setResult]     = useState(null);
  const [attempts,    setAttempts]   = useState(0);
  const [camError,    setCamError]   = useState(null);

  // cleanup on unmount
  useEffect(() => () => stopCamera(), []);

  const stopCamera = () => {
    clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  // ── fetch challenges from backend ─────────────────────────────────────────
  const fetchChallenges = async () => {
    // In production: POST /api/liveness/new-session
    // Returns { session_id, challenges }
    // For demo we use the static list
    return { session_id: "demo-" + Date.now(), challenges: DEMO_CHALLENGES };
  };

  // ── start flow ────────────────────────────────────────────────────────────
  const handleStart = async () => {
    setCamError(null);
    setResult(null);

    const { session_id, challenges: ch } = await fetchChallenges();
    setSessionId(session_id);
    setChallenges(ch);
    setActiveIdx(0);
    setStage("preparing");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // brief settling time
      setTimeout(() => beginRecording(stream, ch, session_id), 1000);
    } catch (e) {
      setCamError("Camera access denied. Please allow camera permissions.");
      setStage("idle");
    }
  };

  // ── record + prompt ───────────────────────────────────────────────────────
  const beginRecording = (stream, ch, sid) => {
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => handleRecordingDone(sid, ch);
    mediaRecorder.current = recorder;
    recorder.start(100);

    // Show challenge 1 immediately
    setStage("challenge_0");
    setActiveIdx(0);
    setCountdown(ch[0] ? CHALLENGE_META[ch[0]].duration / 1000 : 3);

    // midpoint: switch to challenge 2
    const half = TOTAL_CLIP_MS / 2;
    setTimeout(() => {
      setStage("challenge_1");
      setActiveIdx(1);
      setCountdown(ch[1] ? CHALLENGE_META[ch[1]].duration / 1000 : 3);
    }, half);

    // stop recording
    setTimeout(() => {
      recorder.stop();
      setStage("processing");
      stopCamera();
    }, TOTAL_CLIP_MS);

    // live countdown ticker
    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += 100;
      const remaining = Math.max(0, (TOTAL_CLIP_MS - elapsed) / 1000);
      setCountdown(parseFloat(remaining.toFixed(1)));
    }, 100);
  };

  // ── submit to backend ─────────────────────────────────────────────────────
  const handleRecordingDone = async (sid, ch) => {
    clearInterval(timerRef.current);

    // In production: POST /api/liveness/verify with FormData { session_id, video }
    // The backend extracts frames and calls verify_challenges()
    // For demo, simulate a result after 2s
    await new Promise(r => setTimeout(r, 2000));

    const passed = Math.random() > 0.3;  // replace with real API call
    setResult({
      live: passed,
      challenges: ch.map((name, i) => ({
        name,
        passed: passed || i === 0,
        detail: passed ? "Challenge completed" : "Challenge not detected",
      })),
    });
    setAttempts(a => a + 1);
    setStage(passed ? "success" : "failure");
  };

  const handleRetry = () => {
    setStage("idle");
    setResult(null);
    setCountdown(null);
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const activeMeta = challenges[activeIdx] ? CHALLENGE_META[challenges[activeIdx]] : null;
  const isRecording = stage === "challenge_0" || stage === "challenge_1";

  return (
    <div style={styles.root}>
      <div style={styles.card}>

        {/* header */}
        <div style={styles.header}>
          <div style={styles.logoMark}>L</div>
          <div>
            <div style={styles.title}>Liveness Check</div>
            <div style={styles.subtitle}>Verify you're a real person</div>
          </div>
        </div>

        {/* camera / state area */}
        <div style={styles.cameraWrap}>
          <video
            ref={videoRef}
            style={{
              ...styles.video,
              display: stage === "idle" || stage === "processing" || stage === "success" || stage === "failure" ? "none" : "block",
            }}
            muted
            playsInline
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />

          {/* idle */}
          {stage === "idle" && (
            <div style={styles.placeholder}>
              <div style={styles.faceOutline}>
                <svg width="80" height="96" viewBox="0 0 80 96" fill="none">
                  <ellipse cx="40" cy="38" rx="28" ry="32" stroke="#4ade80" strokeWidth="2" strokeDasharray="6 4"/>
                  <circle cx="28" cy="34" r="4" fill="#4ade80" opacity="0.6"/>
                  <circle cx="52" cy="34" r="4" fill="#4ade80" opacity="0.6"/>
                  <path d="M28 52 Q40 62 52 52" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" fill="none"/>
                </svg>
              </div>
              <p style={styles.placeholderText}>Position your face in the frame</p>
            </div>
          )}

          {/* preparing */}
          {stage === "preparing" && (
            <div style={styles.overlay}>
              <div style={styles.prepText}>Get ready…</div>
            </div>
          )}

          {/* active challenge overlay */}
          {isRecording && activeMeta && (
            <div style={styles.challengeOverlay}>
              <div style={styles.challengeIcon}>{activeMeta.icon}</div>
              <div style={styles.challengeLabel}>{activeMeta.label}</div>
              <div style={styles.countdownBar}>
                <div style={styles.countdownTrack}>
                  <div
                    style={{
                      ...styles.countdownFill,
                      width: `${Math.min(100, (countdown / (TOTAL_CLIP_MS / 1000 / 2)) * 100)}%`,
                    }}
                  />
                </div>
                <span style={styles.countdownNum}>{countdown}s</span>
              </div>
              <div style={styles.stepDots}>
                {challenges.map((_, i) => (
                  <div key={i} style={{ ...styles.dot, background: i === activeIdx ? "#4ade80" : "#334155" }} />
                ))}
              </div>
            </div>
          )}

          {/* processing */}
          {stage === "processing" && (
            <div style={styles.placeholder}>
              <div style={styles.spinner}/>
              <p style={styles.placeholderText}>Analysing…</p>
            </div>
          )}

          {/* success */}
          {stage === "success" && (
            <div style={{ ...styles.placeholder, gap: 12 }}>
              <div style={styles.successCircle}>✓</div>
              <p style={{ ...styles.placeholderText, color: "#4ade80", fontWeight: 700, fontSize: 18 }}>
                Liveness confirmed
              </p>
              {result?.challenges.map(c => (
                <div key={c.name} style={styles.challengeRow}>
                  <span style={{ color: "#4ade80" }}>✓</span>
                  <span style={styles.challengeRowLabel}>{CHALLENGE_META[c.name]?.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* failure */}
          {stage === "failure" && (
            <div style={{ ...styles.placeholder, gap: 12 }}>
              <div style={styles.failCircle}>✗</div>
              <p style={{ ...styles.placeholderText, color: "#f87171", fontWeight: 700, fontSize: 18 }}>
                Verification failed
              </p>
              {result?.challenges.map(c => (
                <div key={c.name} style={styles.challengeRow}>
                  <span style={{ color: c.passed ? "#4ade80" : "#f87171" }}>{c.passed ? "✓" : "✗"}</span>
                  <span style={styles.challengeRowLabel}>{CHALLENGE_META[c.name]?.label}</span>
                  {!c.passed && <span style={styles.challengeDetail}>{c.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {/* recording indicator */}
          {isRecording && (
            <div style={styles.recIndicator}>
              <div style={styles.recDot}/>
              REC
            </div>
          )}
        </div>

        {/* challenge preview (idle/preparing) */}
        {(stage === "idle" || stage === "preparing") && (
          <div style={styles.challengePreview}>
            <div style={styles.previewLabel}>You will be asked to:</div>
            <div style={styles.previewSteps}>
              {challenges.map((ch, i) => {
                const m = CHALLENGE_META[ch];
                return (
                  <div key={ch} style={styles.previewStep}>
                    <div style={styles.previewNum}>{i + 1}</div>
                    <span style={styles.previewIcon}>{m.icon}</span>
                    <span style={styles.previewStepLabel}>{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* camera error */}
        {camError && <div style={styles.errorBanner}>{camError}</div>}

        {/* attempts */}
        {attempts > 0 && stage !== "success" && (
          <div style={styles.attemptsNote}>Attempt {attempts} — new challenges will be issued on retry</div>
        )}

        {/* CTA */}
        <div style={styles.actions}>
          {(stage === "idle") && (
            <button style={styles.btnPrimary} onClick={handleStart}>
              Begin verification
            </button>
          )}
          {stage === "failure" && (
            <button style={styles.btnPrimary} onClick={handleRetry}>
              Try again
            </button>
          )}
          {stage === "success" && (
            <button style={{ ...styles.btnPrimary, background: "#166534", cursor: "default" }} disabled>
              ✓ Verified
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    background: "#020b18",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'DM Mono', 'Courier New', monospace",
    padding: 16,
  },
  card: {
    background: "#0d1f2d",
    border: "1px solid #1e3a4a",
    borderRadius: 16,
    width: "100%",
    maxWidth: 420,
    overflow: "hidden",
    boxShadow: "0 0 60px rgba(74,222,128,0.05), 0 24px 48px rgba(0,0,0,0.5)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "20px 24px 16px",
    borderBottom: "1px solid #1e3a4a",
  },
  logoMark: {
    width: 36,
    height: 36,
    background: "linear-gradient(135deg, #4ade80, #16a34a)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    color: "#000",
    fontSize: 18,
    flexShrink: 0,
  },
  title: {
    color: "#e2f0e8",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  subtitle: {
    color: "#4a7060",
    fontSize: 11,
    marginTop: 2,
    letterSpacing: "0.03em",
  },
  cameraWrap: {
    position: "relative",
    background: "#050f18",
    height: 300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)", // mirror
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    width: "100%",
    height: "100%",
  },
  faceOutline: {
    opacity: 0.7,
  },
  placeholderText: {
    color: "#4a7060",
    fontSize: 13,
    letterSpacing: "0.04em",
    margin: 0,
  },
  overlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(2,11,24,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  prepText: {
    color: "#4ade80",
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "0.1em",
  },
  challengeOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    background: "linear-gradient(transparent, rgba(2,11,24,0.95))",
    padding: "32px 20px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  challengeIcon: {
    fontSize: 36,
    lineHeight: 1,
  },
  challengeLabel: {
    color: "#e2f0e8",
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  countdownBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  countdownTrack: {
    flex: 1,
    height: 3,
    background: "#1e3a4a",
    borderRadius: 2,
    overflow: "hidden",
  },
  countdownFill: {
    height: "100%",
    background: "#4ade80",
    borderRadius: 2,
    transition: "width 0.1s linear",
  },
  countdownNum: {
    color: "#4ade80",
    fontSize: 11,
    width: 30,
    textAlign: "right",
  },
  stepDots: {
    display: "flex",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    transition: "background 0.3s",
  },
  recIndicator: {
    position: "absolute",
    top: 12,
    right: 12,
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "rgba(0,0,0,0.6)",
    color: "#f87171",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
    padding: "3px 8px",
    borderRadius: 4,
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#f87171",
    animation: "pulse 1s infinite",
  },
  challengePreview: {
    padding: "16px 24px",
    borderBottom: "1px solid #1e3a4a",
  },
  previewLabel: {
    color: "#4a7060",
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  previewSteps: {
    display: "flex",
    gap: 12,
  },
  previewStep: {
    flex: 1,
    background: "#0a1929",
    border: "1px solid #1e3a4a",
    borderRadius: 8,
    padding: "10px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },
  previewNum: {
    color: "#4a7060",
    fontSize: 9,
    letterSpacing: "0.1em",
  },
  previewIcon: {
    fontSize: 22,
  },
  previewStepLabel: {
    color: "#8ab4a0",
    fontSize: 10,
    textAlign: "center",
    letterSpacing: "0.02em",
  },
  errorBanner: {
    background: "#2d1010",
    borderTop: "1px solid #7f1d1d",
    color: "#fca5a5",
    fontSize: 12,
    padding: "10px 24px",
    letterSpacing: "0.02em",
  },
  attemptsNote: {
    color: "#4a5568",
    fontSize: 10,
    textAlign: "center",
    padding: "8px 24px 0",
    letterSpacing: "0.03em",
  },
  actions: {
    padding: "16px 24px 20px",
  },
  btnPrimary: {
    width: "100%",
    padding: "12px 0",
    background: "linear-gradient(135deg, #16a34a, #15803d)",
    color: "#d1fae5",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "opacity 0.2s",
  },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "rgba(74,222,128,0.1)",
    border: "2px solid #4ade80",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    color: "#4ade80",
  },
  failCircle: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "rgba(248,113,113,0.1)",
    border: "2px solid #f87171",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    color: "#f87171",
  },
  challengeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
  },
  challengeRowLabel: {
    color: "#8ab4a0",
  },
  challengeDetail: {
    color: "#4a5568",
    fontSize: 10,
  },
  spinner: {
    width: 40,
    height: 40,
    border: "3px solid #1e3a4a",
    borderTop: "3px solid #4ade80",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};
