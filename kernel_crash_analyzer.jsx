import { useState, useEffect, useRef } from "react";

const SAMPLE_LOG = `[  123.456789] BUG: unable to handle page fault for address: ffff8881a3c04000
[  123.456790] #PF: supervisor read access in kernel mode
[  123.456791] #PF: error_code(0x0000) - not-present page
[  123.456792] PGD 0 P4D 0
[  123.456793] Oops: 0000 [#1] PREEMPT SMP NOPTI
[  123.456794] CPU: 3 PID: 1842 Comm: kworker/3:2 Tainted: G           OE  6.8.0-45-generic #45-Ubuntu
[  123.456795] Hardware name: Dell Inc. PowerEdge R740/0WGD1O, BIOS 2.19.1 01/15/2024
[  123.456796] Workqueue: events_unbound ext4_discard_work
[  123.456797] RIP: 0010:ext4_fill_super+0x1a3f/0x2b80 [ext4]
[  123.456798] Code: 48 8b 45 c0 48 85 c0 0f 84 d5 00 00 00 48 8b 40 18 48 85 c0
[  123.456799] RSP: 0018:ffffc90002b47c38 EFLAGS: 00010246
[  123.456800] RAX: 0000000000000000 RBX: ffff8881a3c00000 RCX: 0000000000000000
[  123.456801] RDX: ffff8881b2e04000 RSI: 0000000000000001 RDI: ffff8881a3c00000
[  123.456802] Call Trace:
[  123.456803]  <TASK>
[  123.456804]  ext4_get_tree+0x1e/0x30 [ext4]
[  123.456805]  vfs_get_tree+0x29/0xd0
[  123.456806]  path_mount+0x476/0xba0
[  123.456807]  __x64_sys_mount+0x103/0x140
[  123.456808]  do_syscall_64+0x5d/0x90
[  123.456809]  entry_SYSCALL_64_after_hwframe+0x6e/0x76
[  123.456810]  </TASK>
[  123.456811] Modules linked in: ext4 mbcache jbd2 nvidia(OE) snd_hda_intel
[  123.456812] ---[ end trace 0000000000000000 ]---
[  123.456813] Kernel panic - not syncing: Fatal exception`;

const MOCK_ANALYSIS = {
  crash_type: "Kernel Panic",
  severity: "critical",
  confidence: 92,
  root_cause:
    "Null pointer dereference in ext4_fill_super() triggered by a corrupted superblock on the mounted ext4 filesystem. The RAX register is zeroed, indicating the expected structure pointer was NULL when the code attempted to read from offset 0x18.",
  detailed_analysis: `The crash originates in ext4_fill_super() at offset 0x1a3f, which is deep into the superblock validation path. The instruction at RIP attempted to dereference RAX (0x0000000000000000) after loading it from a structure at [rbp-0x40].

Key observations from the register state:
• RAX = 0x0 — the NULL pointer being dereferenced
• RBX = 0xffff8881a3c00000 — likely the superblock buffer
• The error code 0x0000 indicates a read access to a non-present page

The call trace shows this occurred during a mount operation:
  __x64_sys_mount → path_mount → vfs_get_tree → ext4_get_tree → ext4_fill_super

The Workqueue reference to ext4_discard_work suggests background discard operations were active, but the crash itself is in the mount path, indicating the filesystem was being remounted or a new mount was attempted.

The tainted flag 'OE' indicates out-of-tree (nvidia) and unsigned modules are loaded, but this is unrelated to the ext4 crash path.`,
  affected_subsystem: "ext4 filesystem",
  probable_trigger:
    "Corrupted superblock likely caused by an unclean shutdown or disk I/O error. The ext4_fill_super function failed to validate the superblock before dereferencing internal structures, hitting a NULL pointer where a valid journal descriptor was expected.",
  suggested_fixes: [
    "Boot from a live USB and run: fsck.ext4 -f /dev/sdXN on the affected partition",
    "Update to kernel 6.8.0-48 or later — patch 'ext4: add null check in ext4_fill_super for journal descriptor' was merged in 6.8.0-47",
    "Enable journal checksumming: tune2fs -O metadata_csum /dev/sdXN (prevents future silent corruption)",
    "Check disk health with smartctl -a /dev/sdX — look for reallocated sectors or pending sectors",
  ],
  related_issues: [
    {
      id: "CVE-2024-26631",
      title: "ext4: fix null deref in ext4_fill_super during mount",
      url: "#",
    },
    {
      id: "LKML-2024-0312",
      title: "[PATCH v2] ext4: validate journal descriptor before use",
      url: "#",
    },
    {
      id: "BZ-217834",
      title: "Kernel panic on mount after power loss with ext4",
      url: "#",
    },
  ],
  annotated_trace: [
    {
      func: "ext4_fill_super+0x1a3f/0x2b80 [ext4]",
      note: "← CRASH HERE: NULL deref reading journal descriptor at RAX+0x18",
    },
    {
      func: "ext4_get_tree+0x1e/0x30 [ext4]",
      note: "Mount entry point for ext4",
    },
    { func: "vfs_get_tree+0x29/0xd0", note: "VFS layer dispatches to filesystem" },
    {
      func: "path_mount+0x476/0xba0",
      note: "Core mount path — resolves flags and target",
    },
    {
      func: "__x64_sys_mount+0x103/0x140",
      note: "Syscall handler for mount(2)",
    },
    { func: "do_syscall_64+0x5d/0x90", note: "x86-64 syscall dispatcher" },
    {
      func: "entry_SYSCALL_64_after_hwframe+0x6e/0x76",
      note: "Hardware frame return from userspace",
    },
  ],
};

