let meta = #{
    name: "full-app-quality-audit",
    description: "Parallel read-only quality audit of PV_DataForge with adversarial verification",
    when_to_use: "Before release, after large changes, or when the user asks for a full quality audit",
    phases: [
        #{ title: "Audit", detail: "parallel dimensions" },
        #{ title: "Verify", detail: "skeptic on top findings" },
    ],
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue", "severity"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let root = if args == () { "backend/app" } else if args.root == () { "backend/app" } else { args.root };

phase("Audit");
let dimensions = [
    "persistence policy and SQLite store/never-store rules",
    "package multifile semantics and archive tar.gz multi-file defaults",
    "API generate/export/delivery correctness and error handling",
    "security hygiene secrets paths and unsafe defaults",
];
let jobs = [];
for d in dimensions {
    let p = "";
    p += "You are auditing PV_DataForge (Python FastAPI + Vue). ";
    p += "Focus ONLY on: " + d + ". ";
    p += "Use read-only tools (read_file, grep, list_dir). Inspect real code under ";
    p += root + " and frontend/src when relevant. ";
    p += "Do not invent issues. Report at most 8 concrete findings as {file, issue, severity} ";
    p += "where severity is blocker|major|minor. Empty findings only after you actually read code.";
    jobs.push(#{
        prompt: p,
        label: "audit",
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}
let results = parallel(jobs);

let findings = [];
for r in results {
    if r != () && r.success && r.output.findings != () {
        for f in r.output.findings {
            findings.push(f);
        }
    }
}
if findings.len() == 0 {
    complete(#{ summary: "No findings from audit panel.", confirmed: [] });
}

let max_v = 6;
let to_verify = [];
let i = 0;
for f in findings {
    if i < max_v {
        to_verify.push(f);
    }
    i += 1;
}
if findings.len() > max_v {
    log("Truncated verification to " + max_v.to_string() + " of " + findings.len().to_string());
}

phase("Verify");
let vjobs = [];
for f in to_verify {
    let vp = "";
    vp += "Adversarially verify this audit finding by reading the shipped code. ";
    vp += "Finding (" + f.severity + ") in " + f.file + ": " + f.issue + ". ";
    vp += "Use read_file/grep. Set real=true only with concrete evidence you inspected. ";
    vp += "Otherwise real=false.";
    vjobs.push(#{
        prompt: vp,
        label: "verify",
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
}
let verdicts = parallel(vjobs);

let confirmed = [];
let idx = 0;
for v in verdicts {
    if v != () && v.success && v.output.real == true && v.output.evidence != () && v.output.evidence != "" {
        if idx < to_verify.len() {
            confirmed.push(to_verify[idx]);
        }
    }
    idx += 1;
}

let report = "";
report += "# PV_DataForge quality audit\n\n";
report += "Confirmed findings: " + confirmed.len().to_string() + " / verified " + to_verify.len().to_string() + "\n\n";
for f in confirmed {
    report += "- **" + f.severity + "** `" + f.file + "`: " + f.issue + "\n";
}
let path = write_scratch_file("quality-audit.md", report);
log(confirmed.len().to_string() + " confirmed findings");
complete(#{ summary: confirmed.len().to_string() + " confirmed findings", path: path, confirmed: confirmed });
