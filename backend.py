"""
Kernel Crash Analyzer — Backend
FastAPI server that accepts kernel logs and returns LLM-powered analysis.

Usage:
  1. pip install fastapi uvicorn anthropic
  2. export ANTHROPIC_API_KEY=your-key-here
  3. uvicorn backend:app --reload --port 8000
"""

import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from anthropic import Anthropic

app = FastAPI(title="Kernel Crash Analyzer API")

# Allow React dev server to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Anthropic()  # reads ANTHROPIC_API_KEY from env

# ─── Request / Response models ───

class AnalyzeRequest(BaseModel):
    log_text: str
    kernel_version: str = ""
    distro: str = ""
    additional_context: str = ""

class RelatedIssue(BaseModel):
    id: str
    title: str
    url: str = "#"

class TraceFrame(BaseModel):
    func: str
    note: str

class AnalysisReport(BaseModel):
    crash_type: str
    severity: str
    confidence: int
    root_cause: str
    detailed_analysis: str
    affected_subsystem: str
    probable_trigger: str
    suggested_fixes: list[str]
    related_issues: list[RelatedIssue]
    annotated_trace: list[TraceFrame]

# ─── The prompt ───

SYSTEM_PROMPT = """You are a senior Linux kernel engineer with 20+ years of experience debugging kernel crashes, panics, oops, OOM kills, and hung tasks.

Given a kernel crash log, produce a thorough structured analysis in JSON format. Be specific — reference actual function names, register values, and offsets from the log. Do not be generic.

Respond with ONLY valid JSON (no markdown, no backticks, no preamble) matching this exact schema:

{
  "crash_type": "one of: Kernel Panic, Oops, OOM Kill, Hung Task, GPU Fault, Filesystem Corruption, Segfault, Soft Lockup, Hard Lockup, Other",
  "severity": "one of: critical, high, medium, low",
  "confidence": <integer 0-100>,
  "root_cause": "<1-3 sentence plain English explanation of what went wrong>",
  "detailed_analysis": "<multi-paragraph technical walkthrough of the crash, referencing register state, call trace frames, and relevant kernel internals>",
  "affected_subsystem": "<e.g., ext4 filesystem, memory management, networking, GPU driver>",
  "probable_trigger": "<what likely caused the crash — be specific>",
  "suggested_fixes": [
    "<actionable step 1 with specific commands if applicable>",
    "<actionable step 2>",
    "<actionable step 3>",
    "<actionable step 4>"
  ],
  "related_issues": [
    {"id": "<CVE or bug ID if you can identify one>", "title": "<description>", "url": "#"},
    {"id": "<another related issue>", "title": "<description>", "url": "#"}
  ],
  "annotated_trace": [
    {"func": "<function+offset from call trace>", "note": "<what this frame is doing>"},
    {"func": "<next frame>", "note": "<annotation>"}
  ]
}

Rules:
- annotated_trace should cover EVERY frame in the call trace from the log
- suggested_fixes should be concrete and actionable, not generic advice
- If you recognize a known CVE or kernel bug, reference it in related_issues
- If the log is incomplete or ambiguous, lower your confidence score and note uncertainties in detailed_analysis
- severity should be: critical (system unusable/data loss), high (crash but recoverable), medium (warning/degraded), low (informational)
"""

def build_user_prompt(req: AnalyzeRequest) -> str:
    parts = [f"<kernel_log>\n{req.log_text}\n</kernel_log>"]
    
    if req.kernel_version:
        parts.append(f"Kernel version (user-provided): {req.kernel_version}")
    if req.distro:
        parts.append(f"Distribution: {req.distro}")
    if req.additional_context:
        parts.append(f"Additional context from the engineer: {req.additional_context}")
    
    parts.append("\nAnalyze this crash and respond with the JSON report.")
    return "\n\n".join(parts)

# ─── Endpoint ───

@app.post("/analyze", response_model=AnalysisReport)
async def analyze_crash(req: AnalyzeRequest):
    if not req.log_text.strip():
        raise HTTPException(status_code=400, detail="log_text cannot be empty")

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": build_user_prompt(req)}
            ],
        )

        raw = message.content[0].text.strip()
        
        # Clean up in case the model wraps in ```json
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()

        report = json.loads(raw)
        return AnalysisReport(**report)

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"LLM returned invalid JSON: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.get("/health")
async def health():
    return {"status": "ok"}
