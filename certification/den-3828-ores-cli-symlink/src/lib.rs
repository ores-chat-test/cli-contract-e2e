use std::collections::BTreeMap;

pub mod model {
    use std::collections::BTreeMap;

    use serde_json::Value;

    #[derive(Debug, Clone, Copy, Eq, PartialEq)]
    pub enum Severity {
        Info,
        Error,
    }

    impl Severity {
        pub const fn is_issue(self) -> bool {
            !matches!(self, Self::Info)
        }

        const fn sort_rank(self) -> u8 {
            match self {
                Self::Error => 0,
                Self::Info => 2,
            }
        }
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct Finding {
        pub code: String,
        pub severity: Severity,
        pub message: String,
        pub target: Option<String>,
    }

    impl Finding {
        pub fn info(code: impl Into<String>, message: impl Into<String>) -> Self {
            Self::new(Severity::Info, code, message)
        }

        pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
            Self::new(Severity::Error, code, message)
        }

        fn new(severity: Severity, code: impl Into<String>, message: impl Into<String>) -> Self {
            Self {
                code: code.into(),
                severity,
                message: message.into(),
                target: None,
            }
        }

        pub fn with_target(mut self, target: impl Into<String>) -> Self {
            self.target = Some(target.into());
            self
        }
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct CommandReport {
        pub command: String,
        pub findings: Vec<Finding>,
        pub metadata: BTreeMap<String, Value>,
    }

    impl CommandReport {
        pub fn new(command: impl Into<String>) -> Self {
            Self {
                command: command.into(),
                findings: Vec::new(),
                metadata: BTreeMap::new(),
            }
        }

        pub fn push(&mut self, finding: Finding) {
            self.findings.push(finding);
        }

        pub fn insert_metadata(&mut self, key: impl Into<String>, value: Value) {
            self.metadata.insert(key.into(), value);
        }

        pub fn issue_count(&self) -> usize {
            self.findings
                .iter()
                .filter(|finding| finding.severity.is_issue())
                .count()
        }

        pub fn finalize(mut self) -> Self {
            self.findings.sort_by(|left, right| {
                left.severity
                    .sort_rank()
                    .cmp(&right.severity.sort_rank())
                    .then_with(|| left.code.cmp(&right.code))
                    .then_with(|| left.target.cmp(&right.target))
                    .then_with(|| left.message.cmp(&right.message))
            });
            self
        }
    }
}

pub mod audit {
    use std::path::PathBuf;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct RepositoryAuditOptions {
        pub path: PathBuf,
        pub profile: String,
        pub additional_required_paths: Vec<String>,
    }

    mod contract_generated_evidence {
        include!("../mirror/contract_generated_evidence.rs");
    }
}

#[allow(dead_code)]
fn _keep_btree_map_type_visible(_: BTreeMap<String, serde_json::Value>) {}