const SEVERITY_CONFIG = {
  critical: { color: "#ff3b30", bg: "rgba(255,59,48,0.12)", label: "CRITICAL" },
  high: { color: "#ff9500", bg: "rgba(255,149,0,0.12)", label: "HIGH" },
  medium: { color: "#ffd60a", bg: "rgba(255,214,10,0.12)", label: "MEDIUM" },
  low: { color: "#30d158", bg: "rgba(48,209,88,0.12)", label: "LOW" },
};

const DISTROS = [
  "Auto-detect",
  "Ubuntu",
  "RHEL / CentOS",
  "Debian",
  "Fedora",
  "Arch Linux",
  "SUSE / openSUSE",
  "Alpine",
  "Other",
];

// ─── Scanline / CRT background effect ───
function Scanlines() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
        background:
          "repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.03) 1px, transparent 1px, transparent 3px)",
        opacity: 0.5,
      }}
    />
  );
}

// ─── Typed text effect ───
function TypeWriter({ text, speed = 12, onDone }) {
  const [displayed, setDisplayed] = useState("");
  const idx = useRef(0);
  useEffect(() => {
    idx.current = 0;
    setDisplayed("");
    const iv = setInterval(() => {
      idx.current++;
      setDisplayed(text.slice(0, idx.current));
      if (idx.current >= text.length) {
        clearInterval(iv);
        onDone && onDone();
      }
    }, speed);
    return () => clearInterval(iv);
  }, [text]);
  return <span>{displayed}</span>;
}

// ─── Animated progress bar ───
function ConfidenceBar({ value }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    setTimeout(() => setWidth(value), 100);
  }, [value]);
  const color =
    value >= 85 ? "#30d158" : value >= 65 ? "#ffd60a" : "#ff9500";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${width}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            transition: "width 1.2s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
          color,
          fontWeight: 700,
          minWidth: 42,
        }}
      >
        {value}%
      </span>
    </div>
  );
}

// ─── Expandable section ───
function Expandable({ title, children, defaultOpen = false, icon }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 2,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          background: "none",
          border: "none",
          color: "#c8ccd0",
          padding: "14px 0",
          cursor: "pointer",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            fontSize: 11,
            color: "#5ac8fa",
          }}
        >
          ▶
        </span>
        {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
        {title}
      </button>
      <div
        style={{
          maxHeight: open ? 2000 : 0,
          overflow: "hidden",
          transition: "max-height 0.4s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <div style={{ paddingBottom: 16 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Badge component ───
function Badge({ label, color, bg }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 800,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: 1.2,
        color,
        background: bg,
        border: `1px solid ${color}33`,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

// ─── Loading / analyzing animation ───
function AnalyzingOverlay() {
  const [dots, setDots] = useState("");
  const [lines, setLines] = useState([]);
  const allLines = [
    "Parsing crash log...",
    "Segmenting kernel panic event...",
    "Extracting call trace (7 frames)...",
    "Detecting kernel version: 6.8.0-45-generic",
    "Querying RAG knowledge base...",
    "Matching against CVE database...",
    "Running LLM root-cause analysis...",
    "Cross-checking with rule engine...",
    "Generating report...",
  ];

  useEffect(() => {
    const dotIv = setInterval(
      () => setDots((d) => (d.length >= 3 ? "" : d + ".")),
      400
    );
    let i = 0;
    const lineIv = setInterval(() => {
      if (i < allLines.length) {
        setLines((prev) => [...prev, allLines[i]]);
        i++;
      }
    }, 350);
    return () => {
      clearInterval(dotIv);
      clearInterval(lineIv);
    };
  }, []);

  return (
    <div
      style={{
        background: "#0a0c10",
        border: "1px solid rgba(90,200,250,0.15)",
        borderRadius: 8,
        padding: 32,
        marginTop: 24,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
          color: "#5ac8fa",
          fontWeight: 700,
          marginBottom: 20,
        }}
      >
        ⟐ ANALYZING{dots}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: i === lines.length - 1 ? "#5ac8fa" : "#4a5568",
              display: "flex",
              alignItems: "center",
              gap: 8,
              animation: "fadeSlideIn 0.3s ease-out",
            }}
          >
            <span style={{ color: i < lines.length - 1 ? "#30d158" : "#5ac8fa" }}>
              {i < lines.length - 1 ? "✓" : "⟳"}
            </span>
            {line}
          </div>
        ))}
      </div>
      {/* pulsing bar */}
      <div
        style={{
          marginTop: 24,
          height: 3,
          borderRadius: 2,
          background: "rgba(255,255,255,0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "40%",
            height: "100%",
            background:
              "linear-gradient(90deg, transparent, #5ac8fa, transparent)",
            animation: "shimmer 1.5s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════
export default function KernelCrashAnalyzer() {
  const [logText, setLogText] = useState("");
  const [kernelVersion, setKernelVersion] = useState("");
  const [distro, setDistro] = useState("Auto-detect");
  const [context, setContext] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("analyzer");
  const fileInputRef = useRef(null);
  const reportRef = useRef(null);

  const handleAnalyze = () => {
    if (!logText.trim()) return;
    setAnalyzing(true);
    setReport(null);
    setFeedback(null);
    setTimeout(() => {
      setAnalyzing(false);
      setReport(MOCK_ANALYSIS);
      setHistory((prev) => [
        {
          id: Date.now(),
          date: new Date().toLocaleString(),
          crash_type: MOCK_ANALYSIS.crash_type,
          severity: MOCK_ANALYSIS.severity,
          kernel: "6.8.0-45-generic",
          subsystem: MOCK_ANALYSIS.affected_subsystem,
        },
        ...prev,
      ]);
      setTimeout(() => {
        reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }, 3800);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setLogText(ev.target.result);
      reader.readAsText(file);
    }
  };

  const handleLoadSample = () => setLogText(SAMPLE_LOG);

  const sev = report ? SEVERITY_CONFIG[report.severity] : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes reportReveal {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes gridScroll {
          0% { background-position: 0 0; }
          100% { background-position: 40px 40px; }
        }

        textarea:focus, input:focus, select:focus {
          outline: none;
          border-color: rgba(90,200,250,0.4) !important;
          box-shadow: 0 0 0 3px rgba(90,200,250,0.08);
        }

        textarea::placeholder, input::placeholder {
          color: #3a4250;
        }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

        .analyze-btn:hover:not(:disabled) {
          background: #5ac8fa !important;
          color: #000 !important;
          box-shadow: 0 0 30px rgba(90,200,250,0.3);
        }
        .analyze-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .nav-btn { transition: all 0.15s; }
        .nav-btn:hover { color: #fff !important; background: rgba(255,255,255,0.06) !important; }

        .feedback-btn { transition: all 0.15s; }
        .feedback-btn:hover { transform: scale(1.15); }

        .fix-item:hover { background: rgba(90,200,250,0.04); }

        .history-row:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      <Scanlines />

      <div
        style={{
          minHeight: "100vh",
          background: "#0d0f14",
          color: "#e0e4e8",
          fontFamily: "'DM Sans', sans-serif",
          position: "relative",
        }}
      >
        {/* Grid bg */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(90,200,250,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(90,200,250,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            animation: "gridScroll 80s linear infinite",
            pointerEvents: "none",
          }}
        />

        {/* ─── HEADER ─── */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 100,
            background: "rgba(13,15,20,0.85)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            padding: "0 32px",
          }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 60,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #5ac8fa 0%, #0a84ff 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  fontWeight: 800,
                  color: "#000",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                K
              </div>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 700,
                  fontSize: 15,
                  color: "#fff",
                  letterSpacing: -0.3,
                }}
              >
                kernel<span style={{ color: "#5ac8fa" }}>crash</span>
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "#4a5568",
                  background: "rgba(255,255,255,0.04)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                v0.1
              </span>
            </div>

            <nav style={{ display: "flex", gap: 4 }}>
              {[
                { key: "analyzer", label: "Analyzer" },
                { key: "history", label: "History" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  className="nav-btn"
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    background:
                      activeTab === tab.key
                        ? "rgba(90,200,250,0.1)"
                        : "transparent",
                    border: "none",
                    color: activeTab === tab.key ? "#5ac8fa" : "#6b7280",
                    padding: "6px 16px",
                    borderRadius: 6,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    letterSpacing: 0.3,
                  }}
                >
                  {tab.label}
                  {tab.key === "history" && history.length > 0 && (
                    <span
                      style={{
                        marginLeft: 6,
                        background: "rgba(90,200,250,0.2)",
                        color: "#5ac8fa",
                        borderRadius: 10,
                        padding: "1px 7px",
                        fontSize: 10,
                      }}
                    >
                      {history.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {/* ─── MAIN CONTENT ─── */}
        <main
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: "32px 32px 80px",
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* ═══ ANALYZER TAB ═══ */}
          {activeTab === "analyzer" && (
            <div style={{ animation: "fadeSlideIn 0.3s ease-out" }}>
              {/* Hero */}
              <div style={{ marginBottom: 32 }}>
                <h1
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 28,
                    fontWeight: 700,
                    color: "#fff",
                    marginBottom: 8,
                    letterSpacing: -0.5,
                  }}
                >
                  Kernel Crash Analyzer
                </h1>
                <p
                  style={{
                    fontSize: 15,
                    color: "#6b7280",
                    lineHeight: 1.6,
                  }}
                >
                  Paste a kernel log or upload a file. The LLM will classify the
                  crash, identify root cause, and suggest fixes.
                </p>
              </div>

              {/* ─── INPUT CARD ─── */}
              <div
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: `1px solid ${
                    dragOver
                      ? "rgba(90,200,250,0.4)"
                      : "rgba(255,255,255,0.06)"
                  }`,
                  borderRadius: 12,
                  padding: 24,
                  transition: "border-color 0.2s",
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
              >
                {/* Textarea */}
                <div style={{ position: "relative" }}>
                  <textarea
                    value={logText}
                    onChange={(e) => setLogText(e.target.value)}
                    placeholder="Paste your dmesg / journalctl / kdump output here..."
                    rows={14}
                    style={{
                      width: "100%",
                      background: "#080a0e",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 8,
                      padding: "16px 18px",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 12,
                      lineHeight: 1.7,
                      color: "#c8ccd0",
                      resize: "vertical",
                    }}
                  />
                  {!logText && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 16,
                        left: 0,
                        right: 0,
                        textAlign: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 11,
                          color: "#3a4250",
                          letterSpacing: 1,
                        }}
                      >
                        — or drag & drop a .log / .txt / .gz file —
                      </span>
                    </div>
                  )}
                </div>

                {/* File input + sample */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".log,.txt,.gz"
                    onChange={handleFileDrop}
                    style={{ display: "none" }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 6,
                      padding: "7px 14px",
                      color: "#8b95a5",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    📁 Upload file
                  </button>
                  <button
                    onClick={handleLoadSample}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#5ac8fa",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      cursor: "pointer",
                      fontWeight: 500,
                      opacity: 0.7,
                    }}
                  >
                    Load sample log
                  </button>
                  {logText && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: "#4a5568",
                      }}
                    >
                      {logText.split("\n").length} lines
                    </span>
                  )}
                </div>

                {/* Optional fields toggle */}
                <button
                  onClick={() => setShowOptional(!showOptional)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#6b7280",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    cursor: "pointer",
                    marginTop: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      transform: showOptional ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                      fontSize: 9,
                    }}
                  >
                    ▶
                  </span>
                  Optional context
                </button>

                {/* Optional fields */}
                <div
                  style={{
                    maxHeight: showOptional ? 200 : 0,
                    overflow: "hidden",
                    transition: "max-height 0.3s ease",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          color: "#6b7280",
                          letterSpacing: 0.8,
                          textTransform: "uppercase",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        Kernel Version
                      </label>
                      <input
                        value={kernelVersion}
                        onChange={(e) => setKernelVersion(e.target.value)}
                        placeholder="e.g. 6.8.0-45-generic"
                        style={{
                          width: "100%",
                          background: "#080a0e",
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 6,
                          padding: "9px 12px",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 12,
                          color: "#c8ccd0",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          color: "#6b7280",
                          letterSpacing: 0.8,
                          textTransform: "uppercase",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        Distribution
                      </label>
                      <select
                        value={distro}
                        onChange={(e) => setDistro(e.target.value)}
                        style={{
                          width: "100%",
                          background: "#080a0e",
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 6,
                          padding: "9px 12px",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 12,
                          color: "#c8ccd0",
                          appearance: "none",
                        }}
                      >
                        {DISTROS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10,
                        color: "#6b7280",
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      Additional Context
                    </label>
                    <input
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      placeholder="e.g. Started after NVIDIA driver update..."
                      style={{
                        width: "100%",
                        background: "#080a0e",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 6,
                        padding: "9px 12px",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        color: "#c8ccd0",
                      }}
                    />
                  </div>
                </div>

                {/* Analyze button */}
                <button
                  className="analyze-btn"
                  disabled={!logText.trim() || analyzing}
                  onClick={handleAnalyze}
                  style={{
                    width: "100%",
                    marginTop: 20,
                    padding: "14px",
                    background: "rgba(90,200,250,0.12)",
                    border: "1px solid rgba(90,200,250,0.3)",
                    borderRadius: 8,
                    color: "#5ac8fa",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    letterSpacing: 1,
                    transition: "all 0.2s",
                  }}
                >
                  {analyzing ? "⟳ ANALYZING..." : "⟐ ANALYZE CRASH"}
                </button>
              </div>

              {/* ─── ANALYZING ANIMATION ─── */}
              {analyzing && <AnalyzingOverlay />}

              {/* ─── REPORT ─── */}
              {report && !analyzing && (
                <div
                  ref={reportRef}
                  style={{
                    marginTop: 28,
                    animation: "reportReveal 0.6s ease-out",
                  }}
                >
                  <div
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    {/* Report header */}
                    <div
                      style={{
                        padding: "20px 24px",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 11,
                            color: "#4a5568",
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            fontWeight: 600,
                          }}
                        >
                          Analysis Report
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Badge
                          label={report.crash_type}
                          color="#5ac8fa"
                          bg="rgba(90,200,250,0.1)"
                        />
                        <Badge
                          label={sev.label}
                          color={sev.color}
                          bg={sev.bg}
                        />
                      </div>
                    </div>

                    <div style={{ padding: 24 }}>
                      {/* Confidence */}
                      <div style={{ marginBottom: 24 }}>
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                            color: "#6b7280",
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            fontWeight: 600,
                            marginBottom: 8,
                          }}
                        >
                          Confidence
                        </div>
                        <ConfidenceBar value={report.confidence} />
                      </div>

                      {/* Root cause */}
                      <div style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                            color: "#6b7280",
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            fontWeight: 600,
                            marginBottom: 10,
                          }}
                        >
                          Root Cause
                        </div>
                        <p
                          style={{
                            fontSize: 15,
                            lineHeight: 1.7,
                            color: "#e0e4e8",
                          }}
                        >
                          <TypeWriter text={report.root_cause} speed={8} />
                        </p>
                      </div>

                      {/* Subsystem + trigger */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 16,
                          margin: "20px 0 4px",
                        }}
                      >
                        <div
                          style={{
                            background: "rgba(255,255,255,0.02)",
                            borderRadius: 8,
                            padding: 16,
                            border: "1px solid rgba(255,255,255,0.04)",
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 10,
                              color: "#6b7280",
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              fontWeight: 600,
                              marginBottom: 8,
                            }}
                          >
                            Affected Subsystem
                          </div>
                          <span
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: 14,
                              color: "#fff",
                              fontWeight: 600,
                            }}
                          >
                            {report.affected_subsystem}
                          </span>
                        </div>
                        <div
                          style={{
                            background: "rgba(255,255,255,0.02)",
                            borderRadius: 8,
                            padding: 16,
                            border: "1px solid rgba(255,255,255,0.04)",
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 10,
                              color: "#6b7280",
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              fontWeight: 600,
                              marginBottom: 8,
                            }}
                          >
                            Probable Trigger
                          </div>
                          <span
                            style={{
                              fontSize: 13,
                              color: "#c8ccd0",
                              lineHeight: 1.6,
                            }}
                          >
                            {report.probable_trigger}
                          </span>
                        </div>
                      </div>

                      {/* Suggested Fixes */}
                      <Expandable title="Suggested Fixes" icon="🔧" defaultOpen={true}>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          {report.suggested_fixes.map((fix, i) => (
                            <div
                              key={i}
                              className="fix-item"
                              style={{
                                display: "flex",
                                gap: 12,
                                padding: "10px 14px",
                                borderRadius: 6,
                                border: "1px solid rgba(255,255,255,0.04)",
                                transition: "background 0.15s",
                              }}
                            >
                              <span
                                style={{
                                  fontFamily: "'JetBrains Mono', monospace",
                                  fontSize: 12,
                                  color: "#5ac8fa",
                                  fontWeight: 700,
                                  flexShrink: 0,
                                  marginTop: 1,
                                }}
                              >
                                {i + 1}.
                              </span>
                              <span
                                style={{
                                  fontSize: 13,
                                  color: "#c8ccd0",
                                  lineHeight: 1.6,
                                  fontFamily: "'JetBrains Mono', monospace",
                                }}
                              >
                                {fix}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Expandable>

                      {/* Detailed Analysis */}
                      <Expandable title="Detailed Analysis" icon="🔬">
                        <pre
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12,
                            lineHeight: 1.8,
                            color: "#a0aab4",
                            whiteSpace: "pre-wrap",
                            background: "rgba(0,0,0,0.3)",
                            padding: 16,
                            borderRadius: 8,
                          }}
                        >
                          {report.detailed_analysis}
                        </pre>
                      </Expandable>

                      {/* Annotated Call Trace */}
                      <Expandable title="Annotated Call Trace" icon="📜">
                        <div
                          style={{
                            background: "rgba(0,0,0,0.3)",
                            borderRadius: 8,
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          {report.annotated_trace.map((frame, i) => (
                            <div key={i}>
                              <div
                                style={{
                                  fontFamily: "'JetBrains Mono', monospace",
                                  fontSize: 12,
                                  color: i === 0 ? "#ff453a" : "#c8ccd0",
                                  fontWeight: i === 0 ? 700 : 400,
                                }}
                              >
                                {"  "}
                                {frame.func}
                              </div>
                              <div
                                style={{
                                  fontFamily: "'JetBrains Mono', monospace",
                                  fontSize: 11,
                                  color: i === 0 ? "#ff6961" : "#5ac8fa",
                                  marginLeft: 28,
                                  marginBottom: 6,
                                  opacity: 0.8,
                                  fontStyle: "italic",
                                }}
                              >
                                {frame.note}
                              </div>
                            </div>
                          ))}
                        </div>
                      </Expandable>

                      {/* Related Issues */}
                      <Expandable title="Related Known Issues" icon="🔗">
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          {report.related_issues.map((issue, i) => (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "8px 12px",
                                borderRadius: 6,
                                border: "1px solid rgba(255,255,255,0.04)",
                              }}
                            >
                              <span
                                style={{
                                  fontFamily: "'JetBrains Mono', monospace",
                                  fontSize: 11,
                                  color: "#5ac8fa",
                                  fontWeight: 600,
                                  flexShrink: 0,
                                }}
                              >
                                {issue.id}
                              </span>
                              <span
                                style={{
                                  fontSize: 13,
                                  color: "#a0aab4",
                                }}
                              >
                                {issue.title}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Expandable>

                      {/* Feedback */}
                      <div
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          marginTop: 16,
                          paddingTop: 20,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12,
                            color: "#6b7280",
                          }}
                        >
                          {feedback
                            ? feedback === "up"
                              ? "✅ Thanks for confirming!"
                              : "📝 Feedback recorded — we'll improve."
                            : "Was this analysis helpful?"}
                        </span>
                        {!feedback && (
                          <div style={{ display: "flex", gap: 8 }}>
                            {["👍", "👎"].map((emoji) => (
                              <button
                                key={emoji}
                                className="feedback-btn"
                                onClick={() =>
                                  setFeedback(emoji === "👍" ? "up" : "down")
                                }
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 8,
                                  background: "rgba(255,255,255,0.04)",
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  fontSize: 18,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      marginTop: 16,
                      justifyContent: "flex-end",
                    }}
                  >
                    {["📄 Export PDF", "🎫 Create Jira Ticket", "💬 Share to Slack"].map(
                      (label) => (
                        <button
                          key={label}
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 6,
                            padding: "8px 16px",
                            color: "#8b95a5",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 11,
                            cursor: "pointer",
                            fontWeight: 500,
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = "rgba(255,255,255,0.06)";
                            e.target.style.color = "#c8ccd0";
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = "rgba(255,255,255,0.03)";
                            e.target.style.color = "#8b95a5";
                          }}
                        >
                          {label}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ HISTORY TAB ═══ */}
          {activeTab === "history" && (
            <div style={{ animation: "fadeSlideIn 0.3s ease-out" }}>
              <h2
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#fff",
                  marginBottom: 6,
                }}
              >
                Analysis History
              </h2>
              <p
                style={{
                  fontSize: 14,
                  color: "#6b7280",
                  marginBottom: 24,
                }}
              >
                Past crash analyses from this session.
              </p>

              {history.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 60,
                    color: "#3a4250",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                  }}
                >
                  No analyses yet. Go analyze a crash!
                </div>
              ) : (
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  {/* Table header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.8fr 1.2fr 0.8fr 1.2fr 1.2fr",
                      padding: "10px 20px",
                      background: "rgba(255,255,255,0.02)",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {["Date", "Crash Type", "Severity", "Kernel", "Subsystem"].map(
                      (h) => (
                        <span
                          key={h}
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                            color: "#6b7280",
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            fontWeight: 600,
                          }}
                        >
                          {h}
                        </span>
                      )
                    )}
                  </div>
                  {history.map((item) => {
                    const s = SEVERITY_CONFIG[item.severity];
                    return (
                      <div
                        key={item.id}
                        className="history-row"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.8fr 1.2fr 0.8fr 1.2fr 1.2fr",
                          padding: "12px 20px",
                          borderBottom: "1px solid rgba(255,255,255,0.03)",
                          cursor: "pointer",
                          transition: "background 0.15s",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12,
                            color: "#8b95a5",
                          }}
                        >
                          {item.date}
                        </span>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12,
                            color: "#e0e4e8",
                          }}
                        >
                          {item.crash_type}
                        </span>
                        <Badge label={s.label} color={s.color} bg={s.bg} />
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12,
                            color: "#8b95a5",
                          }}
                        >
                          {item.kernel}
                        </span>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12,
                            color: "#8b95a5",
                          }}
                        >
                          {item.subsystem}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
